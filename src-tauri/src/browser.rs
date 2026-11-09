use std::cell::RefCell;
use std::collections::HashMap;
use std::path::PathBuf;
use std::rc::Rc;

use gtk::prelude::*;
use javascriptcore::ValueExt;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tauri_plugin_opener::OpenerExt;
use webkit2gtk::{
  glib, CookieAcceptPolicy, CookieManagerExt, CookiePersistentStorage, HitTestResultExt, LoadEvent,
  NavigationPolicyDecision, NavigationPolicyDecisionExt, PolicyDecisionExt, PolicyDecisionType,
  SettingsExt, URIRequestExt, UserContentInjectedFrames, UserContentManagerExt, UserScript,
  UserScriptInjectionTime, WebContext, WebView, WebViewExt, WebsiteDataManager,
  WebsiteDataManagerExt, WindowPropertiesExt,
};

pub const BROWSER_EVENT: &str = "papyri://browser";
pub const DEFAULT_URL: &str = "https://chatgpt.com/";

pub const SITE_CHATGPT: &str = "chatgpt";
pub const SITE_WIKIPEDIA: &str = "wikipedia";
pub const SITE_GEMINI: &str = "gemini";

fn site_home(site: &str) -> Option<&'static str> {
  match site {
    SITE_CHATGPT => Some("https://chatgpt.com/"),
    SITE_WIKIPEDIA => Some("https://en.wikipedia.org/wiki/Main_Page"),
    SITE_GEMINI => Some("https://gemini.google.com/"),
    _ => None,
  }
}

fn normalize_site(site: &str) -> Result<String, String> {
  let site = site.trim();
  if site_home(site).is_some() {
    Ok(site.to_string())
  } else {
    Err(format!("Unknown browser site: {site}"))
  }
}

const BROWSER_MIN_ZOOM: f64 = 0.25;
const BROWSER_MAX_ZOOM: f64 = 5.0;
const BROWSER_ZOOM_STEP: f64 = 0.1;

fn clamp_browser_zoom(zoom: f64) -> f64 {
  zoom.clamp(BROWSER_MIN_ZOOM, BROWSER_MAX_ZOOM)
}

fn browser_zoom_percent(zoom: f64) -> i32 {
  (clamp_browser_zoom(zoom) * 100.0).round() as i32
}

fn set_browser_zoom(view: &WebView, zoom: f64) {
  view.set_zoom_level(clamp_browser_zoom(zoom));
}

fn browser_log(message: impl AsRef<str>) {
  if cfg!(debug_assertions) {
    eprintln!("[browser] {}", message.as_ref());
  }
}

fn configure_browser_view(view: &WebView) {
  if let Some(settings) = WebViewExt::settings(view) {
    if cfg!(debug_assertions) {
      settings.set_enable_write_console_messages_to_stdout(true);
    }
  }
  if let Some(manager) = view.user_content_manager() {
    manager.add_script(&UserScript::new(
      include_str!("browser_dom.js"),
      UserContentInjectedFrames::TopFrame,
      UserScriptInjectionTime::Start,
      &[],
      &[],
    ));
  }
}

/// ChatGPT's direct social-login flow can call window.open after a
/// client-side redirect, where WebKit no longer sees the original click as a
/// gesture. Allow automatic windows only on the auth hosts; normal sites keep
/// the popup blocker.
fn allows_automatic_popups(uri: &str) -> bool {
  [
    "https://chatgpt.com/",
    "https://chat.openai.com/",
    "https://auth.openai.com/",
    "https://gemini.google.com/",
    "https://accounts.google.com/",
  ]
  .iter()
  .any(|prefix| uri.starts_with(prefix))
}

fn update_automatic_popups(view: &WebView) {
  if let Some(settings) = WebViewExt::settings(view) {
    let allow = view.uri().is_some_and(|uri| allows_automatic_popups(&uri));
    settings.set_javascript_can_open_windows_automatically(allow);
  }
}

/// Sign-in cookies live in an app-private WebKit data directory. The browser
/// is deliberately outside Tauri's webview tree so visited pages never get the
/// host token or any application command permission.
struct BrowserHost {
  app: AppHandle,
  window: gtk::Window,
  stack: gtk::Stack,
  main_view: gtk::Widget,
  context: WebContext,
  views: HashMap<String, WebView>,
  active: Rc<RefCell<Option<String>>>,
  pending_quotes: Rc<RefCell<HashMap<String, String>>>,
  bounds: (i32, i32, i32, i32),
  visible: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserState {
  site: String,
  url: String,
  title: String,
  loading: bool,
  can_go_back: bool,
  can_go_forward: bool,
  zoom: f64,
  error: Option<String>,
}

thread_local! {
  static BROWSER: RefCell<Option<BrowserHost>> = const { RefCell::new(None) };
  static POPUPS: RefCell<Vec<gtk::Window>> = const { RefCell::new(Vec::new()) };
}

fn emit_state(
  app: &AppHandle,
  active: &Rc<RefCell<Option<String>>>,
  site: &str,
  view: &WebView,
  error: Option<String>,
) {
  if active.borrow().as_deref() != Some(site) {
    return;
  }
  let state = BrowserState {
    site: site.to_string(),
    url: view
      .uri()
      .map(|value| value.to_string())
      .unwrap_or_default(),
    title: view
      .title()
      .map(|value| value.to_string())
      .unwrap_or_default(),
    loading: view.is_loading(),
    can_go_back: view.can_go_back(),
    can_go_forward: view.can_go_forward(),
    zoom: view.zoom_level(),
    error,
  };
  let _ = app.emit(BROWSER_EVENT, state);
}

fn is_allowed_url(url: &str) -> bool {
  let trimmed = url.trim();
  let scheme = trimmed.to_ascii_lowercase();
  !trimmed.is_empty()
    && ["https://", "http://", "about:blank"]
      .iter()
      .any(|prefix| scheme.starts_with(prefix))
}

/// Page-initiated routes may also use WebKit's in-memory schemes. Local files
/// and application schemes stay blocked.
fn is_allowed_navigation(url: &str) -> bool {
  is_allowed_url(url) || url.starts_with("blob:") || url.starts_with("data:")
}

fn normalize_url(url: &str) -> Result<String, String> {
  let trimmed = url.trim();
  if !is_allowed_url(trimmed) {
    return Err("Only HTTP and HTTPS addresses are supported in the browser panel.".into());
  }
  Ok(trimmed.to_string())
}

fn open_external(app: &AppHandle, uri: &str) {
  if uri.starts_with("mailto:") || uri.starts_with("tel:") {
    let _ = app.opener().open_url(uri, None::<&str>);
  }
}

fn attach_navigation_policy(view: &WebView) {
  view.connect_decide_policy(|_, decision, decision_type| {
    if decision_type == PolicyDecisionType::NewWindowAction {
      let uri = decision
        .downcast_ref::<NavigationPolicyDecision>()
        .and_then(|navigation| navigation.navigation_action())
        .and_then(|action| action.request())
        .and_then(|request| request.uri())
        .map(|uri| uri.to_string())
        .unwrap_or_default();
      browser_log(format!("policy: new window uri={uri:?}"));
      if uri.is_empty() || is_allowed_navigation(&uri) {
        decision.use_();
      } else {
        browser_log(format!("policy: blocked new window uri={uri:?}"));
        if uri.starts_with("mailto:") || uri.starts_with("tel:") {
          let _ = gtk::show_uri_on_window(None::<&gtk::Window>, &uri, 0);
        }
        decision.ignore();
      }
      return true;
    }
    if decision_type != PolicyDecisionType::NavigationAction {
      return false;
    }
    let Some(navigation) = decision.downcast_ref::<NavigationPolicyDecision>() else {
      return false;
    };
    let uri = navigation
      .navigation_action()
      .and_then(|action| action.request())
      .and_then(|request| request.uri())
      .map(|uri| uri.to_string())
      .unwrap_or_default();
    browser_log(format!("navigation: uri={uri:?}"));
    if is_allowed_navigation(&uri) {
      return false;
    }
    browser_log(format!("navigation: blocked uri={uri:?}"));
    if uri.starts_with("mailto:") || uri.starts_with("tel:") {
      let _ = gtk::show_uri_on_window(None::<&gtk::Window>, &uri, 0);
    }
    true
  });
}

fn add_context_action<F: Fn() + 'static>(menu: &gtk::Menu, label: &str, action: F) {
  let item = gtk::MenuItem::with_label(label);
  item.connect_activate(move |_| action());
  menu.append(&item);
}

fn attach_context_menu(view: &WebView, parent: &gtk::Window, context: &WebContext) {
  let parent = parent.clone();
  let context = context.clone();
  view.connect_context_menu(move |view, _menu, event, hit| {
    let menu = gtk::Menu::new();

    let back = gtk::MenuItem::with_label("Back");
    back.set_sensitive(view.can_go_back());
    let back_view = view.clone();
    back.connect_activate(move |_| back_view.go_back());
    menu.append(&back);
    let forward = gtk::MenuItem::with_label("Forward");
    forward.set_sensitive(view.can_go_forward());
    let forward_view = view.clone();
    forward.connect_activate(move |_| forward_view.go_forward());
    menu.append(&forward);
    let reload_view = view.clone();
    add_context_action(&menu, "Reload", move || reload_view.reload());
    menu.append(&gtk::SeparatorMenuItem::new());

    if let Some(link) = hit.link_uri() {
      let link = link.to_string();
      let link_window = link.clone();
      let link_parent = parent.clone();
      let link_context = context.clone();
      add_context_action(&menu, "Open Link in New Window", move || {
        let (_, popup) = create_popup(&link_parent, &link_context);
        popup.load_uri(&link_window);
      });
      let system_link = link.clone();
      let system_parent = parent.clone();
      add_context_action(&menu, "Open Link in System Browser", move || {
        let _ = gtk::show_uri_on_window(Some(&system_parent), &system_link, 0);
      });
      add_context_action(&menu, "Copy Link Address", move || {
        gtk::Clipboard::get(&gtk::gdk::SELECTION_CLIPBOARD).set_text(&link);
      });
      menu.append(&gtk::SeparatorMenuItem::new());
    }

    if let Some(image) = hit.image_uri() {
      let image = image.to_string();
      let image_window = image.clone();
      let image_parent = parent.clone();
      let image_context = context.clone();
      add_context_action(&menu, "Open Image in New Window", move || {
        let (_, popup) = create_popup(&image_parent, &image_context);
        popup.load_uri(&image_window);
      });
      add_context_action(&menu, "Copy Image Address", move || {
        gtk::Clipboard::get(&gtk::gdk::SELECTION_CLIPBOARD).set_text(&image);
      });
      menu.append(&gtk::SeparatorMenuItem::new());
    }

    if hit.context_is_editable() {
      let cut_view = view.clone();
      add_context_action(&menu, "Cut", move || {
        cut_view.execute_editing_command("Cut")
      });
      let copy_view = view.clone();
      add_context_action(&menu, "Copy", move || {
        copy_view.execute_editing_command("Copy")
      });
      let paste_view = view.clone();
      add_context_action(&menu, "Paste", move || {
        paste_view.execute_editing_command("Paste")
      });
      let select_view = view.clone();
      add_context_action(&menu, "Select All", move || {
        select_view.execute_editing_command("SelectAll")
      });
      menu.append(&gtk::SeparatorMenuItem::new());
    } else if hit.context_is_selection() {
      let copy_view = view.clone();
      add_context_action(&menu, "Copy", move || {
        copy_view.execute_editing_command("Copy")
      });
      menu.append(&gtk::SeparatorMenuItem::new());
    }

    let zoom_out_view = view.clone();
    add_context_action(&menu, "Zoom Out", move || {
      set_browser_zoom(
        &zoom_out_view,
        zoom_out_view.zoom_level() - BROWSER_ZOOM_STEP,
      );
    });
    let zoom_reset_view = view.clone();
    add_context_action(&menu, "Reset Zoom", move || {
      set_browser_zoom(&zoom_reset_view, 1.0)
    });
    let zoom_in_view = view.clone();
    add_context_action(&menu, "Zoom In", move || {
      set_browser_zoom(&zoom_in_view, zoom_in_view.zoom_level() + BROWSER_ZOOM_STEP);
    });

    menu.show_all();
    menu.popup_at_pointer(Some(event));
    true
  });
}

fn create_popup(parent: &gtk::Window, context: &WebContext) -> (gtk::Window, WebView) {
  let window = gtk::Window::new(gtk::WindowType::Toplevel);
  window.set_title("Papyri — Web");
  window.set_default_size(980, 720);
  window.set_transient_for(Some(parent));
  window.set_destroy_with_parent(true);
  window.set_position(gtk::WindowPosition::CenterOnParent);

  let view = WebView::builder().web_context(context).build();
  configure_browser_view(&view);
  view.set_hexpand(true);
  view.set_vexpand(true);
  browser_log("popup: window created");

  let toolbar = gtk::Box::new(gtk::Orientation::Horizontal, 4);
  toolbar.set_border_width(6);
  let back = gtk::Button::with_label("←");
  back.set_tooltip_text(Some("Back"));
  back.set_relief(gtk::ReliefStyle::None);
  back.set_sensitive(false);
  let forward = gtk::Button::with_label("→");
  forward.set_tooltip_text(Some("Forward"));
  forward.set_relief(gtk::ReliefStyle::None);
  forward.set_sensitive(false);
  let reload = gtk::Button::with_label("⟳");
  reload.set_tooltip_text(Some("Reload"));
  reload.set_relief(gtk::ReliefStyle::None);
  let zoom_out = gtk::Button::with_label("−");
  zoom_out.set_tooltip_text(Some("Zoom out web page"));
  zoom_out.set_relief(gtk::ReliefStyle::None);
  let zoom_label = gtk::Button::with_label("100%");
  zoom_label.set_tooltip_text(Some("Reset web page zoom"));
  zoom_label.set_relief(gtk::ReliefStyle::None);
  let zoom_in = gtk::Button::with_label("+");
  zoom_in.set_tooltip_text(Some("Zoom in web page"));
  zoom_in.set_relief(gtk::ReliefStyle::None);
  let address = gtk::Entry::new();
  address.set_hexpand(true);
  address.set_width_chars(30);
  address.set_placeholder_text(Some("Search or enter an address"));
  let open_external = gtk::Button::with_label("↗");
  open_external.set_tooltip_text(Some("Open in system browser"));
  open_external.set_relief(gtk::ReliefStyle::None);
  let close = gtk::Button::with_label("✕");
  close.set_tooltip_text(Some("Close window"));
  close.set_relief(gtk::ReliefStyle::None);

  toolbar.pack_start(&back, false, false, 0);
  toolbar.pack_start(&forward, false, false, 0);
  toolbar.pack_start(&reload, false, false, 0);
  toolbar.pack_start(&address, true, true, 0);
  toolbar.pack_start(&zoom_out, false, false, 0);
  toolbar.pack_start(&zoom_label, false, false, 0);
  toolbar.pack_start(&zoom_in, false, false, 0);
  toolbar.pack_start(&open_external, false, false, 0);
  toolbar.pack_start(&close, false, false, 0);

  let container = gtk::Box::new(gtk::Orientation::Vertical, 0);
  container.pack_start(&toolbar, false, false, 0);
  container.pack_start(&view, true, true, 0);
  window.add(&container);

  attach_navigation_policy(&view);
  attach_context_menu(&view, &window, context);

  let title_window = window.clone();
  view.connect_notify_local(Some("title"), move |view, _| {
    if let Some(title) = view.title() {
      browser_log(format!("popup: title={title:?}"));
      title_window.set_title(&format!("{title} — Papyri"));
    }
  });

  let address_uri = address.clone();
  view.connect_notify_local(Some("uri"), move |view, _| {
    if !address_uri.has_focus() {
      address_uri.set_text(&view.uri().unwrap_or_default());
    }
  });

  let back_state = back.clone();
  let forward_state = forward.clone();
  let address_state = address.clone();
  view.connect_load_changed(move |view, _| {
    back_state.set_sensitive(view.can_go_back());
    forward_state.set_sensitive(view.can_go_forward());
    if !address_state.has_focus() {
      address_state.set_text(&view.uri().unwrap_or_default());
    }
  });

  let back_view = view.clone();
  back.connect_clicked(move |_| back_view.go_back());
  let forward_view = view.clone();
  forward.connect_clicked(move |_| forward_view.go_forward());
  let reload_view = view.clone();
  reload.connect_clicked(move |_| reload_view.reload());
  let zoom_out_view = view.clone();
  zoom_out.connect_clicked(move |_| {
    set_browser_zoom(
      &zoom_out_view,
      zoom_out_view.zoom_level() - BROWSER_ZOOM_STEP,
    );
  });
  let zoom_reset_view = view.clone();
  zoom_label.connect_clicked(move |_| set_browser_zoom(&zoom_reset_view, 1.0));
  let zoom_in_view = view.clone();
  zoom_in.connect_clicked(move |_| {
    set_browser_zoom(&zoom_in_view, zoom_in_view.zoom_level() + BROWSER_ZOOM_STEP);
  });
  let zoom_label_state = zoom_label.clone();
  let zoom_out_state = zoom_out.clone();
  let zoom_in_state = zoom_in.clone();
  view.connect_notify_local(Some("zoom-level"), move |view, _| {
    let zoom = view.zoom_level();
    zoom_label_state.set_label(&format!("{}%", browser_zoom_percent(zoom)));
    zoom_out_state.set_sensitive(zoom > BROWSER_MIN_ZOOM + 0.001);
    zoom_in_state.set_sensitive(zoom < BROWSER_MAX_ZOOM - 0.001);
  });

  let address_view = view.clone();
  address.connect_activate(move |entry| {
    let target = popup_target(&entry.text());
    if let Some(target) = target {
      address_view.load_uri(&target);
    } else {
      entry.set_text(&address_view.uri().unwrap_or_default());
    }
  });

  let external_view = view.clone();
  let external_window = window.clone();
  open_external.connect_clicked(move |_| {
    let uri = external_view.uri().unwrap_or_default();
    if !uri.is_empty() {
      let _ = gtk::show_uri_on_window(Some(&external_window), &uri, 0);
    }
  });

  let close_window = window.clone();
  close.connect_clicked(move |_| close_window.close());
  let script_close_window = window.clone();
  view.connect_close(move |_| {
    browser_log("popup: page requested window.close");
    script_close_window.close();
  });

  let parent_window = window.clone();
  let popup_context = context.clone();
  view.connect_create(move |_, action| {
    let uri = action
      .request()
      .and_then(|request| request.uri())
      .map(|uri| uri.to_string())
      .unwrap_or_default();
    browser_log(format!(
      "popup: window.open uri={uri:?} user_gesture={} nav_type={:?}",
      action.is_user_gesture(),
      action.navigation_type()
    ));
    if !uri.is_empty() && !is_allowed_url(&uri) {
      if uri.starts_with("mailto:") || uri.starts_with("tel:") {
        let _ = gtk::show_uri_on_window(Some(&parent_window), &uri, 0);
      }
      return None;
    }
    let (_, popup_view) = create_popup(&parent_window, &popup_context);
    Some(popup_view.upcast())
  });

  if let Some(properties) = view.window_properties() {
    let geometry = properties.geometry();
    browser_log(format!(
      "popup: requested geometry={}x{} fullscreen={}",
      geometry.width(),
      geometry.height(),
      properties.is_fullscreen()
    ));
    if geometry.width() > 200 && geometry.height() > 200 {
      window.set_default_size(geometry.width(), geometry.height() + 44);
    }
    if properties.is_fullscreen() {
      window.fullscreen();
    }
  }

  POPUPS.with(|popups| popups.borrow_mut().push(window.clone()));
  let pointer = window.as_ptr() as usize;
  window.connect_destroy(move |_| {
    browser_log("popup: destroyed");
    POPUPS.with(|popups| {
      popups
        .borrow_mut()
        .retain(|window| window.as_ptr() as usize != pointer);
    });
  });
  window.show_all();
  window.present();
  view.grab_focus();
  browser_log(format!("popup: shown uri={:?}", view.uri()));
  (window, view)
}

fn popup_target(value: &str) -> Option<String> {
  let trimmed = value.trim();
  if trimmed.is_empty() {
    return None;
  }
  if trimmed.starts_with("http://")
    || trimmed.starts_with("https://")
    || trimmed.eq_ignore_ascii_case("about:blank")
  {
    return normalize_url(trimmed).ok();
  }
  let local_host = trimmed
    .split(['/', ':'])
    .next()
    .is_some_and(|host| matches!(host, "localhost" | "127.0.0.1" | "[::1]"));
  if local_host {
    return normalize_url(&format!("http://{trimmed}")).ok();
  }
  if !trimmed.contains(char::is_whitespace)
    && trimmed
      .split(['/', ':', '?', '#'])
      .next()
      .is_some_and(|host| host.contains('.'))
  {
    return normalize_url(&format!("https://{trimmed}")).ok();
  }
  let query = glib::uri_escape_string(trimmed, None::<&str>, true);
  normalize_url(&format!("https://duckduckgo.com/?q={query}")).ok()
}

#[tauri::command]
pub async fn browser_capture(
  app: AppHandle,
  rect: Option<crate::screenshot::NormalizedRect>,
  output: Option<String>,
  clipboard: bool,
) -> Result<Value, String> {
  let (sender, receiver) = std::sync::mpsc::channel();
  app
    .run_on_main_thread(move || {
      let result = BROWSER.with(|cell| {
        let borrowed = cell.borrow();
        let host = borrowed
          .as_ref()
          .ok_or_else(|| "The browser panel is not available.".to_string())?;
        let view = host
          .active_view()
          .ok_or_else(|| "No website tab is active.".to_string())?;
        let drawable = view
          .window()
          .ok_or_else(|| "The browser view has no drawable surface.".to_string())?;
        let width = view.allocated_width();
        let height = view.allocated_height();
        let pixbuf = drawable
          .pixbuf(0, 0, width, height)
          .ok_or_else(|| "Could not capture the browser surface.".to_string())?;
        let cropped = match rect {
          None => pixbuf,
          Some(rect) => {
            let left = (rect.x.clamp(0.0, 1.0) * width as f64).floor() as i32;
            let top = (rect.y.clamp(0.0, 1.0) * height as f64).floor() as i32;
            let right = ((rect.x + rect.width).clamp(0.0, 1.0) * width as f64).ceil() as i32;
            let bottom = ((rect.y + rect.height).clamp(0.0, 1.0) * height as f64).ceil() as i32;
            pixbuf.new_subpixbuf(left, top, (right - left).max(1), (bottom - top).max(1))
          }
        };
        cropped
          .save_to_bufferv("png", &[])
          .map_err(|error| error.to_string())
      });
      let _ = sender.send(result);
    })
    .map_err(|error| format!("Could not capture the browser: {error}"))?;
  let bytes = receiver
    .recv_timeout(std::time::Duration::from_secs(10))
    .map_err(|_| "Browser capture timed out.".to_string())??;
  crate::screenshot::store_png(bytes, output, clipboard, "browser")
}

#[tauri::command]
pub async fn browser_dom(app: AppHandle, action: String, params: Value) -> Result<Value, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let (sender, receiver) = std::sync::mpsc::channel();
    app
      .run_on_main_thread(move || {
        let result = BROWSER.with(|cell| {
          let borrowed = cell.borrow();
          let host = borrowed
            .as_ref()
            .ok_or_else(|| "The browser panel is not available.".to_string())?;
          let view = host
            .active_view()
            .ok_or_else(|| "No website tab is active.".to_string())?;
          let action = serde_json::to_string(&action).map_err(|error| error.to_string())?;
          let params = serde_json::to_string(&params).map_err(|error| error.to_string())?;
          let script = format!("window.__papyriDom.invoke({action}, {params})");
          let callback_sender = sender.clone();
          view.evaluate_javascript(
            &script,
            None,
            None,
            None::<&gtk::gio::Cancellable>,
            move |result| {
              let output = result
                .map_err(|error| error.to_string())
                .and_then(|value| {
                  value
                    .to_json(0)
                    .ok_or_else(|| "The page returned an invalid DOM result.".to_string())
                })
                .and_then(|json| serde_json::from_str(&json).map_err(|error| error.to_string()));
              let _ = callback_sender.send(output);
            },
          );
          Ok(())
        });
        if let Err(error) = result {
          let _ = sender.send(Err(error));
        }
      })
      .map_err(|error| format!("Could not access the browser: {error}"))?;
    receiver
      .recv_timeout(std::time::Duration::from_secs(10))
      .map_err(|_| "The browser DOM request timed out.".to_string())?
  })
  .await
  .map_err(|error| error.to_string())?
}

fn insert_quote(view: &WebView, text: &str) {
  let quoted = text
    .lines()
    .map(|line| format!("> {line}"))
    .collect::<Vec<_>>()
    .join("\n");
  let prompt = format!("{quoted}\n\n");
  let text_json = serde_json::to_string(&prompt).unwrap_or_else(|_| "\"\"".to_string());
  let script = format!(
    r#"
(function () {{
  const text = {text_json};
  let attempts = 0;
  function apply() {{
    const candidates = [...document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')]
      .filter((element) => {{
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 20 && rect.height > 10 && style.visibility !== 'hidden' && style.display !== 'none';
      }});
    const target = candidates[candidates.length - 1];
    if (!target) {{
      if (attempts++ < 12) setTimeout(apply, 250);
      return;
    }}
    target.focus();
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {{
      const prototype = target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      const next = (target.value ? target.value + '\n\n' : '') + text;
      if (setter) setter.call(target, next);
      else target.value = next;
      if (target instanceof HTMLTextAreaElement) target.setSelectionRange(next.length, next.length);
      target.dispatchEvent(new InputEvent('input', {{ bubbles: true, inputType: 'insertText', data: text }}));
    }} else {{
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(target);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      const before = target.innerText;
      document.execCommand('insertText', false, text);
      if (target.innerText === before) {{
        target.innerText = before + text;
        const end = document.createRange();
        end.selectNodeContents(target);
        end.collapse(false);
        selection.removeAllRanges();
        selection.addRange(end);
      }}
      target.dispatchEvent(new InputEvent('input', {{ bubbles: true, inputType: 'insertText', data: text }}));
    }}
    target.scrollIntoView({{ block: 'nearest' }});
    console.info('Papyri: inserted quote into composer');
    return 'inserted';
  }}
  return apply();
}})();
"#
  );
  #[allow(deprecated)]
  view.run_javascript(
    &script,
    None::<&webkit2gtk::gio::Cancellable>,
    |result| match result {
      Ok(value) => {
        let status = value
          .js_value()
          .map(|value| value.to_string())
          .unwrap_or_default();
        browser_log(format!("quote: composer insertion -> {status}"));
      }
      Err(error) => browser_log(format!("quote: could not focus composer: {error}")),
    },
  );
}

impl BrowserHost {
  fn active_view(&self) -> Option<WebView> {
    self
      .active
      .borrow()
      .as_ref()
      .and_then(|site| self.views.get(site).cloned())
  }

  fn ensure_view(&mut self, site: &str) -> Result<WebView, String> {
    let home = site_home(site).ok_or_else(|| format!("Unknown browser site: {site}"))?;
    if let Some(view) = self.views.get(site) {
      return Ok(view.clone());
    }

    let view = WebView::builder().web_context(&self.context).build();
    configure_browser_view(&view);
    view.connect_notify_local(Some("uri"), |view, _| update_automatic_popups(view));
    view.connect_load_changed(|view, _| update_automatic_popups(view));
    update_automatic_popups(&view);
    view.set_hexpand(true);
    view.set_vexpand(true);
    view.show();
    self.stack.add_named(&view, site);

    let app = self.app.clone();
    let active = self.active.clone();
    let site_id = site.to_string();
    let pending_quotes = self.pending_quotes.clone();
    let quote_site = site.to_string();
    view.connect_load_changed(move |view, event| {
      browser_log(format!(
        "site={site_id}: load event={event:?} uri={:?}",
        view.uri()
      ));
      emit_state(&app, &active, &site_id, view, None);
      if event == LoadEvent::Finished {
        if let Some(text) = pending_quotes.borrow_mut().remove(&quote_site) {
          insert_quote(view, &text);
        }
      }
    });

    for property in ["uri", "title", "zoom-level"] {
      let app = self.app.clone();
      let active = self.active.clone();
      let site_id = site.to_string();
      view.connect_notify_local(Some(property), move |view, _| {
        emit_state(&app, &active, &site_id, view, None);
      });
    }

    let app = self.app.clone();
    let active = self.active.clone();
    let site_id = site.to_string();
    view.connect_load_failed(move |view, event, uri, error| {
      browser_log(format!(
        "site={site_id}: load failed event={event:?} uri={uri:?} error={error}"
      ));
      emit_state(
        &app,
        &active,
        &site_id,
        view,
        Some(format!("Could not load {uri}: {error}")),
      );
      false
    });

    let parent = self.window.clone();
    let context = self.context.clone();
    let popup_app = self.app.clone();
    let create_site = site.to_string();
    view.connect_create(move |_, action| {
      let uri = action
        .request()
        .and_then(|request| request.uri())
        .map(|uri| uri.to_string())
        .unwrap_or_default();
      browser_log(format!(
        "site={create_site}: window.open uri={uri:?} user_gesture={} nav_type={:?}",
        action.is_user_gesture(),
        action.navigation_type()
      ));
      if !uri.is_empty() && !is_allowed_url(&uri) {
        browser_log(format!("site={create_site}: blocked popup uri={uri:?}"));
        open_external(&popup_app, &uri);
        return None;
      }
      let (_, popup_view) = create_popup(&parent, &context);
      Some(popup_view.upcast())
    });

    attach_navigation_policy(&view);
    attach_context_menu(&view, &self.window, &self.context);

    self.views.insert(site.to_string(), view.clone());
    browser_log(format!("site={site}: view created home={home:?}"));
    Ok(view)
  }

  fn activate(&mut self, site: &str, view: &WebView) {
    *self.active.borrow_mut() = Some(site.to_string());
    self.stack.set_visible(self.visible);
    view.show();
    self.stack.set_visible_child(view);
    self.stack.queue_resize();
    apply_bounds(&self.stack, self.bounds);
    if self.visible {
      view.grab_focus();
    }
    emit_state(&self.app, &self.active, site, view, None);
  }

  fn select(&mut self, site: &str) -> Result<(), String> {
    let home = site_home(site).ok_or_else(|| format!("Unknown browser site: {site}"))?;
    let view = self.ensure_view(site)?;
    self.activate(site, &view);
    if view.uri().is_none() {
      view.load_uri(home);
    }
    Ok(())
  }

  fn show(&mut self, site: &str, url: Option<&str>) -> Result<(), String> {
    let home = site_home(site).ok_or_else(|| format!("Unknown browser site: {site}"))?;
    let target = url
      .filter(|value| !value.is_empty())
      .unwrap_or(home)
      .to_string();
    let view = self.ensure_view(site)?;
    self.activate(site, &view);
    if view.uri().is_none() || view.uri().is_some_and(|current| current.as_str() != target) {
      view.load_uri(&target);
    } else {
      emit_state(&self.app, &self.active, site, &view, None);
    }
    Ok(())
  }

  fn navigate(&mut self, url: &str) {
    let Some(view) = self.active_view() else {
      return;
    };
    if view.uri().is_some_and(|current| current.as_str() == url) {
      emit_state(
        &self.app,
        &self.active,
        self.active.borrow().as_deref().unwrap_or_default(),
        &view,
        None,
      );
      return;
    }
    view.load_uri(url);
  }

  fn quote(&mut self, site: &str, text: &str) -> Result<(), String> {
    let home = site_home(site).ok_or_else(|| format!("Unknown browser site: {site}"))?;
    let view = self.ensure_view(site)?;
    self.activate(site, &view);
    if view.is_loading() || view.uri().is_none() {
      self
        .pending_quotes
        .borrow_mut()
        .insert(site.to_string(), text.to_string());
      if view.uri().is_none() {
        view.load_uri(home);
      }
    } else {
      insert_quote(&view, text);
    }
    Ok(())
  }

  fn search_wikipedia(&mut self, text: &str) -> Result<(), String> {
    let query = glib::uri_escape_string(text, None::<&str>, true);
    let url = format!("https://en.wikipedia.org/w/index.php?search={query}");
    self.show(SITE_WIKIPEDIA, Some(&url))
  }

  fn open_window(&mut self, url: &str) {
    let (_, view) = create_popup(&self.window, &self.context);
    view.load_uri(url);
  }

  fn set_zoom(&mut self, zoom: f64) {
    if let Some(view) = self.active_view() {
      set_browser_zoom(&view, zoom);
    }
  }

  fn set_visible(&mut self, visible: bool) {
    self.visible = visible;
    self.stack.set_visible(visible);
    let active = self.active.borrow().clone();
    if let Some(view) = self.active_view() {
      if visible {
        view.show();
        self.stack.set_visible_child(&view);
        self.stack.queue_resize();
        apply_bounds(&self.stack, self.bounds);
        view.grab_focus();
        emit_state(
          &self.app,
          &self.active,
          active.as_deref().unwrap_or_default(),
          &view,
          None,
        );
      } else {
        self.main_view.grab_focus();
      }
    }
  }

  fn set_bounds(&mut self, bounds: (i32, i32, i32, i32)) {
    self.bounds = bounds;
    apply_bounds(&self.stack, bounds);
  }
}

fn apply_bounds(widget: &impl IsA<gtk::Widget>, (x, y, width, height): (i32, i32, i32, i32)) {
  widget.set_margin_start(x);
  widget.set_margin_top(y);
  widget.set_size_request(width, height);
}

fn with_host(action: impl FnOnce(&mut BrowserHost)) {
  BROWSER.with(|slot| {
    if let Some(host) = slot.borrow_mut().as_mut() {
      action(host);
    }
  });
}

fn dispatch(app: &AppHandle, action: impl FnOnce() + Send + 'static) {
  let _ = app.run_on_main_thread(action);
}

pub fn install(
  window: &tauri::WebviewWindow,
  app: AppHandle,
  data_dir: PathBuf,
  cache_dir: PathBuf,
) -> Result<(), String> {
  let vbox = window
    .default_vbox()
    .map_err(|error| format!("The main webview container is unavailable: {error}"))?;
  let main_view = vbox
    .children()
    .into_iter()
    .find_map(|child| child.downcast::<WebView>().ok())
    .ok_or("The main webview is unavailable")?;

  let overlay = gtk::Overlay::new();
  vbox.remove(&main_view);
  vbox.pack_start(&overlay, true, true, 0);
  let main_focus = main_view.clone().upcast::<gtk::Widget>();
  overlay.add(&main_view);
  let stack = gtk::Stack::new();
  stack.set_halign(gtk::Align::Start);
  stack.set_valign(gtk::Align::Start);
  stack.set_hexpand(false);
  stack.set_vexpand(false);
  stack.set_size_request(1, 1);
  stack.set_visible(false);
  overlay.add_overlay(&stack);
  overlay.show_all();

  std::fs::create_dir_all(&data_dir)
    .map_err(|error| format!("Could not create browser data directory: {error}"))?;
  std::fs::create_dir_all(&cache_dir)
    .map_err(|error| format!("Could not create browser cache directory: {error}"))?;
  let data_manager = WebsiteDataManager::builder()
    .base_data_directory(data_dir.to_string_lossy().to_string())
    .base_cache_directory(cache_dir.to_string_lossy().to_string())
    .build();
  if let Some(cookies) = data_manager.cookie_manager() {
    let cookie_path = data_dir.join("cookies.sqlite");
    cookies.set_persistent_storage(
      &cookie_path.to_string_lossy(),
      CookiePersistentStorage::Sqlite,
    );
    cookies.set_accept_policy(CookieAcceptPolicy::Always);
    browser_log(format!("cookies: persistent storage {cookie_path:?}"));
  }
  let context = WebContext::with_website_data_manager(&data_manager);
  let main_window = main_view
    .toplevel()
    .and_then(|widget| widget.downcast::<gtk::Window>().ok())
    .ok_or("The browser host window is unavailable")?;

  BROWSER.with(|slot| {
    *slot.borrow_mut() = Some(BrowserHost {
      app,
      window: main_window,
      stack,
      main_view: main_focus,
      context,
      views: HashMap::new(),
      active: Rc::new(RefCell::new(None)),
      pending_quotes: Rc::new(RefCell::new(HashMap::new())),
      bounds: (0, 0, 1, 1),
      visible: false,
    });
  });
  Ok(())
}

#[tauri::command]
pub fn browser_show(app: AppHandle, site: String, url: Option<String>) -> Result<(), String> {
  let site = normalize_site(&site)?;
  let url = url.map(|value| normalize_url(&value)).transpose()?;
  browser_log(format!("show: site={site} url={url:?}"));
  dispatch(&app, move || {
    with_host(|host| {
      if let Err(error) = host.show(&site, url.as_deref()) {
        browser_log(format!("show failed: {error}"));
      }
    });
  });
  Ok(())
}

#[tauri::command]
pub fn browser_select(app: AppHandle, site: String) -> Result<(), String> {
  let site = normalize_site(&site)?;
  browser_log(format!("select: {site}"));
  dispatch(&app, move || {
    with_host(|host| {
      if let Err(error) = host.select(&site) {
        browser_log(format!("select failed: {error}"));
      }
    });
  });
  Ok(())
}

#[tauri::command]
pub fn browser_open_window(app: AppHandle, url: Option<String>) -> Result<(), String> {
  let url = normalize_url(url.as_deref().unwrap_or(DEFAULT_URL))?;
  browser_log(format!("open window: {url:?}"));
  dispatch(&app, move || {
    with_host(|host| host.open_window(&url));
  });
  Ok(())
}

#[tauri::command]
pub fn browser_set_zoom(app: AppHandle, zoom: f64) {
  let zoom = clamp_browser_zoom(zoom);
  browser_log(format!("zoom: {:.0}%", zoom * 100.0));
  dispatch(&app, move || {
    with_host(|host| host.set_zoom(zoom));
  });
}

#[tauri::command]
pub fn browser_quote(app: AppHandle, site: String, text: String) -> Result<(), String> {
  let site = normalize_site(&site)?;
  if text.trim().is_empty() || text.len() > 100_000 {
    return Err("The selected text is empty or too large.".into());
  }
  dispatch(&app, move || {
    with_host(|host| {
      if let Err(error) = host.quote(&site, &text) {
        browser_log(format!("quote failed: {error}"));
      }
    });
  });
  Ok(())
}

#[tauri::command]
pub fn browser_search_wikipedia(app: AppHandle, text: String) -> Result<(), String> {
  let text = text.trim();
  if text.is_empty() || text.len() > 20_000 {
    return Err("The selected text is empty or too large.".into());
  }
  let text = text.to_string();
  dispatch(&app, move || {
    with_host(|host| {
      if let Err(error) = host.search_wikipedia(&text) {
        browser_log(format!("Wikipedia search failed: {error}"));
      }
    });
  });
  Ok(())
}

#[tauri::command]
pub fn browser_navigate(app: AppHandle, url: String) -> Result<(), String> {
  let url = normalize_url(&url)?;
  browser_log(format!("navigate: {url:?}"));
  dispatch(&app, move || {
    with_host(|host| host.navigate(&url));
  });
  Ok(())
}

#[tauri::command]
pub fn browser_back(app: AppHandle) {
  dispatch(&app, || {
    with_host(|host| {
      if let Some(view) = host.active_view() {
        view.go_back();
      }
    })
  });
}

#[tauri::command]
pub fn browser_forward(app: AppHandle) {
  dispatch(&app, || {
    with_host(|host| {
      if let Some(view) = host.active_view() {
        view.go_forward();
      }
    })
  });
}

#[tauri::command]
pub fn browser_reload(app: AppHandle) {
  dispatch(&app, || {
    with_host(|host| {
      if let Some(view) = host.active_view() {
        view.reload();
      }
    })
  });
}

#[tauri::command]
pub fn browser_stop(app: AppHandle) {
  dispatch(&app, || {
    with_host(|host| {
      if let Some(view) = host.active_view() {
        view.stop_loading();
      }
    })
  });
}

#[tauri::command]
pub fn browser_set_visible(app: AppHandle, visible: bool) {
  dispatch(&app, move || {
    with_host(|host| host.set_visible(visible));
  });
}

#[tauri::command]
pub fn browser_set_bounds(app: AppHandle, x: i32, y: i32, width: i32, height: i32) {
  let bounds = (x.max(0), y.max(0), width.max(1), height.max(1));
  dispatch(&app, move || {
    with_host(|host| host.set_bounds(bounds));
  });
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn rejects_non_web_addresses() {
    assert!(normalize_url("https://chatgpt.com/").is_ok());
    assert!(normalize_url("HTTPS://chatgpt.com/").is_ok());
    assert!(normalize_url("http://localhost:3000").is_ok());
    assert!(normalize_url("file:///etc/passwd").is_err());
    assert!(normalize_url("javascript:alert(1)").is_err());
    assert!(normalize_url("").is_err());
  }

  #[test]
  fn normalizes_popup_addresses() {
    assert_eq!(
      popup_target("example.com/path").as_deref(),
      Some("https://example.com/path")
    );
    assert_eq!(
      popup_target("http://localhost:3000").as_deref(),
      Some("http://localhost:3000")
    );
    assert!(!popup_target("file:///etc/passwd")
      .unwrap_or_default()
      .starts_with("file:"));
    assert!(popup_target("hello world")
      .unwrap_or_default()
      .starts_with("https://duckduckgo.com/?q=hello"));
    assert_eq!(popup_target(""), None);
  }
}

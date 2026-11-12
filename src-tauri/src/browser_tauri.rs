//! Embedded browser panel for macOS and Windows using Tauri child webviews.
//!
//! Linux keeps the GTK/WebKitGTK implementation in `browser.rs`; this module
//! uses the same Tauri multi-webview API on the other desktop platforms so the
//! panel, tabs, navigation, zoom, DOM bridge, and popups behave consistently.

use serde::Serialize;
use serde_json::Value;
use std::{
  collections::HashMap,
  path::PathBuf,
  sync::{mpsc, Arc, Mutex},
  time::Duration,
};
use tauri::{
  webview::{NewWindowResponse, PageLoadEvent, Webview, WebviewBuilder},
  AppHandle, Emitter, LogicalPosition, LogicalSize, Rect, WebviewUrl, Window,
};

pub const BROWSER_EVENT: &str = "papyri://browser";
pub const DEFAULT_URL: &str = "https://chatgpt.com/";

pub const SITE_CHATGPT: &str = "chatgpt";
pub const SITE_WIKIPEDIA: &str = "wikipedia";
pub const SITE_GEMINI: &str = "gemini";

const MIN_ZOOM: f64 = 0.25;
const MAX_ZOOM: f64 = 5.0;
const DOM_TIMEOUT: Duration = Duration::from_secs(10);
#[cfg(target_os = "macos")]
const DATA_STORE_ID: [u8; 16] = *b"papyri-browser01";

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

fn clamp_zoom(zoom: f64) -> f64 {
  if zoom.is_finite() {
    zoom.clamp(MIN_ZOOM, MAX_ZOOM)
  } else {
    1.0
  }
}

fn is_allowed_url(url: &str) -> bool {
  let trimmed = url.trim();
  let lower = trimmed.to_ascii_lowercase();
  !trimmed.is_empty()
    && ["https://", "http://", "about:blank"]
      .iter()
      .any(|prefix| lower.starts_with(prefix))
}

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

fn browser_log(message: impl AsRef<str>) {
  if cfg!(debug_assertions) {
    eprintln!("[browser] {}", message.as_ref());
  }
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

struct Host {
  app: AppHandle,
  window: Window,
  data_dir: PathBuf,
  views: HashMap<String, Webview>,
  active: Arc<Mutex<Option<String>>>,
  zoom: Arc<Mutex<f64>>,
  bounds: (f64, f64, f64, f64),
  visible: bool,
}

static HOST: Mutex<Option<Host>> = Mutex::new(None);

fn with_host<T>(action: impl FnOnce(&mut Host) -> Result<T, String>) -> Result<T, String> {
  let mut host = HOST
    .lock()
    .map_err(|_| "The browser panel is unavailable.".to_string())?;
  action(
    host
      .as_mut()
      .ok_or_else(|| "The browser panel is unavailable.".to_string())?,
  )
}

fn emit_state(
  app: &AppHandle,
  active: &Arc<Mutex<Option<String>>>,
  site: &str,
  view: &Webview,
  title: String,
  loading: bool,
  zoom: f64,
  error: Option<String>,
) {
  if active
    .lock()
    .map(|value| value.as_deref() != Some(site))
    .unwrap_or(true)
  {
    return;
  }
  let state = BrowserState {
    site: site.to_string(),
    url: view.url().map(|url| url.to_string()).unwrap_or_default(),
    title,
    loading,
    can_go_back: true,
    can_go_forward: false,
    zoom,
    error,
  };
  let _ = app.emit_to("main", BROWSER_EVENT, state);
}

pub fn install(
  window: &tauri::WebviewWindow,
  app: AppHandle,
  data_dir: PathBuf,
  _cache_dir: PathBuf,
) -> Result<(), String> {
  std::fs::create_dir_all(&data_dir)
    .map_err(|error| format!("Could not create browser data directory: {error}"))?;
  browser_log("installed Tauri child-webview browser panel");
  *HOST
    .lock()
    .map_err(|_| "The browser panel is unavailable.".to_string())? = Some(Host {
    app,
    window: window.as_ref().window(),
    data_dir,
    views: HashMap::new(),
    active: Arc::new(Mutex::new(None)),
    zoom: Arc::new(Mutex::new(1.0)),
    bounds: (0.0, 0.0, 1.0, 1.0),
    visible: false,
  });
  Ok(())
}

impl Host {
  fn active_view(&self) -> Option<Webview> {
    self
      .active
      .lock()
      .ok()
      .and_then(|site| site.as_ref().and_then(|site| self.views.get(site).cloned()))
  }

  fn ensure_view(&mut self, site: &str) -> Result<(), String> {
    if self.views.contains_key(site) {
      return Ok(());
    }
    let home = site_home(site).ok_or_else(|| format!("Unknown browser site: {site}"))?;
    let url = home
      .parse()
      .map_err(|error| format!("Invalid browser address: {error}"))?;
    let label = format!("papyri-browser-{site}");
    let active = self.active.clone();
    let zoom = self.zoom.clone();
    let app = self.app.clone();
    let site_id = site.to_string();
    let mut builder = WebviewBuilder::new(label, WebviewUrl::External(url))
      .initialization_script(include_str!("browser_dom.js"))
      .on_navigation(|url| is_allowed_navigation(url.as_str()))
      .on_new_window({
        let app = app.clone();
        move |url, features| {
          if !is_allowed_url(url.as_str()) {
            return NewWindowResponse::Deny;
          }
          let label = format!("papyri-browser-{}", crate::platform::unique_name("popup"));
          #[cfg(target_os = "windows")]
          let environment = features.opener().environment.clone();
          #[cfg(target_os = "macos")]
          let configuration = features.opener().target_configuration.clone();
          #[allow(unused_mut)]
          let mut builder =
            tauri::WebviewWindowBuilder::new(&app, label, WebviewUrl::External(url))
              .title("Papyri Browser")
              .inner_size(
                features.size().map(|size| size.width).unwrap_or(1000.0),
                features.size().map(|size| size.height).unwrap_or(800.0),
              )
              .window_features(features);
          #[cfg(target_os = "windows")]
          {
            builder = builder.with_environment(environment);
          }
          #[cfg(target_os = "macos")]
          {
            builder = builder.with_webview_configuration(configuration);
          }
          match builder.build() {
            Ok(window) => NewWindowResponse::Create { window },
            Err(_) => NewWindowResponse::Deny,
          }
        }
      })
      .on_page_load({
        let app = app.clone();
        let active = active.clone();
        let zoom = zoom.clone();
        let site_id = site_id.clone();
        move |view, payload| {
          let loading = payload.event() == PageLoadEvent::Started;
          let value = zoom.lock().map(|value| *value).unwrap_or(1.0);
          emit_state(
            &app,
            &active,
            &site_id,
            &view,
            String::new(),
            loading,
            value,
            None,
          );
        }
      })
      .on_document_title_changed({
        let app = app.clone();
        let active = active.clone();
        let zoom = zoom.clone();
        let site_id = site_id.clone();
        move |view, title| {
          let value = zoom.lock().map(|value| *value).unwrap_or(1.0);
          emit_state(&app, &active, &site_id, &view, title, false, value, None);
        }
      });
    #[cfg(target_os = "windows")]
    {
      builder = builder.data_directory(self.data_dir.clone());
    }
    #[cfg(target_os = "macos")]
    {
      builder = builder.data_store_identifier(DATA_STORE_ID);
    }
    let (x, y, width, height) = self.bounds;
    let view = self
      .window
      .add_child(
        builder,
        LogicalPosition::new(x, y),
        LogicalSize::new(width.max(1.0), height.max(1.0)),
      )
      .map_err(|error| format!("Could not create the browser view: {error}"))?;
    view
      .set_zoom(self.zoom.lock().map(|value| *value).unwrap_or(1.0))
      .map_err(|error| error.to_string())?;
    view.hide().map_err(|error| error.to_string())?;
    self.views.insert(site.to_string(), view);
    Ok(())
  }

  fn activate(&mut self, site: &str) -> Result<(), String> {
    if !self.views.contains_key(site) {
      return Err(format!("Unknown browser site: {site}"));
    }
    *self
      .active
      .lock()
      .map_err(|_| "The browser panel is unavailable.".to_string())? = Some(site.to_string());
    for (id, view) in &self.views {
      if id == site {
        if self.visible {
          view.show().map_err(|error| error.to_string())?;
          view.set_focus().map_err(|error| error.to_string())?;
        }
      } else {
        view.hide().map_err(|error| error.to_string())?;
      }
    }
    if let Some(view) = self.views.get(site) {
      let value = self.zoom.lock().map(|value| *value).unwrap_or(1.0);
      emit_state(
        &self.app,
        &self.active,
        site,
        view,
        String::new(),
        false,
        value,
        None,
      );
    }
    Ok(())
  }

  fn show(&mut self, site: &str, url: Option<&str>) -> Result<(), String> {
    self.ensure_view(site)?;
    if let Some(url) = url {
      self.navigate(site, url)?;
    }
    self.visible = true;
    self.activate(site)
  }

  fn navigate(&mut self, site: &str, url: &str) -> Result<(), String> {
    let view = self
      .views
      .get(site)
      .ok_or_else(|| format!("Unknown browser site: {site}"))?;
    let target = url
      .parse()
      .map_err(|error| format!("Invalid browser address: {error}"))?;
    view.navigate(target).map_err(|error| error.to_string())
  }

  fn set_visible(&mut self, visible: bool) -> Result<(), String> {
    self.visible = visible;
    let active = self.active.lock().ok().and_then(|site| site.clone());
    for (id, view) in &self.views {
      if visible && active.as_deref() == Some(id.as_str()) {
        view.show().map_err(|error| error.to_string())?;
      } else {
        view.hide().map_err(|error| error.to_string())?;
      }
    }
    if visible {
      if let Some(view) = self.active_view() {
        view.set_focus().map_err(|error| error.to_string())?;
      }
    }
    Ok(())
  }

  fn set_bounds(&mut self, bounds: (f64, f64, f64, f64)) -> Result<(), String> {
    self.bounds = bounds;
    let rect = Rect {
      position: LogicalPosition::new(bounds.0, bounds.1).into(),
      size: LogicalSize::new(bounds.2.max(1.0), bounds.3.max(1.0)).into(),
    };
    for view in self.views.values() {
      view.set_bounds(rect).map_err(|error| error.to_string())?;
    }
    Ok(())
  }

  fn set_zoom(&mut self, zoom: f64) -> Result<(), String> {
    let zoom = clamp_zoom(zoom);
    *self
      .zoom
      .lock()
      .map_err(|_| "The browser panel is unavailable.".to_string())? = zoom;
    if let Some(view) = self.active_view() {
      view.set_zoom(zoom).map_err(|error| error.to_string())?;
    }
    Ok(())
  }
}

#[tauri::command]
pub fn browser_show(app: AppHandle, site: String, url: Option<String>) -> Result<(), String> {
  let site = normalize_site(&site)?;
  let url = url.map(|value| normalize_url(&value)).transpose()?;
  with_host(|host| {
    let _ = &app;
    host.show(&site, url.as_deref())
  })
}

#[tauri::command]
pub fn browser_select(app: AppHandle, site: String) -> Result<(), String> {
  let site = normalize_site(&site)?;
  with_host(|host| {
    let _ = &app;
    host.activate(&site)
  })
}

#[tauri::command]
pub fn browser_navigate(app: AppHandle, url: String) -> Result<(), String> {
  let url = normalize_url(&url)?;
  with_host(|host| {
    let _ = &app;
    let site = host
      .active
      .lock()
      .ok()
      .and_then(|site| site.clone())
      .ok_or_else(|| "No website tab is active.".to_string())?;
    host.navigate(&site, &url)
  })
}

#[tauri::command]
pub fn browser_back(app: AppHandle) -> Result<(), String> {
  with_host(|host| {
    let _ = &app;
    let view = host
      .active_view()
      .ok_or_else(|| "No website tab is active.".to_string())?;
    view
      .eval("history.back()")
      .map_err(|error| error.to_string())
  })
}

#[tauri::command]
pub fn browser_forward(app: AppHandle) -> Result<(), String> {
  with_host(|host| {
    let _ = &app;
    let view = host
      .active_view()
      .ok_or_else(|| "No website tab is active.".to_string())?;
    view
      .eval("history.forward()")
      .map_err(|error| error.to_string())
  })
}

#[tauri::command]
pub fn browser_reload(app: AppHandle) -> Result<(), String> {
  with_host(|host| {
    let _ = &app;
    let view = host
      .active_view()
      .ok_or_else(|| "No website tab is active.".to_string())?;
    view.reload().map_err(|error| error.to_string())
  })
}

#[tauri::command]
pub fn browser_stop(app: AppHandle) -> Result<(), String> {
  with_host(|host| {
    let _ = &app;
    let view = host
      .active_view()
      .ok_or_else(|| "No website tab is active.".to_string())?;
    view
      .eval("window.stop()")
      .map_err(|error| error.to_string())
  })
}

#[tauri::command]
pub fn browser_set_visible(app: AppHandle, visible: bool) -> Result<(), String> {
  with_host(|host| {
    let _ = &app;
    host.set_visible(visible)
  })
}

#[tauri::command]
pub fn browser_set_bounds(
  app: AppHandle,
  x: i32,
  y: i32,
  width: i32,
  height: i32,
) -> Result<(), String> {
  with_host(|host| {
    let _ = &app;
    host.set_bounds((
      x.max(0) as f64,
      y.max(0) as f64,
      width.max(1) as f64,
      height.max(1) as f64,
    ))
  })
}

#[tauri::command]
pub fn browser_set_zoom(app: AppHandle, zoom: f64) -> Result<(), String> {
  with_host(|host| {
    let _ = &app;
    host.set_zoom(zoom)
  })
}

fn insert_quote_script(text: &str) -> String {
  let quoted = text
    .lines()
    .map(|line| format!("> {line}"))
    .collect::<Vec<_>>()
    .join("\n");
  let prompt = format!("{quoted}\n\n");
  let text_json = serde_json::to_string(&prompt).unwrap_or_else(|_| "\"\"".to_string());
  format!(
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
    return 'inserted';
  }}
  return apply();
}})();
"#
  )
}

#[tauri::command]
pub fn browser_quote(app: AppHandle, site: String, text: String) -> Result<(), String> {
  let site = normalize_site(&site)?;
  if text.trim().is_empty() || text.len() > 100_000 {
    return Err("The selected text is empty or too large.".into());
  }
  with_host(|host| {
    let _ = &app;
    let view = host
      .views
      .get(&site)
      .ok_or_else(|| "No website tab is active.".to_string())?;
    view
      .eval(insert_quote_script(&text))
      .map_err(|error| error.to_string())
  })
}

#[tauri::command]
pub fn browser_search_wikipedia(app: AppHandle, text: String) -> Result<(), String> {
  let text = text.trim();
  if text.is_empty() || text.len() > 20_000 {
    return Err("The selected text is empty or too large.".into());
  }
  let mut target =
    url::Url::parse("https://en.wikipedia.org/w/index.php").map_err(|error| error.to_string())?;
  target.query_pairs_mut().append_pair("search", text);
  let url = target.to_string();
  with_host(|host| {
    let _ = &app;
    host.show(SITE_WIKIPEDIA, Some(&url))
  })
}

#[tauri::command]
pub async fn browser_open_window(app: AppHandle, url: Option<String>) -> Result<(), String> {
  let url = normalize_url(url.as_deref().unwrap_or(DEFAULT_URL))?;
  let label = format!("papyri-browser-{}", crate::platform::unique_name("window"));
  let target = url
    .parse()
    .map_err(|error| format!("Invalid browser address: {error}"))?;
  let data_dir = with_host(|host| {
    let _ = &app;
    Ok(host.data_dir.clone())
  })?;
  #[allow(unused_mut)]
  let mut builder = tauri::WebviewWindowBuilder::new(&app, label, WebviewUrl::External(target))
    .title("Papyri Browser")
    .inner_size(1000.0, 800.0);
  #[cfg(target_os = "windows")]
  {
    builder = builder.data_directory(data_dir);
  }
  #[cfg(target_os = "macos")]
  {
    let _ = data_dir;
    builder = builder.data_store_identifier(DATA_STORE_ID);
  }
  builder.build().map_err(|error| error.to_string())?;
  Ok(())
}

#[tauri::command]
pub async fn browser_dom(app: AppHandle, action: String, params: Value) -> Result<Value, String> {
  let view = with_host(|host| {
    let _ = &app;
    let view = host
      .active_view()
      .ok_or_else(|| "No website tab is active.".to_string())?;
    Ok(view)
  })?;
  let action = serde_json::to_string(&action).map_err(|error| error.to_string())?;
  let params = serde_json::to_string(&params).map_err(|error| error.to_string())?;
  let script = format!(
    "(() => {{ try {{ return JSON.stringify(window.__papyriDom.invoke({action}, {params})); }} catch (error) {{ return JSON.stringify({{ __papyri_error: String(error) }}); }} }})()"
  );
  let (sender, receiver) = mpsc::channel();
  view
    .eval_with_callback(script, move |value| {
      let _ = sender.send(value);
    })
    .map_err(|error| error.to_string())?;
  let raw = tauri::async_runtime::spawn_blocking(move || receiver.recv_timeout(DOM_TIMEOUT))
    .await
    .map_err(|error| error.to_string())?
    .map_err(|_| "The browser DOM request timed out.".to_string())?;
  let mut value: Value = serde_json::from_str(&raw)
    .map_err(|error| format!("The page returned invalid DOM data: {error}"))?;
  if let Value::String(inner) = &value {
    value = serde_json::from_str(inner)
      .map_err(|error| format!("The page returned invalid DOM data: {error}"))?;
  }
  if let Some(error) = value.get("__papyri_error").and_then(Value::as_str) {
    return Err(error.to_string());
  }
  Ok(value)
}

#[tauri::command]
pub async fn browser_capture(
  app: AppHandle,
  rect: Option<crate::screenshot::NormalizedRect>,
  output: Option<String>,
  clipboard: bool,
) -> Result<Value, String> {
  let (window, bounds, visible) = with_host(|host| {
    let _ = &app;
    Ok((host.window.clone(), host.bounds, host.visible))
  })?;
  if !visible {
    return Err("No website tab is visible.".into());
  }
  let (x, y, width, height) = bounds;
  if width < 1.0 || height < 1.0 {
    return Err("The browser panel has no visible bounds.".into());
  }
  let (left, top, right, bottom) = match rect {
    Some(rect) => {
      if !rect.x.is_finite()
        || !rect.y.is_finite()
        || !rect.width.is_finite()
        || !rect.height.is_finite()
      {
        return Err("The element rectangle is invalid.".into());
      }
      (
        x + rect.x.clamp(0.0, 1.0) * width,
        y + rect.y.clamp(0.0, 1.0) * height,
        x + (rect.x + rect.width).clamp(0.0, 1.0) * width,
        y + (rect.y + rect.height).clamp(0.0, 1.0) * height,
      )
    }
    None => (x, y, x + width, y + height),
  };
  let region = screen_region(&window, left, top, right, bottom)?;
  let bytes = crate::screenshot::capture_region(region)?;
  crate::screenshot::store_png(bytes, output, clipboard, "browser")
}

#[cfg(target_os = "macos")]
fn screen_region(
  window: &Window,
  left: f64,
  top: f64,
  right: f64,
  bottom: f64,
) -> Result<crate::screenshot::ScreenRegion, String> {
  let position = window.inner_position().map_err(|error| error.to_string())?;
  let scale = window.scale_factor().map_err(|error| error.to_string())?;
  Ok(crate::screenshot::ScreenRegion {
    x: (position.x as f64 / scale + left).round() as i32,
    y: (position.y as f64 / scale + top).round() as i32,
    width: (right - left).max(1.0).round() as u32,
    height: (bottom - top).max(1.0).round() as u32,
  })
}

#[cfg(target_os = "windows")]
fn screen_region(
  window: &Window,
  left: f64,
  top: f64,
  right: f64,
  bottom: f64,
) -> Result<crate::screenshot::ScreenRegion, String> {
  let position = window.inner_position().map_err(|error| error.to_string())?;
  let scale = window.scale_factor().map_err(|error| error.to_string())?;
  Ok(crate::screenshot::ScreenRegion {
    x: (position.x as f64 + left * scale).round() as i32,
    y: (position.y as f64 + top * scale).round() as i32,
    width: ((right - left) * scale).max(1.0).round() as u32,
    height: ((bottom - top) * scale).max(1.0).round() as u32,
  })
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn screen_region(
  _window: &Window,
  _left: f64,
  _top: f64,
  _right: f64,
  _bottom: f64,
) -> Result<crate::screenshot::ScreenRegion, String> {
  Err("Browser capture is unavailable on this platform.".into())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn accepts_only_web_browser_addresses() {
    assert!(normalize_url("https://chatgpt.com/").is_ok());
    assert!(normalize_url("http://localhost:3000").is_ok());
    assert!(normalize_url("file:///etc/passwd").is_err());
    assert!(normalize_url("javascript:alert(1)").is_err());
    assert!(normalize_url("").is_err());
  }

  #[test]
  fn validates_site_names_and_zoom() {
    assert_eq!(normalize_site("wikipedia").unwrap(), "wikipedia");
    assert!(normalize_site("other").is_err());
    assert_eq!(clamp_zoom(0.01), MIN_ZOOM);
    assert_eq!(clamp_zoom(f64::NAN), 1.0);
  }
}

mod browser;
mod cli;
mod cli_args;
mod cli_output;
mod commands;
mod control;
mod executables;
mod files;
mod input;
mod latex;
mod logging;
mod lsp;
mod lsp_protocol;
mod screenshot;
mod security;
mod texlive;
mod tools;
mod typst;
use tauri::Manager;

fn trace_native_startup(stage: &str) {
  if std::env::var_os("PAPYRI_STARTUP_TRACE").is_some_and(|value| value == "1") {
    eprintln!("PAPYRI_NATIVE {stage}");
  }
}

pub fn run() {
  if cli::intercept() {
    return;
  }
  trace_native_startup("entry");
  let mut bytes = [0u8; 32];
  getrandom::fill(&mut bytes).expect("Unable to create host session token");
  let token: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
  let handler: Box<dyn Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync> =
    Box::new(tauri::generate_handler![
      commands::initial_path,
      commands::declarative_preferences,
      commands::startup_trace,
      commands::list_directory,
      commands::create_entry,
      commands::rename_file,
      commands::read_document,
      commands::read_text_file,
      commands::delete_file,
      commands::write_document,
      commands::read_pdf,
      commands::compile_latex_draft,
      commands::latex_sync,
      commands::latex_sync_release,
      commands::latex_engines,
      commands::typst_binary,
      commands::read_asset,
      commands::document_stamp,
      commands::pick_path,
      commands::save_diagram,
      commands::open_external,
      screenshot::capture_screen,
      screenshot::capture_webview,
      input::input_inject,
      input::clipboard_read,
      input::clipboard_write,
      input::clipboard_read_image,
      input::clipboard_write_image,
      input::window_list,
      input::window_focus,
      input::window_capture,
      lsp::lsp_start,
      lsp::lsp_send,
      lsp::lsp_stop,
      tools::install_tool,
      tools::pick_executable,
      texlive::manage_texlive,
      browser::browser_show,
      browser::browser_select,
      browser::browser_quote,
      browser::browser_search_wikipedia,
      browser::browser_open_window,
      browser::browser_set_zoom,
      browser::browser_navigate,
      browser::browser_back,
      browser::browser_forward,
      browser::browser_reload,
      browser::browser_stop,
      browser::browser_set_visible,
      browser::browser_set_bounds,
      browser::browser_dom,
      browser::browser_capture,
      control::control_ready,
      control::control_respond,
      control::control_emit
    ]);
  trace_native_startup("builder");
  tauri::Builder::default()
    .manage(control::ControlState::default())
    .manage(lsp::ServerState::default())
    .append_invoke_initialization_script(security::initialization(&token))
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_opener::init())
    .on_window_event(|window, event| {
      if window.label() == "main" {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
          api.prevent_close();
          control::request_window_close(window.app_handle().clone());
        }
      }
    })
    .setup(|app| {
      trace_native_startup("setup");
      let window = app
        .get_webview_window("main")
        .ok_or("Main window is unavailable")?;
      window.with_webview(|webview| {
        use webkit2gtk::{
          UserContentInjectedFrames, UserContentManagerExt, UserScript, UserScriptInjectionTime,
          WebViewExt,
        };
        if let Some(manager) = webview.inner().user_content_manager() {
          manager.add_script(&UserScript::new(
            include_str!("preview_zoom.js"),
            UserContentInjectedFrames::AllFrames,
            UserScriptInjectionTime::Start,
            &[],
            &[],
          ));
        }
      })?;
      let icon = app
        .default_window_icon()
        .ok_or("Application icon is unavailable")?;
      window.set_icon(icon.clone())?;
      let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Application data directory is unavailable: {error}"))?
        .join("browser");
      let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("Application cache directory is unavailable: {error}"))?
        .join("browser");
      if let Err(error) = browser::install(&window, app.handle().clone(), data_dir, cache_dir) {
        eprintln!("Papyri browser panel unavailable: {error}");
      }
      if let Err(error) = control::start(app.handle().clone()) {
        eprintln!("Papyri control socket unavailable: {error}");
      }
      trace_native_startup("setup-complete");
      Ok(())
    })
    .invoke_handler(move |invoke| {
      if !security::authorized(invoke.message.payload(), &token) {
        invoke
          .resolver
          .reject("Document frames cannot invoke host commands");
        return true;
      }
      handler(invoke)
    })
    .run(tauri::generate_context!())
    .expect("Unable to start Papyri");
}

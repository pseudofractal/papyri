mod cli;
mod cli_args;
mod cli_output;
mod commands;
mod control;
mod executables;
mod files;
mod latex;
mod security;
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
      commands::startup_trace,
      commands::list_directory,
      commands::read_document,
      commands::read_pdf,
      commands::latex_engines,
      commands::typst_binary,
      commands::read_asset,
      commands::document_stamp,
      commands::pick_path,
      commands::save_diagram,
      commands::open_external,
      control::control_ready,
      control::control_respond,
      control::control_emit
    ]);
  trace_native_startup("builder");
  tauri::Builder::default()
    .manage(control::ControlState::default())
    .append_invoke_initialization_script(security::initialization(&token))
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_opener::init())
    .setup(|app| {
      trace_native_startup("setup");
      let window = app
        .get_webview_window("main")
        .ok_or("Main window is unavailable")?;
      let icon = app
        .default_window_icon()
        .ok_or("Application icon is unavailable")?;
      window.set_icon(icon.clone())?;
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

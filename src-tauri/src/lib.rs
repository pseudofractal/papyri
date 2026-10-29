mod commands;
mod files;
mod security;
mod typst;
use tauri::Manager;
pub fn run() {
  let mut bytes = [0u8; 32];
  getrandom::fill(&mut bytes).expect("Unable to create host session token");
  let token: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
  let handler: Box<dyn Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync> =
    Box::new(tauri::generate_handler![
      commands::initial_path,
      commands::list_directory,
      commands::read_document,
      commands::read_pdf,
      commands::read_asset,
      commands::document_stamp,
      commands::pick_path,
      commands::open_external
    ]);
  tauri::Builder::default()
    .append_invoke_initialization_script(security::initialization(&token))
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_opener::init())
    .setup(|app| {
      let window = app
        .get_webview_window("main")
        .ok_or("Main window is unavailable")?;
      let icon = app
        .default_window_icon()
        .ok_or("Application icon is unavailable")?;
      window.set_icon(icon.clone())?;
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

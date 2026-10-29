use crate::{files, typst};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

async fn blocking<T: Send + 'static>(
  operation: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
  tauri::async_runtime::spawn_blocking(operation)
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn initial_path() -> Result<files::InitialPath, String> {
  files::initial_path()
}
#[tauri::command]
pub async fn list_directory(path: String) -> Result<Vec<files::Entry>, String> {
  blocking(move || files::list_directory(path)).await
}
#[tauri::command]
pub async fn read_document(path: String) -> Result<files::Document, String> {
  blocking(move || files::read_document(path)).await
}
#[tauri::command]
pub async fn read_pdf(path: String) -> Result<tauri::ipc::Response, String> {
  let bytes = blocking(move || {
    if typst::is_typst(&path) {
      typst::compile(path)
    } else {
      files::read_pdf(path)
    }
  })
  .await?;
  Ok(tauri::ipc::Response::new(bytes))
}
#[tauri::command]
pub async fn read_asset(path: String) -> Result<Vec<u8>, String> {
  blocking(move || files::read_asset(path)).await
}
#[tauri::command]
pub async fn document_stamp(path: String) -> Result<String, String> {
  blocking(move || {
    if typst::is_typst(&path) {
      typst::stamp(path)
    } else {
      files::document_stamp(path)
    }
  })
  .await
}
#[tauri::command]
pub async fn pick_path(app: tauri::AppHandle, directory: bool) -> Result<Option<String>, String> {
  blocking(move || {
    let picker = app.dialog().file();
    let result = if directory {
      picker.blocking_pick_folder()
    } else {
      picker
        .add_filter(
          "Documents",
          &["md", "markdown", "mdown", "mkd", "pdf", "typ"],
        )
        .blocking_pick_file()
    };
    result
      .map(|path| {
        path
          .into_path()
          .map(|p| p.to_string_lossy().into_owned())
          .map_err(|e| e.to_string())
      })
      .transpose()
  })
  .await
}
#[tauri::command]
pub async fn open_external(app: tauri::AppHandle, url: String) -> Result<(), String> {
  let lower = url.to_ascii_lowercase();
  if !["https://", "http://", "mailto:"]
    .iter()
    .any(|scheme| lower.starts_with(scheme))
  {
    return Err("Unsupported external URL scheme".into());
  }
  blocking(move || {
    app
      .opener()
      .open_url(url, None::<&str>)
      .map_err(|e| e.to_string())
  })
  .await
}

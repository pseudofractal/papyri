use crate::{files, latex, typst};
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
pub fn declarative_preferences(app: tauri::AppHandle) -> Result<Option<serde_json::Value>, String> {
  use tauri::Manager;
  let user = app
    .path()
    .config_dir()
    .map_err(|error| error.to_string())?
    .join("papyri/config.json");
  let mut paths = vec![user];
  let system_dirs = std::env::var_os("XDG_CONFIG_DIRS").unwrap_or_else(|| "/etc/xdg".into());
  paths.extend(std::env::split_paths(&system_dirs).map(|path| path.join("papyri/config.json")));
  for path in paths {
    match std::fs::read_to_string(&path) {
      Ok(contents) => {
        let value: serde_json::Value = serde_json::from_str(&contents)
          .map_err(|error| format!("Invalid configuration {}: {error}", path.display()))?;
        if !value.is_object() {
          return Err(format!(
            "Configuration {} must be a JSON object",
            path.display()
          ));
        }
        return Ok(Some(value));
      }
      Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
      Err(error) => {
        return Err(format!(
          "Unable to read configuration {}: {error}",
          path.display()
        ))
      }
    }
  }
  Ok(None)
}
#[tauri::command]
pub fn startup_trace(stage: String, navigation_ms: f64) {
  if std::env::var_os("PAPYRI_STARTUP_TRACE").is_some_and(|value| value == "1")
    && matches!(
      stage.as_str(),
      "shell"
        | "folder"
        | "source-ready"
        | "file-ready"
        | "preview-start"
        | "parser-ready"
        | "renderer-ready"
        | "assets-ready"
        | "frame-built"
        | "document"
        | "pdf-page"
    )
    && navigation_ms.is_finite()
    && navigation_ms >= 0.0
  {
    eprintln!("PAPYRI_STARTUP {stage} {navigation_ms:.3}");
  }
}
#[tauri::command]
pub async fn list_directory(path: String) -> Result<Vec<files::Entry>, String> {
  blocking(move || files::list_directory(path)).await
}
#[tauri::command]
pub async fn create_entry(directory: String, name: String, kind: String) -> Result<String, String> {
  blocking(move || files::create_entry(directory, name, kind)).await
}
#[tauri::command]
pub async fn rename_file(path: String, name: String) -> Result<String, String> {
  blocking(move || files::rename_file(path, name)).await
}
#[tauri::command]
pub async fn read_document(path: String) -> Result<files::Document, String> {
  blocking(move || files::read_document(path)).await
}
#[tauri::command]
pub async fn read_text_file(path: String) -> Result<String, String> {
  blocking(move || files::read_text_file(path)).await
}
#[tauri::command]
pub async fn delete_file(path: String) -> Result<(), String> {
  blocking(move || files::delete_file(path)).await
}
#[tauri::command]
pub async fn write_document(
  path: String,
  text: String,
  expected_text: String,
  expected_stamp: String,
) -> Result<files::Document, String> {
  blocking(move || files::write_document(path, text, expected_text, expected_stamp)).await
}
#[tauri::command]
pub fn latex_engines() -> Vec<latex::Engine> {
  latex::discover_engines()
}
#[tauri::command]
pub fn typst_binary() -> Option<std::path::PathBuf> {
  typst::discover_binary()
}
#[tauri::command]
pub async fn read_pdf(
  path: String,
  engine: Option<String>,
  compiler_path: Option<String>,
) -> Result<tauri::ipc::Response, String> {
  let bytes = blocking(move || {
    if typst::is_typst(&path) {
      typst::compile(path, compiler_path.unwrap_or_default())
    } else if latex::is_latex(&path) {
      latex::compile(
        path,
        engine.unwrap_or_else(|| "lualatex".into()),
        compiler_path.unwrap_or_default(),
      )
    } else {
      files::read_pdf(path)
    }
  })
  .await?;
  Ok(tauri::ipc::Response::new(bytes))
}
#[tauri::command]
pub async fn compile_latex_draft(
  path: String,
  text: String,
  engine: String,
  compiler_path: String,
  overlays: Option<Vec<(String, String)>>,
) -> Result<tauri::ipc::Response, String> {
  let bytes = blocking(move || {
    latex::compile_preview(
      path,
      engine,
      compiler_path,
      text,
      overlays.unwrap_or_default(),
    )
  })
  .await?;
  Ok(tauri::ipc::Response::new(bytes))
}
#[tauri::command]
pub async fn latex_sync(
  id: String,
  source: Option<String>,
  line: Option<u32>,
  page: Option<u32>,
  x: Option<f64>,
  y: Option<f64>,
) -> Result<String, String> {
  blocking(move || latex::sync_query(id, source, line, page, x, y)).await
}
#[tauri::command]
pub async fn latex_sync_release(id: String) -> Result<(), String> {
  blocking(move || latex::release_sync(&id)).await
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
    } else if latex::is_latex(&path) {
      latex::stamp(path)
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
          &["md", "markdown", "mdown", "mkd", "pdf", "typ", "tex"],
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
const DIAGRAM_EXPORT_LIMIT: usize = 16 * 1024 * 1024;

fn validate_diagram_export(format: &str, bytes: &[u8]) -> Result<(), String> {
  if bytes.is_empty() || bytes.len() > DIAGRAM_EXPORT_LIMIT {
    return Err("Diagram export exceeds the 16 MiB limit or is empty.".into());
  }
  match format {
    "png" if bytes.starts_with(b"\x89PNG\r\n\x1a\n") => Ok(()),
    "svg" if std::str::from_utf8(bytes).is_ok_and(|text| text.trim_start().starts_with("<svg")) => {
      Ok(())
    }
    "png" | "svg" => Err("Diagram export data does not match its format.".into()),
    _ => Err("Unsupported diagram export format.".into()),
  }
}

#[tauri::command]
pub async fn save_diagram(
  app: tauri::AppHandle,
  format: String,
  bytes: Vec<u8>,
) -> Result<bool, String> {
  validate_diagram_export(&format, &bytes)?;
  blocking(move || {
    let selected = app
      .dialog()
      .file()
      .set_file_name(format!("diagram.{format}"))
      .add_filter("Diagram", &[format.as_str()])
      .blocking_save_file();
    let Some(selected) = selected else {
      return Ok(false);
    };
    let path = selected.into_path().map_err(|error| error.to_string())?;
    std::fs::write(&path, bytes)
      .map_err(|error| format!("Could not save {}: {error}", path.display()))?;
    Ok(true)
  })
  .await
}

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn validates_diagram_export_format_and_size() {
    assert!(validate_diagram_export("png", b"\x89PNG\r\n\x1a\nimage").is_ok());
    assert!(
      validate_diagram_export("svg", b"<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>").is_ok()
    );
    assert!(validate_diagram_export("png", b"<svg/>").is_err());
    assert!(validate_diagram_export("exe", b"data").is_err());
    assert!(validate_diagram_export("svg", &vec![b'x'; DIAGRAM_EXPORT_LIMIT + 1]).is_err());
  }
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

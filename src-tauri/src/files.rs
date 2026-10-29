use serde::Serialize;
use std::{fs, io::Read, path::Path, time::UNIX_EPOCH};
#[derive(Serialize)]
pub struct InitialPath {
  pub path: String,
  pub directory: bool,
}
pub const DOCUMENT_LIMIT: u64 = 8 * 1024 * 1024;
pub const PDF_LIMIT: u64 = 64 * 1024 * 1024;
const ASSET_LIMIT: u64 = 16 * 1024 * 1024;
#[derive(Serialize)]
pub struct Entry {
  name: String,
  path: String,
  directory: bool,
}
#[derive(Serialize)]
pub struct Document {
  text: String,
  stamp: String,
}
fn error(path: &str, error: impl std::fmt::Display) -> String {
  format!("{path}: {error}")
}
pub fn bounded_read(path: &str, limit: u64) -> Result<(Vec<u8>, fs::Metadata), String> {
  if !fs::metadata(path).map_err(|e| error(path, e))?.is_file() {
    return Err(error(path, "Not a regular file"));
  }
  let file = fs::File::open(path).map_err(|e| error(path, e))?;
  let metadata = file.metadata().map_err(|e| error(path, e))?;
  if !metadata.is_file() {
    return Err(error(path, "Not a regular file"));
  }
  if metadata.len() > limit {
    return Err(error(
      path,
      format!("File exceeds {} MiB", limit / 1024 / 1024),
    ));
  }
  let mut bytes = Vec::new();
  file
    .take(limit + 1)
    .read_to_end(&mut bytes)
    .map_err(|e| error(path, e))?;
  if bytes.len() as u64 > limit {
    return Err(error(path, "File grew beyond preview limit"));
  }
  Ok((bytes, metadata))
}
pub fn initial_path() -> Result<InitialPath, String> {
  let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
  let argument = std::env::args_os()
    .nth(1)
    .map(std::path::PathBuf::from)
    .unwrap_or(cwd.clone());
  let path = if argument.is_absolute() {
    argument
  } else {
    cwd.join(argument)
  };
  Ok(InitialPath {
    directory: path.is_dir(),
    path: path.to_string_lossy().into_owned(),
  })
}
pub fn list_directory(path: String) -> Result<Vec<Entry>, String> {
  let entries = fs::read_dir(&path).map_err(|e| error(&path, e))?;
  let mut result = Vec::new();
  for entry in entries {
    let entry = entry.map_err(|e| error(&path, e))?;
    let entry_path = entry.path();
    // Broken symlinks remain visible; following an inaccessible entry reports an error.
    let directory = entry_path.is_dir();
    result.push(Entry {
      name: entry.file_name().to_string_lossy().into_owned(),
      path: entry_path.to_string_lossy().into_owned(),
      directory,
    });
  }
  result.sort_by(|a, b| {
    b.directory
      .cmp(&a.directory)
      .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
  });
  Ok(result)
}
pub fn read_document(path: String) -> Result<Document, String> {
  let extension = Path::new(&path)
    .extension()
    .and_then(|e| e.to_str())
    .unwrap_or("")
    .to_lowercase();
  if !["md", "markdown", "mdown", "mkd"].contains(&extension.as_str()) {
    return Err(error(&path, "Only Markdown documents can be opened"));
  }
  let (bytes, metadata) = bounded_read(&path, DOCUMENT_LIMIT)?;
  let text = String::from_utf8(bytes).map_err(|e| error(&path, format!("Expected UTF-8: {e}")))?;
  Ok(Document {
    text,
    stamp: metadata_stamp(&metadata).map_err(|e| error(&path, e))?,
  })
}
pub fn document_stamp(path: String) -> Result<String, String> {
  let metadata = fs::metadata(&path).map_err(|e| error(&path, e))?;
  metadata_stamp(&metadata).map_err(|e| error(&path, e))
}
pub fn read_pdf(path: String) -> Result<Vec<u8>, String> {
  if !Path::new(&path)
    .extension()
    .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"))
  {
    return Err(error(&path, "Expected a PDF document"));
  }
  bounded_read(&path, PDF_LIMIT).map(|(bytes, _)| bytes)
}
fn metadata_stamp(metadata: &fs::Metadata) -> Result<String, String> {
  let modified = metadata
    .modified()
    .map_err(|e| e.to_string())?
    .duration_since(UNIX_EPOCH)
    .map_err(|e| e.to_string())?
    .as_nanos();
  Ok(format!("{}:{modified}", metadata.len()))
}
pub fn read_asset(path: String) -> Result<Vec<u8>, String> {
  let extension = Path::new(&path)
    .extension()
    .and_then(|e| e.to_str())
    .unwrap_or("")
    .to_lowercase();
  if !["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"].contains(&extension.as_str()) {
    return Err(error(&path, "Only image assets may be read"));
  }
  bounded_read(&path, ASSET_LIMIT).map(|(bytes, _)| bytes)
}
#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn bounded_reads_and_directory_navigation() {
    let directory = std::env::temp_dir().join(format!("papyri-test-{}", std::process::id()));
    fs::create_dir_all(&directory).unwrap();
    let file = directory.join(".hidden.md");
    fs::write(&file, "# Hello").unwrap();
    let path = file.to_string_lossy().into_owned();
    assert_eq!(read_document(path.clone()).unwrap().text, "# Hello");
    assert!(bounded_read(&path, 2).is_err());
    assert!(list_directory(directory.to_string_lossy().into_owned())
      .unwrap()
      .iter()
      .any(|e| e.name == ".hidden.md"));
    fs::write(&file, "# Changed").unwrap();
    assert_eq!(read_document(path.clone()).unwrap().text, "# Changed");
    fs::remove_file(file).unwrap();
    assert!(read_document(path).is_err());
    fs::remove_dir(directory).unwrap();
  }
  #[test]
  fn rejects_non_markdown_and_devices() {
    assert!(read_document("/etc/passwd".into()).is_err());
    assert!(bounded_read("/dev/zero", 100).is_err());
  }
  #[test]
  fn reads_pdf_bytes_without_decoding_and_bounds_allocation() {
    let path = std::env::temp_dir().join(format!("papyri-pdf-test-{}.PDF", std::process::id()));
    fs::write(&path, b"%PDF-1.7\n\xff").unwrap();
    let name = path.to_string_lossy().into_owned();
    assert_eq!(read_pdf(name.clone()).unwrap(), b"%PDF-1.7\n\xff");
    let file = fs::OpenOptions::new().write(true).open(&path).unwrap();
    file.set_len(PDF_LIMIT + 1).unwrap();
    assert!(read_pdf(name).unwrap_err().contains("64 MiB"));
    assert!(read_pdf("document.md".into()).is_err());
    fs::remove_file(path).unwrap();
  }
}

use serde::Serialize;
use std::{
  fs,
  io::{Read, Write},
  os::unix::fs::MetadataExt,
  path::{Path, PathBuf},
  time::UNIX_EPOCH,
};
#[derive(Serialize)]
pub struct InitialPath {
  pub path: String,
  pub directory: bool,
  /// True when the path came from an explicit launch target rather than the
  /// process working directory.
  pub explicit: bool,
}
pub const DOCUMENT_LIMIT: u64 = 8 * 1024 * 1024;
pub const PDF_LIMIT: u64 = 64 * 1024 * 1024;
const ASSET_LIMIT: u64 = 16 * 1024 * 1024;
#[derive(Serialize)]
pub struct Entry {
  name: String,
  path: String,
  directory: bool,
  symlink: bool,
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
fn initial_argument(
  env: Option<std::ffi::OsString>,
  arg: Option<std::ffi::OsString>,
) -> Option<PathBuf> {
  env
    .filter(|value| !value.is_empty())
    .map(PathBuf::from)
    .or_else(|| {
      arg
        .filter(|value| !value.to_string_lossy().starts_with('-'))
        .map(PathBuf::from)
    })
}

pub fn initial_path() -> Result<InitialPath, String> {
  let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
  let argument = initial_argument(
    std::env::var_os("PAPYRI_INITIAL_PATH"),
    std::env::args_os().nth(1),
  );
  let explicit = argument.is_some();
  let argument = argument.unwrap_or_else(|| cwd.clone());
  let path = if argument.is_absolute() {
    argument
  } else {
    cwd.join(argument)
  };
  Ok(InitialPath {
    directory: path.is_dir(),
    path: path.to_string_lossy().into_owned(),
    explicit,
  })
}
pub fn list_directory(path: String) -> Result<Vec<Entry>, String> {
  let entries = fs::read_dir(&path).map_err(|e| error(&path, e))?;
  let mut result = Vec::new();
  for entry in entries {
    let entry = entry.map_err(|e| error(&path, e))?;
    let entry_path = entry.path();
    let file_type = entry.file_type().map_err(|e| error(&path, e))?;
    let symlink = file_type.is_symlink();
    // Follow directory links while leaving broken symlinks visible.
    let directory = if symlink {
      entry_path.is_dir()
    } else {
      file_type.is_dir()
    };
    result.push(Entry {
      name: entry.file_name().to_string_lossy().into_owned(),
      path: entry_path.to_string_lossy().into_owned(),
      directory,
      symlink,
    });
  }
  result.sort_by_cached_key(|entry| (!entry.directory, entry.name.to_lowercase()));
  Ok(result)
}

/// Create a new source file or directory without replacing an existing entry.
pub fn create_entry(directory: String, name: String, kind: String) -> Result<String, String> {
  let mut components = Path::new(&name).components();
  if !matches!(components.next(), Some(std::path::Component::Normal(_)))
    || components.next().is_some()
    || name.contains('/')
    || name.contains('\\')
    || name.trim() != name
    || name.is_empty()
  {
    return Err("Enter a single file or folder name.".into());
  }
  let path = Path::new(&directory).join(&name);
  match kind.as_str() {
    "folder" => fs::create_dir(&path).map_err(|e| error(&path.to_string_lossy(), e))?,
    "markdown" | "typst" | "latex" => {
      let extension = match kind.as_str() {
        "markdown" => "md",
        "typst" => "typ",
        _ => "tex",
      };
      if !path
        .extension()
        .is_some_and(|value| value.eq_ignore_ascii_case(extension))
      {
        return Err(format!("Expected a .{extension} filename."));
      }
      let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|e| error(&path.to_string_lossy(), e))?;
      if kind == "latex" {
        file
          .write_all(b"\\documentclass{article}\n\n\\begin{document}\n\n\\end{document}\n")
          .map_err(|e| error(&path.to_string_lossy(), e))?;
      }
    }
    _ => return Err("Unsupported entry type.".into()),
  }
  Ok(path.to_string_lossy().into_owned())
}

/// Rename a regular file within its directory, refusing to replace another entry.
pub fn rename_file(path: String, name: String) -> Result<String, String> {
  use std::{ffi::CString, os::unix::ffi::OsStrExt};
  let mut components = Path::new(&name).components();
  if !matches!(components.next(), Some(std::path::Component::Normal(_)))
    || components.next().is_some()
    || name.contains('/')
    || name.contains('\\')
    || name.trim() != name
    || name.is_empty()
  {
    return Err("Enter a single file name.".into());
  }
  let source = Path::new(&path);
  if !fs::symlink_metadata(source)
    .map_err(|e| error(&path, e))?
    .file_type()
    .is_file()
  {
    return Err("Only regular files can be renamed.".into());
  }
  let parent = source.parent().ok_or("Missing parent directory")?;
  let target = parent.join(&name);
  if target == source {
    return Ok(path);
  }
  if source.extension().map(|v| v.to_ascii_lowercase())
    != target.extension().map(|v| v.to_ascii_lowercase())
  {
    return Err("Keep the existing file extension when renaming.".into());
  }
  let old = CString::new(source.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
  let new = CString::new(target.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
  let result = unsafe {
    libc::renameat2(
      libc::AT_FDCWD,
      old.as_ptr(),
      libc::AT_FDCWD,
      new.as_ptr(),
      libc::RENAME_NOREPLACE,
    )
  };
  if result != 0 {
    return Err(error(&path, std::io::Error::last_os_error()));
  }
  Ok(target.to_string_lossy().into_owned())
}
pub fn read_document(path: String) -> Result<Document, String> {
  let extension = Path::new(&path)
    .extension()
    .and_then(|e| e.to_str())
    .unwrap_or("")
    .to_lowercase();
  if ![
    "md", "markdown", "mdown", "mkd", "typ", "tex", "bib", "bibtex", "ris", "nbib", "enw",
    "csljson", "json",
  ]
  .contains(&extension.as_str())
  {
    return Err(error(
      &path,
      "Only Markdown, Typst, LaTeX, and bibliography documents can be opened",
    ));
  }
  let (bytes, metadata) = bounded_read(&path, DOCUMENT_LIMIT)?;
  let text = String::from_utf8(bytes).map_err(|e| error(&path, format!("Expected UTF-8: {e}")))?;
  Ok(Document {
    text,
    stamp: metadata_stamp(&metadata).map_err(|e| error(&path, e))?,
  })
}

/// Read a bounded UTF-8 file for copying its contents.
pub fn read_text_file(path: String) -> Result<String, String> {
  let (bytes, _) = bounded_read(&path, DOCUMENT_LIMIT)?;
  if bytes.contains(&0) {
    return Err(format!("{path}: Cannot copy binary file contents."));
  }
  String::from_utf8(bytes).map_err(|error| format!("{path}: Expected UTF-8 text: {error}"))
}

/// Remove a file or symbolic link, never a directory.
pub fn delete_file(path: String) -> Result<(), String> {
  let metadata = fs::symlink_metadata(&path).map_err(|error| format!("{path}: {error}"))?;
  if !metadata.file_type().is_file() && !metadata.file_type().is_symlink() {
    return Err("Only files and symbolic links can be deleted here.".into());
  }
  fs::remove_file(&path).map_err(|error| format!("{path}: {error}"))
}

/// Save a previously read source document, refusing a changed on-disk version.
pub fn write_document(
  path: String,
  text: String,
  expected_text: String,
  expected_stamp: String,
) -> Result<Document, String> {
  if text.len() as u64 > DOCUMENT_LIMIT {
    return Err(error(&path, "Document exceeds the 8 MiB limit"));
  }
  let original = read_document(path.clone())?;
  if original.text != expected_text || original.stamp != expected_stamp {
    return Err(error(
      &path,
      "Document changed on disk; reload before saving",
    ));
  }
  let target = fs::canonicalize(&path).map_err(|e| error(&path, e))?;
  let metadata = fs::metadata(&target).map_err(|e| error(&path, e))?;
  if metadata.nlink() > 1 {
    return Err(error(
      &path,
      "Cannot safely replace a file with multiple hard links",
    ));
  }
  #[cfg(target_os = "linux")]
  {
    use std::{ffi::CString, os::unix::ffi::OsStrExt};
    let name = CString::new(target.as_os_str().as_bytes()).map_err(|e| error(&path, e))?;
    let attribute_bytes = unsafe { libc::listxattr(name.as_ptr(), std::ptr::null_mut(), 0) };
    if attribute_bytes < 0 {
      return Err(error(
        &path,
        format!(
          "Cannot inspect extended attributes: {}",
          std::io::Error::last_os_error()
        ),
      ));
    }
    if attribute_bytes > 0 {
      return Err(error(
        &path,
        "Cannot safely replace a file with extended attributes or ACLs",
      ));
    }
  }
  // Check file write permission before creating a replacement in its directory.
  fs::OpenOptions::new()
    .write(true)
    .open(&target)
    .map_err(|e| error(&path, e))?;
  let parent = target
    .parent()
    .ok_or_else(|| error(&path, "Missing parent directory"))?;
  let mut random = [0u8; 16];
  getrandom::fill(&mut random).map_err(|e| error(&path, e))?;
  let suffix: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
  let temporary = parent.join(format!(".papyri-save-{suffix}"));
  let mut created = false;
  let result = (|| {
    let mut file = fs::OpenOptions::new()
      .write(true)
      .create_new(true)
      .open(&temporary)
      .map_err(|e| error(&path, e))?;
    created = true;
    let replacement_metadata = file.metadata().map_err(|e| error(&path, e))?;
    if replacement_metadata.uid() != metadata.uid() || replacement_metadata.gid() != metadata.gid()
    {
      return Err(error(&path, "Cannot preserve source file ownership"));
    }
    file
      .set_permissions(metadata.permissions())
      .map_err(|e| error(&path, e))?;
    file
      .write_all(text.as_bytes())
      .map_err(|e| error(&path, e))?;
    file.sync_all().map_err(|e| error(&path, e))?;
    let latest = read_document(path.clone())?;
    if latest.text != expected_text
      || latest.stamp != expected_stamp
      || fs::canonicalize(&path).map_err(|e| error(&path, e))? != target
    {
      return Err(error(
        &path,
        "Document changed on disk; reload before saving",
      ));
    }
    fs::rename(&temporary, &target).map_err(|e| error(&path, e))?;
    read_document(path.clone())
  })();
  if created && temporary.exists() {
    let _ = fs::remove_file(&temporary);
  }
  result
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
  use std::ffi::OsString;
  #[test]
  fn launch_flags_are_not_treated_as_paths() {
    assert_eq!(
      initial_argument(None, Some(OsString::from("--decorationless"))),
      None
    );
    assert_eq!(
      initial_argument(Some(OsString::new()), Some(OsString::from("notes.md"))),
      Some(PathBuf::from("notes.md"))
    );
    assert_eq!(
      initial_argument(Some(OsString::from("/work")), Some(OsString::from("--log"))),
      Some(PathBuf::from("/work"))
    );
  }
  #[test]
  fn creates_entries_without_overwriting_or_traversing() {
    let directory = std::env::temp_dir().join(format!("papyri-create-test-{}", std::process::id()));
    fs::create_dir(&directory).unwrap();
    let root = directory.to_string_lossy().into_owned();
    for (kind, name) in [
      ("markdown", "a.md"),
      ("typst", "b.typ"),
      ("latex", "c.tex"),
      ("folder", "folder"),
    ] {
      let path = create_entry(root.clone(), name.into(), kind.into()).unwrap();
      assert!(Path::new(&path).exists());
      assert!(create_entry(root.clone(), name.into(), kind.into()).is_err());
    }
    fs::write(directory.join("a.md"), "keep me").unwrap();
    assert!(create_entry(root.clone(), "a.md".into(), "markdown".into()).is_err());
    assert_eq!(
      fs::read_to_string(directory.join("a.md")).unwrap(),
      "keep me"
    );
    for name in [
      "..",
      "../outside.md",
      "/tmp/outside.md",
      "dir/file.md",
      "a\\b.md",
    ] {
      assert!(create_entry(root.clone(), name.into(), "markdown".into()).is_err());
    }
    assert!(create_entry(root, "wrong.txt".into(), "latex".into()).is_err());
    fs::remove_dir_all(directory).unwrap();
  }
  #[test]
  fn renames_files_without_overwriting_or_changing_extensions() {
    let root = std::env::temp_dir().join(format!("papyri-rename-test-{}", std::process::id()));
    fs::create_dir(&root).unwrap();
    let first = root.join("first.md");
    let second = root.join("second.md");
    fs::write(&first, "first").unwrap();
    fs::write(&second, "second").unwrap();
    let path = first.to_string_lossy().into_owned();
    assert!(rename_file(path.clone(), "second.md".into()).is_err());
    assert!(rename_file(path.clone(), "../escape.md".into()).is_err());
    assert!(rename_file(path.clone(), "different.tex".into()).is_err());
    assert_eq!(fs::read_to_string(&second).unwrap(), "second");
    let renamed = rename_file(path, "renamed.md".into()).unwrap();
    assert_eq!(fs::read_to_string(renamed).unwrap(), "first");
    fs::remove_dir_all(root).unwrap();
  }
  #[test]
  fn reads_text_and_deletes_files_without_removing_directories() {
    let root = std::env::temp_dir().join(format!("papyri-delete-test-{}", std::process::id()));
    fs::create_dir(&root).unwrap();
    let file = root.join("references.bib");
    fs::write(&file, "bibliography").unwrap();
    let path = file.to_string_lossy().into_owned();
    assert_eq!(read_text_file(path.clone()).unwrap(), "bibliography");
    assert!(delete_file(root.to_string_lossy().into_owned()).is_err());
    let link = root.join("directory-link");
    std::os::unix::fs::symlink(&root, &link).unwrap();
    delete_file(link.to_string_lossy().into_owned()).unwrap();
    assert!(root.is_dir());
    delete_file(path.clone()).unwrap();
    assert!(!file.exists());
    assert!(delete_file(path).is_err());
    fs::remove_dir(root).unwrap();
  }
  #[test]
  fn saves_source_and_rejects_external_changes() {
    let directory = std::env::temp_dir().join(format!("papyri-save-test-{}", std::process::id()));
    fs::create_dir_all(&directory).unwrap();
    for extension in ["md", "typ", "tex"] {
      let file = directory.join(format!("paper.{extension}"));
      fs::write(&file, "original").unwrap();
      let path = file.to_string_lossy().into_owned();
      let original = read_document(path.clone()).unwrap();
      let saved =
        write_document(path.clone(), "数学".into(), original.text, original.stamp).unwrap();
      assert_eq!(saved.text, "数学");
      fs::write(&file, "external edit").unwrap();
      assert!(write_document(path, "overwrite".into(), saved.text, saved.stamp).is_err());
      assert_eq!(fs::read_to_string(&file).unwrap(), "external edit");
      fs::remove_file(file).unwrap();
    }
    assert!(fs::read_dir(&directory).unwrap().next().is_none());
    fs::remove_dir(directory).unwrap();
  }
  #[test]
  fn refuses_to_break_hard_links_when_saving() {
    let directory =
      std::env::temp_dir().join(format!("papyri-hardlink-test-{}", std::process::id()));
    fs::create_dir_all(&directory).unwrap();
    let original = directory.join("original.md");
    let linked = directory.join("linked.md");
    fs::write(&original, "original").unwrap();
    fs::hard_link(&original, &linked).unwrap();
    let path = original.to_string_lossy().into_owned();
    let loaded = read_document(path.clone()).unwrap();
    let error = write_document(path, "changed".into(), loaded.text, loaded.stamp)
      .err()
      .unwrap();
    assert!(error.contains("hard links"));
    assert_eq!(fs::read_to_string(&original).unwrap(), "original");
    assert_eq!(fs::read_to_string(&linked).unwrap(), "original");
    fs::remove_file(original).unwrap();
    fs::remove_file(linked).unwrap();
    fs::remove_dir(directory).unwrap();
  }
  #[cfg(target_os = "linux")]
  #[test]
  fn refuses_to_discard_extended_attributes() {
    use std::{ffi::CString, os::unix::ffi::OsStrExt};
    let file = std::env::temp_dir().join(format!("papyri-xattr-test-{}.md", std::process::id()));
    fs::write(&file, "original").unwrap();
    let name = CString::new(file.as_os_str().as_bytes()).unwrap();
    let attribute = CString::new("user.papyri-test").unwrap();
    let value = b"keep";
    let result = unsafe {
      libc::setxattr(
        name.as_ptr(),
        attribute.as_ptr(),
        value.as_ptr().cast(),
        value.len(),
        0,
      )
    };
    if result != 0 {
      let failure = std::io::Error::last_os_error();
      if matches!(
        failure.raw_os_error(),
        Some(libc::EOPNOTSUPP | libc::ENOSYS)
      ) {
        fs::remove_file(file).unwrap();
        return;
      }
      panic!("Could not set a test extended attribute: {failure}");
    }
    let path = file.to_string_lossy().into_owned();
    let loaded = read_document(path.clone()).unwrap();
    let error = write_document(path, "changed".into(), loaded.text, loaded.stamp)
      .err()
      .unwrap();
    assert!(error.contains("extended attributes"));
    assert_eq!(fs::read_to_string(&file).unwrap(), "original");
    fs::remove_file(file).unwrap();
  }
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
    let symlink = directory.join("loop");
    std::os::unix::fs::symlink(&directory, &symlink).unwrap();
    let broken_link = directory.join("broken");
    std::os::unix::fs::symlink(directory.join("missing"), &broken_link).unwrap();
    let entries = list_directory(directory.to_string_lossy().into_owned()).unwrap();
    assert_eq!(
      entries
        .iter()
        .map(|entry| entry.name.as_str())
        .collect::<Vec<_>>(),
      vec!["loop", ".hidden.md", "broken"]
    );
    assert!(entries
      .iter()
      .any(|entry| entry.name == "loop" && entry.directory && entry.symlink));
    assert!(entries
      .iter()
      .any(|entry| entry.name == "broken" && !entry.directory && entry.symlink));
    assert!(entries
      .iter()
      .any(|entry| entry.name == ".hidden.md" && !entry.directory && !entry.symlink));
    fs::remove_file(symlink).unwrap();
    fs::remove_file(broken_link).unwrap();
    fs::write(&file, "# Changed").unwrap();
    assert_eq!(read_document(path.clone()).unwrap().text, "# Changed");
    fs::remove_file(file).unwrap();
    assert!(read_document(path).is_err());
    for extension in ["typ", "tex"] {
      let source = directory.join(format!("paper.{extension}"));
      fs::write(&source, "Document source").unwrap();
      assert_eq!(
        read_document(source.to_string_lossy().into_owned())
          .unwrap()
          .text,
        "Document source"
      );
      fs::remove_file(source).unwrap();
    }
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

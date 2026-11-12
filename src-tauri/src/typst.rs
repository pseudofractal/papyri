//! Compile with the official Typst CLI.
use crate::{executables, files};
use std::{
  collections::HashMap,
  fs,
  io::{Read, Write},
  path::{Path, PathBuf},
  process::{Child, Command, ExitStatus, Stdio},
  sync::{LazyLock, Mutex},
  thread,
  time::{Duration, Instant},
};

const COMPILE_TIMEOUT: Duration = Duration::from_secs(30);
const DIAGNOSTIC_LIMIT: usize = 32 * 1024;
const DEPENDENCY_LIMIT: u64 = 1024 * 1024;
const MAX_TRACKED_DOCUMENTS: usize = 32;
static COMPILER: Mutex<()> = Mutex::new(());
static DEPENDENCIES: LazyLock<Mutex<HashMap<PathBuf, Vec<PathBuf>>>> =
  LazyLock::new(|| Mutex::new(HashMap::new()));

pub fn is_typst(path: &str) -> bool {
  Path::new(path)
    .extension()
    .is_some_and(|extension| extension.eq_ignore_ascii_case("typ"))
}

fn discover_in_path(search_path: &std::ffi::OsStr, fallback: Option<&str>) -> Option<PathBuf> {
  executables::find_in_path("typst", search_path).or_else(|| {
    fallback
      .map(PathBuf::from)
      .filter(|path| executables::is_executable(path))
  })
}

/// Discover Typst on PATH, falling back to the compiler bundled by Nix.
pub fn discover_binary() -> Option<PathBuf> {
  discover_in_path(
    &std::env::var_os("PATH").unwrap_or_default(),
    option_env!("PAPYRI_TYPST_BINARY"),
  )
}

fn resolve_binary(configured: &str) -> Result<PathBuf, String> {
  if configured.is_empty() {
    return discover_binary()
      .ok_or_else(|| "Typst was not found on PATH. Set its executable path in settings.".into());
  }
  let path = Path::new(configured);
  if !path.is_absolute() || !executables::is_executable(path) {
    return Err(format!(
      "Configured Typst path is not an absolute executable file: {configured}"
    ));
  }
  Ok(path.to_path_buf())
}

/// Include imported files and images from the last successful compilation in live polling.
pub fn stamp(path: String) -> Result<String, String> {
  let canonical = fs::canonicalize(&path).map_err(|error| format!("{path}: {error}"))?;
  let dependencies = DEPENDENCIES.lock().map_err(|error| error.to_string())?;
  let mut result = files::document_stamp(path)?;
  if let Some(paths) = dependencies.get(&canonical) {
    for dependency in paths {
      let stamp = files::document_stamp(dependency.to_string_lossy().into_owned())
        .unwrap_or_else(|error| format!("unavailable:{error}"));
      result.push_str(&format!("|{}:{stamp}", dependency.display()));
    }
  }
  Ok(result)
}

struct OutputDirectory(PathBuf);
impl OutputDirectory {
  fn create() -> Result<Self, String> {
    Ok(Self(files::temporary_directory("papyri-typst")?))
  }
}
impl Drop for OutputDirectory {
  fn drop(&mut self) {
    let _ = fs::remove_dir_all(&self.0);
  }
}

pub(crate) fn drain_bounded(mut pipe: impl Read, limit: usize) -> Result<Vec<u8>, String> {
  let mut bytes = Vec::new();
  pipe
    .by_ref()
    .take(limit as u64 + 1)
    .read_to_end(&mut bytes)
    .map_err(|error| error.to_string())?;
  // Keep draining so the child can exit even after exceeding the retained output budget.
  std::io::copy(&mut pipe, &mut std::io::sink()).map_err(|error| error.to_string())?;
  Ok(bytes)
}

pub(crate) fn wait_with_timeout(
  child: &mut Child,
  timeout: Duration,
) -> Result<Option<ExitStatus>, String> {
  let started = Instant::now();
  loop {
    match child.try_wait() {
      Ok(Some(status)) => return Ok(Some(status)),
      Ok(None) if started.elapsed() < timeout => thread::sleep(Duration::from_millis(50)),
      result => {
        let _ = child.kill();
        let _ = child.wait();
        return result.map(|_| None).map_err(|error| error.to_string());
      }
    }
  }
}

pub fn compile(path: String, configured_path: String) -> Result<Vec<u8>, String> {
  if !is_typst(&path) {
    return Err("Expected a .typ document".into());
  }
  let _compiler = COMPILER
    .try_lock()
    .map_err(|_| "Another Typst preview is compiling. Try opening this document again.")?;
  let canonical = crate::platform::strip_verbatim(
    &fs::canonicalize(&path).map_err(|error| format!("{path}: {error}"))?,
  );
  let project = canonical.parent().ok_or("Document has no parent folder")?;
  let initial_stamp = stamp(path.clone())?;
  let (source, _) = files::bounded_read(&path, files::DOCUMENT_LIMIT)?;
  std::str::from_utf8(&source).map_err(|error| format!("Expected UTF-8 Typst: {error}"))?;
  let output = OutputDirectory::create()?;
  let compiler = resolve_binary(&configured_path)?;
  let mut command = Command::new(&compiler);
  command.current_dir(project);
  command.args([
    "compile",
    "--root",
    project
      .to_str()
      .ok_or("Document folder is not valid UTF-8")?,
    "--ignore-system-fonts",
    "--jobs",
    "2",
    "--diagnostic-format",
    "short",
  ]);
  if project.join("fonts").is_dir() {
    command.arg("--font-path").arg(project.join("fonts"));
  }
  command.arg("--deps").arg(output.0.join("deps.json"));
  command.args(["--format", "pdf", "-", "-"]);
  let mut child = command
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()
    .map_err(|error| format!("Cannot start Typst: {error}"))?;
  let stdout = child.stdout.take().ok_or("Typst output pipe unavailable")?;
  let stderr = child
    .stderr
    .take()
    .ok_or("Typst diagnostic pipe unavailable")?;
  let stdin = child.stdin.take().ok_or("Typst input pipe unavailable")?;
  let input = thread::spawn(move || {
    let mut stdin = stdin;
    stdin.write_all(&source)
  });
  let pdf = thread::spawn(move || drain_bounded(stdout, files::PDF_LIMIT as usize));
  let diagnostics = thread::spawn(move || drain_bounded(stderr, DIAGNOSTIC_LIMIT));
  let status = wait_with_timeout(&mut child, COMPILE_TIMEOUT);
  let input_result = input.join().map_err(|_| "Typst input thread failed")?;
  let bytes = pdf.join().map_err(|_| "Typst output thread failed")??;
  let diagnostics = diagnostics
    .join()
    .map_err(|_| "Typst diagnostic thread failed")??;
  let Some(status) = status? else {
    return Err("Typst compilation exceeded 30 seconds. Last preview retained.".into());
  };
  if !status.success() {
    return Err(format!(
      "Typst compilation failed ({status}): {}",
      String::from_utf8_lossy(&diagnostics)
    ));
  }
  input_result.map_err(|error| format!("Could not pass source to Typst: {error}"))?;
  if bytes.len() as u64 > files::PDF_LIMIT {
    return Err("Compiled PDF exceeds the 64 MiB preview limit".into());
  }
  if !bytes.starts_with(b"%PDF-") {
    return Err("Typst did not produce a PDF".into());
  }
  if stamp(path.clone())? != initial_stamp {
    return Err(
      "The Typst source or a known dependency changed during compilation. Try again.".into(),
    );
  }
  let deps_path = output.0.join("deps.json");
  let (deps, _) = files::bounded_read(&deps_path.to_string_lossy(), DEPENDENCY_LIMIT)?;
  #[derive(serde::Deserialize)]
  struct Dependencies {
    inputs: Vec<String>,
  }
  let paths: Dependencies = serde_json::from_slice(&deps)
    .map_err(|error| format!("Could not read Typst dependency list: {error}"))?;
  let paths = paths
    .inputs
    .iter()
    .filter_map(|dependency| {
      if dependency == "<stdin>" {
        return None;
      }
      let path = Path::new(dependency);
      let relative = if path.is_absolute() {
        path.strip_prefix(project).ok()?
      } else {
        path
      };
      Some(project.join(relative))
    })
    .collect();
  let mut dependencies = DEPENDENCIES.lock().map_err(|error| error.to_string())?;
  if dependencies.len() >= MAX_TRACKED_DOCUMENTS {
    dependencies.clear();
  }
  dependencies.insert(canonical, paths);
  Ok(bytes)
}

#[cfg(all(test, unix))]
mod tests {
  use super::*;
  use std::os::unix::fs::PermissionsExt;
  #[test]
  fn discovers_typst_and_validates_configured_paths() {
    let root = OutputDirectory::create().unwrap();
    let binary = root.0.join("typst");
    fs::write(&binary, "fixture").unwrap();
    fs::set_permissions(&binary, fs::Permissions::from_mode(0o755)).unwrap();
    let search = std::env::join_paths([&root.0]).unwrap();
    assert_eq!(discover_in_path(&search, None), Some(binary.clone()));
    assert_eq!(
      discover_in_path(root.0.join("missing").as_os_str(), binary.to_str()),
      Some(binary.clone())
    );
    assert_eq!(
      discover_in_path(root.0.join("missing").as_os_str(), None),
      None
    );
    assert_eq!(resolve_binary(binary.to_str().unwrap()).unwrap(), binary);
    assert!(resolve_binary("relative/typst").is_err());
    assert!(resolve_binary("/nonexistent/papyri-typst").is_err());
  }
  #[test]
  fn bounds_process_output_and_requires_typst_extension() {
    assert_eq!(drain_bounded(&b"abcdef"[..], 3).unwrap(), b"abcd");
    assert!(compile("/etc/passwd".into(), String::new()).is_err());
  }
  #[test]
  fn terminates_and_reaps_a_timed_out_process() {
    let mut child = Command::new("sleep").arg("10").spawn().unwrap();
    let started = Instant::now();
    assert!(wait_with_timeout(&mut child, Duration::from_millis(100))
      .unwrap()
      .is_none());
    assert!(child.try_wait().unwrap().is_some());
    assert!(started.elapsed() < Duration::from_secs(2));
  }
  #[test]
  #[ignore = "Requires typst on PATH"]
  fn compilation_tracks_dependencies() {
    let root = OutputDirectory::create().unwrap();
    let source = root.0.join("paper.typ");
    let part = root.0.join("part.typ");
    fs::write(&source, "= Native Typst\n#include \"part.typ\"").unwrap();
    fs::write(&part, "Imported content").unwrap();
    let path = source.to_string_lossy().into_owned();
    let pdf = compile(path.clone(), String::new()).unwrap();
    assert!(pdf.starts_with(b"%PDF-"));
    let binary = discover_binary().unwrap();
    assert!(compile(path.clone(), binary.to_string_lossy().into_owned())
      .unwrap()
      .starts_with(b"%PDF-"));
    let custom = OutputDirectory::create().unwrap();
    let custom_binary = custom.0.join("typst");
    fs::write(
      &custom_binary,
      "#!/bin/sh\nprintf 'selected compiler ran\\n' >&2\nexit 29\n",
    )
    .unwrap();
    fs::set_permissions(&custom_binary, fs::Permissions::from_mode(0o755)).unwrap();
    assert!(
      compile(path.clone(), custom_binary.to_string_lossy().into_owned())
        .unwrap_err()
        .contains("selected compiler ran")
    );
    let original = stamp(path.clone()).unwrap();
    fs::write(&part, "Changed dependency with a different length").unwrap();
    assert_ne!(stamp(path.clone()).unwrap(), original);
    fs::remove_file(&part).unwrap();
    assert!(compile(path.clone(), String::new())
      .unwrap_err()
      .contains("part.typ"));
  }
}

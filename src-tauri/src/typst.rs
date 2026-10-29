//! Compile with the official CLI inside a read-only, network-isolated Linux sandbox.
use crate::files;
use std::{
  collections::HashMap,
  fs,
  io::{Read, Write},
  os::unix::fs::DirBuilderExt,
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
const COMPILER_MEMORY_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const COMPILER_CPU_SECONDS: u64 = 25;
static COMPILER: Mutex<()> = Mutex::new(());
static DEPENDENCIES: LazyLock<Mutex<HashMap<PathBuf, Vec<PathBuf>>>> =
  LazyLock::new(|| Mutex::new(HashMap::new()));

pub fn is_typst(path: &str) -> bool {
  Path::new(path)
    .extension()
    .is_some_and(|extension| extension.eq_ignore_ascii_case("typ"))
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
    let mut entropy = [0u8; 16];
    getrandom::fill(&mut entropy).map_err(|error| error.to_string())?;
    let suffix: String = entropy.iter().map(|byte| format!("{byte:02x}")).collect();
    let path = std::env::temp_dir().join(format!("papyri-typst-{suffix}"));
    fs::DirBuilder::new()
      .mode(0o700)
      .create(&path)
      .map_err(|error| error.to_string())?;
    Ok(Self(path))
  }
}
impl Drop for OutputDirectory {
  fn drop(&mut self) {
    let _ = fs::remove_dir_all(&self.0);
  }
}

fn bind_packages(command: &mut Command, variable: &str, fallback: &str, destination: &str) {
  let home = std::env::var_os("HOME").map(PathBuf::from);
  let base = std::env::var_os(variable)
    .map(PathBuf::from)
    .or_else(|| home.map(|home| home.join(fallback)));
  if let Some(path) = base.map(|base| base.join("typst/packages")) {
    if path.is_absolute() && path.is_dir() {
      command.arg("--ro-bind").arg(path).arg(destination);
    }
  }
}

fn drain_bounded(mut pipe: impl Read, limit: usize) -> Result<Vec<u8>, String> {
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

fn wait_with_timeout(child: &mut Child, timeout: Duration) -> Result<Option<ExitStatus>, String> {
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

pub fn compile(path: String) -> Result<Vec<u8>, String> {
  if !is_typst(&path) {
    return Err("Expected a .typ document".into());
  }
  let _compiler = COMPILER
    .try_lock()
    .map_err(|_| "Another Typst preview is compiling. Try opening this document again.")?;
  let canonical = fs::canonicalize(&path).map_err(|error| format!("{path}: {error}"))?;
  let project = canonical.parent().ok_or("Document has no parent folder")?;
  let (source, _) = files::bounded_read(&path, files::DOCUMENT_LIMIT)?;
  std::str::from_utf8(&source).map_err(|error| format!("Expected UTF-8 Typst: {error}"))?;
  let output = OutputDirectory::create()?;
  let compiler = option_env!("PAPYRI_TYPST_BINARY").unwrap_or("typst");
  let sandbox = option_env!("PAPYRI_BWRAP_BINARY").unwrap_or("bwrap");
  let limiter = option_env!("PAPYRI_PRLIMIT_BINARY").unwrap_or("prlimit");
  let mut command = Command::new(limiter);
  command.args([
    format!("--as={COMPILER_MEMORY_BYTES}"),
    format!("--cpu={COMPILER_CPU_SECONDS}"),
    format!("--fsize={}", files::PDF_LIMIT),
    "--".into(),
    sandbox.into(),
  ]);
  command.args([
    "--unshare-all",
    "--new-session",
    "--die-with-parent",
    "--cap-drop",
    "ALL",
    "--ro-bind",
    "/nix/store",
    "/nix/store",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--tmpfs",
    "/tmp",
    "--dir",
    "/packages/local",
    "--dir",
    "/packages/cache",
    "--clearenv",
    "--setenv",
    "HOME",
    "/tmp",
    "--setenv",
    "LANG",
    "C.UTF-8",
    "--ro-bind",
  ]);
  command.arg(project).arg("/project");
  command.arg("--bind").arg(&output.0).arg("/output");
  bind_packages(
    &mut command,
    "XDG_DATA_HOME",
    ".local/share",
    "/packages/local",
  );
  bind_packages(&mut command, "XDG_CACHE_HOME", ".cache", "/packages/cache");
  command.args([
    "--chdir",
    "/project",
    "--",
    compiler,
    "compile",
    "--root",
    "/project",
    "--ignore-system-fonts",
    "--package-path",
    "/packages/local",
    "--package-cache-path",
    "/packages/cache",
    "--jobs",
    "2",
    "--diagnostic-format",
    "short",
  ]);
  if project.join("fonts").is_dir() {
    command.args(["--font-path", "/project/fonts"]);
  }
  command.args(["--deps", "/output/deps.json", "--format", "pdf", "-", "-"]);
  let mut child = command
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()
    .map_err(|error| {
      format!("Cannot start sandboxed Typst: {error}. Use the Nix package or dev shell.")
    })?;
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
      "Typst compilation failed ({status}): {}\nCompilation requires Linux user namespaces. Imports must stay in the document folder; packages must already be cached.",
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
        path.strip_prefix("/project").ok()?
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

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn bounds_process_output_and_requires_typst_extension() {
    assert_eq!(drain_bounded(&b"abcdef"[..], 3).unwrap(), b"abcd");
    assert!(compile("/etc/passwd".into()).is_err());
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
  #[ignore = "Requires Linux user namespaces; run outside the Nix build sandbox"]
  fn sandboxed_compilation_dependencies_and_resource_limits() {
    let root = OutputDirectory::create().unwrap();
    let source = root.0.join("paper.typ");
    let part = root.0.join("part.typ");
    fs::write(&source, "= Native Typst\n#include \"part.typ\"").unwrap();
    fs::write(&part, "Imported content").unwrap();
    let path = source.to_string_lossy().into_owned();
    let pdf = compile(path.clone()).unwrap();
    assert!(pdf.starts_with(b"%PDF-"));
    assert_eq!(fs::read_dir(&root.0).unwrap().count(), 2);
    let original = stamp(path.clone()).unwrap();
    fs::write(&part, "Changed dependency with a different length").unwrap();
    assert_ne!(stamp(path.clone()).unwrap(), original);
    fs::remove_file(&part).unwrap();
    assert!(compile(path.clone()).unwrap_err().contains("part.typ"));

    let secret = OutputDirectory::create().unwrap();
    fs::write(secret.0.join("secret.txt"), "Private sibling content").unwrap();
    std::os::unix::fs::symlink(secret.0.join("secret.txt"), root.0.join("escape.txt")).unwrap();
    fs::write(&source, "#read(\"escape.txt\")").unwrap();
    assert!(compile(path.clone())
      .unwrap_err()
      .contains("Typst compilation failed"));
    fs::write(
      &source,
      "#import \"@preview/papyri-nonexistent-package:0.0.0\": *",
    )
    .unwrap();
    assert!(compile(path.clone()).is_err());
    fs::write(&source, "#let index = 0\n#while index >= 0 { index += 1 }").unwrap();
    assert!(compile(path)
      .unwrap_err()
      .contains("loop seems to be infinite"));
  }
}

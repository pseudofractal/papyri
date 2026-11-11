//! Discover user-installed LaTeX engines and compile documents in an isolated sandbox.
use crate::{
  executables::{find_in_path, is_executable as executable},
  files, typst,
};
use serde::Serialize;
use std::{
  collections::HashMap,
  ffi::OsStr,
  fs,
  io::Read,
  os::unix::fs::DirBuilderExt,
  path::{Path, PathBuf},
  process::{Command, Stdio},
  sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, LazyLock, Mutex, TryLockError,
  },
  thread,
  time::{Duration, Instant},
};

const ENGINES: [&str; 3] = ["lualatex", "pdflatex", "xelatex"];
const DIAGNOSTIC_LIMIT: usize = 32 * 1024;
const COMPILER_MEMORY_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const COMPILER_CPU_SECONDS: u64 = 25;
const COMPILER_TIMEOUT: Duration = Duration::from_secs(30);
static COMPILER: Mutex<()> = Mutex::new(());
static NEXT_COMPILE_ID: AtomicU64 = AtomicU64::new(1);

struct ActiveCompile {
  id: u64,
  path: String,
  engine: String,
  started: Instant,
  cancel: Arc<AtomicBool>,
}

static ACTIVE_COMPILE: Mutex<Option<ActiveCompile>> = Mutex::new(None);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompileStatus {
  pub id: u64,
  pub path: String,
  pub engine: String,
  pub elapsed_seconds: f64,
}

struct ActiveCompileGuard(u64);

impl ActiveCompileGuard {
  fn install(id: u64, path: String, engine: String, cancel: Arc<AtomicBool>) -> Self {
    let mut active = lock_active();
    *active = Some(ActiveCompile {
      id,
      path,
      engine,
      started: Instant::now(),
      cancel,
    });
    Self(id)
  }
}

impl Drop for ActiveCompileGuard {
  fn drop(&mut self) {
    let mut active = lock_active();
    if active.as_ref().is_some_and(|compile| compile.id == self.0) {
      *active = None;
    }
  }
}

fn lock_active() -> std::sync::MutexGuard<'static, Option<ActiveCompile>> {
  ACTIVE_COMPILE
    .lock()
    .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Return the LaTeX preview currently being compiled, if any.
pub fn compile_status() -> Option<CompileStatus> {
  lock_active().as_ref().map(|compile| CompileStatus {
    id: compile.id,
    path: compile.path.clone(),
    engine: compile.engine.clone(),
    elapsed_seconds: compile.started.elapsed().as_secs_f64(),
  })
}

fn compile_busy_error() -> String {
  match compile_status() {
    Some(compile) => format!(
      "Another LaTeX preview is compiling: {} ({}, {:.1}s). Stop it or wait, then try again.",
      compile.path, compile.engine, compile.elapsed_seconds
    ),
    None => "Another LaTeX preview is compiling. Try again.".into(),
  }
}

/// Request cancellation of the active compile, optionally only for one path.
/// Waits briefly for the compiler lock so a new compile can start immediately.
pub fn cancel_compile(path: Option<String>) -> bool {
  let cancel = {
    let active = lock_active();
    match active.as_ref() {
      Some(compile)
        if path
          .as_ref()
          .is_none_or(|requested| requested == &compile.path) =>
      {
        Some(compile.cancel.clone())
      }
      _ => None,
    }
  };
  let Some(cancel) = cancel else {
    return false;
  };
  cancel.store(true, Ordering::Relaxed);
  let started = Instant::now();
  while started.elapsed() < Duration::from_secs(5) {
    if lock_active().is_none() {
      break;
    }
    thread::sleep(Duration::from_millis(20));
  }
  true
}

enum WaitOutcome {
  Completed(std::process::ExitStatus),
  TimedOut,
  Cancelled,
}

fn wait_with_cancel(
  child: &mut std::process::Child,
  timeout: Duration,
  cancel: &AtomicBool,
) -> Result<WaitOutcome, String> {
  let started = Instant::now();
  loop {
    if cancel.load(Ordering::Relaxed) {
      let _ = child.kill();
      let _ = child.wait();
      return Ok(WaitOutcome::Cancelled);
    }
    match child.try_wait() {
      Ok(Some(status)) => return Ok(WaitOutcome::Completed(status)),
      Ok(None) if started.elapsed() < timeout => thread::sleep(Duration::from_millis(50)),
      result => {
        let _ = child.kill();
        let _ = child.wait();
        return match result {
          Ok(_) => Ok(WaitOutcome::TimedOut),
          Err(error) => Err(error.to_string()),
        };
      }
    }
  }
}
static DEPENDENCIES: LazyLock<Mutex<HashMap<PathBuf, Vec<PathBuf>>>> =
  LazyLock::new(|| Mutex::new(HashMap::new()));
static SYNC_ARTIFACTS: LazyLock<Mutex<HashMap<String, SyncArtifact>>> =
  LazyLock::new(|| Mutex::new(HashMap::new()));
pub fn release_sync(id: &str) -> Result<(), String> {
  SYNC_ARTIFACTS
    .lock()
    .map_err(|error| error.to_string())?
    .remove(id);
  Ok(())
}
struct SyncArtifact {
  output: OutputDirectory,
  project: PathBuf,
  job_name: String,
  compiler: PathBuf,
}

#[derive(Serialize)]
pub struct Engine {
  name: &'static str,
  path: Option<PathBuf>,
}

fn tex_distribution_root<'a>(executable: &'a Path, home: Option<&Path>) -> Option<&'a Path> {
  executable.ancestors().find(|parent| {
    parent.is_absolute()
      && *parent != Path::new("/")
      && home != Some(*parent)
      && parent.join("texmf-dist").is_dir()
  })
}

fn bind_tex_distribution(command: &mut Command, executable: &Path) {
  let home = std::env::var_os("HOME").map(PathBuf::from);
  if let Some(root) = tex_distribution_root(executable, home.as_deref()) {
    command.arg("--ro-bind").arg(root).arg(root);
  }
}

fn sandbox_executable(executable: &Path, name: &str) -> PathBuf {
  let home = std::env::var_os("HOME").map(PathBuf::from);
  if tex_distribution_root(executable, home.as_deref()).is_some() {
    executable.to_path_buf()
  } else {
    Path::new("/compiler").join(name)
  }
}

fn resolve_engine(
  name: &str,
  configured_path: Option<&Path>,
  search_path: &OsStr,
) -> Result<PathBuf, String> {
  if !ENGINES.contains(&name) {
    return Err(format!("Unsupported LaTeX engine: {name}"));
  }
  if let Some(path) = configured_path {
    if !path.is_absolute() || !executable(path) {
      return Err(format!(
        "Configured {name} path is not an absolute executable file: {}",
        path.display()
      ));
    }
    return Ok(path.to_owned());
  }
  find_in_path(name, search_path)
    .ok_or_else(|| format!("{name} was not found on PATH. Set its executable path in settings."))
}

/// Find the supported engine commands using the process's inherited PATH.
pub fn discover_engines() -> Vec<Engine> {
  let search_path = std::env::var_os("PATH").unwrap_or_default();
  ENGINES
    .iter()
    .map(|&name| Engine {
      name,
      path: resolve_engine(name, None, &search_path).ok(),
    })
    .collect()
}

pub fn is_latex(path: &str) -> bool {
  Path::new(path)
    .extension()
    .is_some_and(|ext| ext.eq_ignore_ascii_case("tex"))
}

pub fn stamp(path: String) -> Result<String, String> {
  let canonical = fs::canonicalize(&path).map_err(|error| format!("{path}: {error}"))?;
  let mut result = files::document_stamp(path)?;
  let dependencies = DEPENDENCIES.lock().map_err(|error| error.to_string())?;
  if let Some(paths) = dependencies.get(&canonical) {
    for dependency in paths {
      let value = match fs::canonicalize(dependency) {
        Ok(resolved) if resolved.starts_with(canonical.parent().unwrap_or(Path::new("/"))) => {
          files::document_stamp(dependency.to_string_lossy().into_owned())
            .unwrap_or_else(|error| format!("unavailable:{error}"))
        }
        _ => "unavailable".into(),
      };
      result.push_str(&format!("|{}:{value}", dependency.display()));
    }
  }
  Ok(result)
}

fn read_output(directory: &Path, name: &str, limit: u64) -> Result<Vec<u8>, String> {
  let path = directory.join(name);
  let metadata =
    fs::symlink_metadata(&path).map_err(|error| format!("{}: {error}", path.display()))?;
  if !metadata.file_type().is_file() {
    return Err(format!("{} is not a regular output file", path.display()));
  }
  files::bounded_read(&path.to_string_lossy(), limit).map(|(bytes, _)| bytes)
}

struct OutputDirectory(PathBuf);
impl OutputDirectory {
  fn create() -> Result<Self, String> {
    let mut entropy = [0u8; 16];
    getrandom::fill(&mut entropy).map_err(|error| error.to_string())?;
    let suffix: String = entropy.iter().map(|byte| format!("{byte:02x}")).collect();
    let path = std::env::temp_dir().join(format!("papyri-latex-{suffix}"));
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

fn bibliography_tool(compiler: &Path, search_path: &OsStr, name: &str) -> Result<PathBuf, String> {
  let beside_compiler = compiler.with_file_name(name);
  if executable(&beside_compiler) {
    return Ok(beside_compiler);
  }
  find_in_path(name, search_path).ok_or_else(|| {
    format!(
      "{name} is required for this bibliography but was not found next to the compiler or on PATH."
    )
  })
}

fn diagnostic_tail(mut pipe: impl Read) -> Result<Vec<u8>, String> {
  let mut result = Vec::new();
  let mut buffer = [0; 4096];
  loop {
    let read = pipe.read(&mut buffer).map_err(|error| error.to_string())?;
    if read == 0 {
      return Ok(result);
    }
    let excess = (result.len() + read).saturating_sub(DIAGNOSTIC_LIMIT);
    result.drain(..excess);
    result.extend_from_slice(&buffer[..read]);
  }
}

fn sandbox_command(project: &Path, output: &Path, binary: &Path, name: &str) -> Command {
  let sandbox = option_env!("PAPYRI_BWRAP_BINARY").unwrap_or("bwrap");
  let limiter = option_env!("PAPYRI_PRLIMIT_BINARY").unwrap_or("prlimit");
  let mut command = Command::new(limiter);
  command.arg(format!("--as={COMPILER_MEMORY_BYTES}"));
  command.arg(format!("--cpu={COMPILER_CPU_SECONDS}"));
  command.arg(format!("--fsize={}", files::PDF_LIMIT));
  command.args([
    "--",
    sandbox,
    "--unshare-all",
    "--new-session",
    "--die-with-parent",
    "--cap-drop",
    "ALL",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--tmpfs",
    "/tmp",
    "--dir",
    "/compiler",
  ]);
  for directory in [
    "/nix/store",
    "/usr",
    "/bin",
    "/lib",
    "/lib64",
    "/etc/fonts",
    "/etc/texmf",
    "/var/lib/texmf",
  ] {
    if Path::new(directory).exists() {
      command.args(["--ro-bind", directory, directory]);
    }
  }
  command.arg("--ro-bind").arg(project).arg("/project");
  bind_tex_distribution(&mut command, binary);
  command.arg("--bind").arg(output).arg("/output");
  command
    .arg("--ro-bind")
    .arg(binary)
    .arg(format!("/compiler/{name}"));
  command.args([
    "--clearenv",
    "--setenv",
    "HOME",
    "/tmp",
    "--setenv",
    "LANG",
    "C.UTF-8",
    "--setenv",
    "PATH",
    "/compiler:/usr/bin:/bin",
  ]);
  command
}

fn run_bibtex(
  project: &Path,
  output: &Path,
  binary: &Path,
  job_name: &str,
  cancel: &AtomicBool,
) -> Result<(), String> {
  let mut command = sandbox_command(project, output, binary, "bibtex");
  command.args([
    "--setenv",
    "BIBINPUTS",
    "/project//:",
    "--setenv",
    "BSTINPUTS",
    "/project//:",
    "--chdir",
    "/output",
    "--",
  ]);
  command.arg(sandbox_executable(binary, "bibtex"));
  command.arg(job_name);
  let mut child = command
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()
    .map_err(|error| format!("Cannot start sandboxed BibTeX: {error}"))?;
  let stdout = child
    .stdout
    .take()
    .ok_or("BibTeX output pipe unavailable")?;
  let stderr = child
    .stderr
    .take()
    .ok_or("BibTeX diagnostic pipe unavailable")?;
  let out = thread::spawn(move || diagnostic_tail(stdout));
  let err = thread::spawn(move || diagnostic_tail(stderr));
  let status = wait_with_cancel(&mut child, COMPILER_TIMEOUT, cancel);
  let stdout = out.join().map_err(|_| "BibTeX output thread failed")??;
  let stderr = err
    .join()
    .map_err(|_| "BibTeX diagnostic thread failed")??;
  let status = match status? {
    WaitOutcome::Completed(status) => status,
    WaitOutcome::TimedOut => return Err("BibTeX compilation exceeded 30 seconds".into()),
    WaitOutcome::Cancelled => return Err("LaTeX compilation cancelled.".into()),
  };
  let output_text = String::from_utf8_lossy(&stdout);
  if !status.success() || output_text.contains("Warning--I didn't find a database entry") {
    return Err(format!(
      "BibTeX failed ({status}):\n{}\n{}",
      output_text,
      String::from_utf8_lossy(&stderr)
    ));
  }
  Ok(())
}

/// Compile a LaTeX entry point to an isolated temporary PDF.
pub fn compile(path: String, engine: String, configured_path: String) -> Result<Vec<u8>, String> {
  compile_snapshot(path, engine, configured_path, None)
}

/// Compile an optional unsaved entry-point snapshot without modifying the project.
pub fn compile_snapshot(
  path: String,
  engine: String,
  configured_path: String,
  draft: Option<String>,
) -> Result<Vec<u8>, String> {
  compile_internal(path, engine, configured_path, draft, Vec::new(), false)
}

pub fn compile_preview(
  path: String,
  engine: String,
  configured_path: String,
  draft: String,
  overlays: Vec<(String, String)>,
) -> Result<Vec<u8>, String> {
  compile_internal(path, engine, configured_path, Some(draft), overlays, true)
}

fn compile_internal(
  path: String,
  engine: String,
  configured_path: String,
  draft: Option<String>,
  overlays: Vec<(String, String)>,
  retain_sync: bool,
) -> Result<Vec<u8>, String> {
  if !is_latex(&path) {
    return Err("Expected a .tex document".into());
  }
  let _compiler = match COMPILER.try_lock() {
    Ok(guard) => guard,
    Err(TryLockError::Poisoned(poisoned)) => poisoned.into_inner(),
    Err(TryLockError::WouldBlock) => return Err(compile_busy_error()),
  };
  let compile_id = NEXT_COMPILE_ID.fetch_add(1, Ordering::Relaxed);
  let cancel = Arc::new(AtomicBool::new(false));
  let _active =
    ActiveCompileGuard::install(compile_id, path.clone(), engine.clone(), cancel.clone());
  if cancel.load(Ordering::Relaxed) {
    return Err("LaTeX compilation cancelled.".into());
  }
  let search_path = std::env::var_os("PATH").unwrap_or_default();
  let configured = if configured_path.is_empty() {
    None
  } else {
    Some(Path::new(&configured_path))
  };
  let compiler = resolve_engine(&engine, configured, &search_path)?;
  let canonical = fs::canonicalize(&path).map_err(|error| format!("{path}: {error}"))?;
  let initial_stamp = stamp(path.clone())?;
  let project = canonical.parent().ok_or("Document has no parent folder")?;
  let filename = canonical.file_name().ok_or("Document has no filename")?;
  let job_name = canonical
    .file_stem()
    .and_then(OsStr::to_str)
    .ok_or("Expected a UTF-8 document filename")?;
  files::bounded_read(&path, files::DOCUMENT_LIMIT)?;
  let output = OutputDirectory::create()?;
  let draft_path = if let Some(text) = draft {
    if text.len() as u64 > files::DOCUMENT_LIMIT {
      return Err("This document exceeds the source size limit.".into());
    }
    let draft_path = output.0.join("draft.tex");
    fs::write(&draft_path, text).map_err(|error| format!("Cannot prepare LaTeX draft: {error}"))?;
    Some(draft_path)
  } else {
    None
  };
  if overlays.len() > 100 {
    return Err("Too many unsaved LaTeX files".into());
  }
  let mut overlay_paths = Vec::new();
  let mut overlay_bytes = 0u64;
  for (index, (name, text)) in overlays.into_iter().enumerate() {
    let source = fs::canonicalize(&name).map_err(|error| format!("{name}: {error}"))?;
    let relative = source
      .strip_prefix(project)
      .map_err(|_| "Draft is outside the document folder")?;
    if source == canonical {
      continue;
    }
    if !is_latex(&name) {
      return Err("Expected a .tex draft".into());
    }
    overlay_bytes = overlay_bytes.saturating_add(text.len() as u64);
    if overlay_bytes > files::DOCUMENT_LIMIT {
      return Err("LaTeX drafts exceed the source size limit".into());
    }
    let temporary = output.0.join(format!("draft-{index}.tex"));
    fs::write(&temporary, text).map_err(|error| format!("Cannot prepare LaTeX draft: {error}"))?;
    overlay_paths.push((temporary, Path::new("/project").join(relative)));
  }
  let mut bibliography = Vec::new();
  let mut needs_bibtex = false;
  let mut passes = 2;
  let mut pass = 0;
  while pass < passes {
    if cancel.load(Ordering::Relaxed) {
      return Err("LaTeX compilation cancelled.".into());
    }
    let mut command = sandbox_command(project, &output.0, &compiler, &engine);
    if let Some(draft_path) = &draft_path {
      command
        .arg("--ro-bind")
        .arg(draft_path)
        .arg(Path::new("/project").join(filename));
    }
    for (draft, target) in &overlay_paths {
      command.arg("--ro-bind").arg(draft).arg(target);
    }
    if engine == "xelatex" {
      let driver = compiler.with_file_name("xdvipdfmx");
      if executable(&driver) {
        command
          .arg("--ro-bind")
          .arg(driver)
          .arg("/compiler/xdvipdfmx");
      }
    }
    command.args(["--chdir", "/project", "--"]);
    command.arg(sandbox_executable(&compiler, &engine));
    command.args([
      "-no-shell-escape",
      "-interaction=nonstopmode",
      "-halt-on-error",
      "-file-line-error",
      "-recorder",
      "-synctex=1",
      "-output-directory=/output",
    ]);
    command.arg(format!("-jobname={job_name}"));
    command.arg(Path::new("/project").join(filename));
    let mut child = command
      .stdin(Stdio::null())
      .stdout(Stdio::piped())
      .stderr(Stdio::piped())
      .spawn()
      .map_err(|error| format!("Cannot start sandboxed LaTeX: {error}"))?;
    let stdout = child.stdout.take().ok_or("LaTeX output pipe unavailable")?;
    let stderr = child
      .stderr
      .take()
      .ok_or("LaTeX diagnostic pipe unavailable")?;
    let out = thread::spawn(move || diagnostic_tail(stdout));
    let err = thread::spawn(move || diagnostic_tail(stderr));
    let status = wait_with_cancel(&mut child, COMPILER_TIMEOUT, &cancel);
    let stdout = out.join().map_err(|_| "LaTeX output thread failed")??;
    let stderr = err.join().map_err(|_| "LaTeX diagnostic thread failed")??;
    let status = match status? {
      WaitOutcome::Completed(status) => status,
      WaitOutcome::TimedOut => return Err("LaTeX compilation exceeded 30 seconds".into()),
      WaitOutcome::Cancelled => return Err("LaTeX compilation cancelled.".into()),
    };
    if !status.success() {
      return Err(format!(
        "{engine} compilation failed ({status}):\n{}\n{}",
        String::from_utf8_lossy(&stdout),
        String::from_utf8_lossy(&stderr)
      ));
    }
    pass += 1;
    if pass == 1 {
      if output.0.join(format!("{job_name}.bcf")).exists() {
        return Err(
          "This document requires Biber, which is not supported yet. Open an exported PDF instead."
            .into(),
        );
      }
      let aux = read_output(&output.0, &format!("{job_name}.aux"), 1024 * 1024)?;
      for line in String::from_utf8_lossy(&aux).lines() {
        if let Some(style) = line
          .strip_prefix("\\bibstyle{")
          .and_then(|text| text.strip_suffix('}'))
        {
          let style = Path::new(style);
          if !style.is_absolute()
            && !style
              .components()
              .any(|component| matches!(component, std::path::Component::ParentDir))
          {
            let path = if style.extension().is_some() {
              project.join(style)
            } else {
              project.join(style).with_extension("bst")
            };
            if path.is_file() {
              bibliography.push(path);
            }
          }
        }
        if let Some(names) = line
          .strip_prefix("\\bibdata{")
          .and_then(|text| text.strip_suffix('}'))
        {
          needs_bibtex = true;
          for name in names.split(',') {
            let name = name.trim();
            let path = Path::new(name);
            if path.is_absolute()
              || path
                .components()
                .any(|component| matches!(component, std::path::Component::ParentDir))
            {
              return Err("BibTeX bibliography files must be inside the project folder.".into());
            }
            let dependency = if path.extension().is_some() {
              project.join(path)
            } else {
              project.join(format!("{name}.bib"))
            };
            bibliography.push(dependency);
          }
        }
      }
      if needs_bibtex {
        if cancel.load(Ordering::Relaxed) {
          return Err("LaTeX compilation cancelled.".into());
        }
        let tool = bibliography_tool(&compiler, &search_path, "bibtex")?;
        run_bibtex(project, &output.0, &tool, job_name, &cancel)?;
        passes = 3;
      }
    }
  }
  let pdf = read_output(&output.0, &format!("{job_name}.pdf"), files::PDF_LIMIT)?;
  if !pdf.starts_with(b"%PDF-") {
    return Err("LaTeX did not produce a PDF".into());
  }
  if stamp(path.clone())? != initial_stamp {
    return Err(
      "The LaTeX source or a known dependency changed during compilation. Try again.".into(),
    );
  }
  let recorder = read_output(&output.0, &format!("{job_name}.fls"), 1024 * 1024)?;
  let mut paths = bibliography;
  for line in String::from_utf8_lossy(&recorder).lines() {
    if let Some(input) = line.strip_prefix("INPUT ") {
      let input = Path::new(input);
      let relative = if input.is_absolute() {
        input.strip_prefix("/project").ok()
      } else {
        Some(input)
      };
      if let Some(relative) = relative {
        if relative
          .components()
          .any(|component| matches!(component, std::path::Component::ParentDir))
        {
          continue;
        }
        let dependency = project.join(relative);
        if dependency != canonical && dependency.starts_with(project) {
          paths.push(dependency);
        }
      }
    }
  }
  let mut dependencies = DEPENDENCIES.lock().map_err(|error| error.to_string())?;
  if dependencies.len() >= 32 {
    dependencies.clear();
  }
  dependencies.insert(canonical.clone(), paths);
  if retain_sync {
    read_output(
      &output.0,
      &format!("{job_name}.synctex.gz"),
      files::PDF_LIMIT,
    )?;
    let id = output
      .0
      .file_name()
      .and_then(OsStr::to_str)
      .and_then(|name| name.strip_prefix("papyri-latex-"))
      .ok_or("Invalid preview identifier")?
      .to_owned();
    let mut artifacts = SYNC_ARTIFACTS.lock().map_err(|error| error.to_string())?;
    if artifacts.len() >= 16 {
      artifacts.clear();
    }
    artifacts.insert(
      id.clone(),
      SyncArtifact {
        output,
        project: project.to_path_buf(),
        job_name: job_name.to_owned(),
        compiler,
      },
    );
    let mut response = id.into_bytes();
    response.extend(pdf);
    Ok(response)
  } else {
    Ok(pdf)
  }
}

/// Query the SyncTeX data belonging to one retained preview.
pub fn sync_query(
  id: String,
  source: Option<String>,
  line: Option<u32>,
  page: Option<u32>,
  x: Option<f64>,
  y: Option<f64>,
) -> Result<String, String> {
  let artifacts = SYNC_ARTIFACTS.lock().map_err(|error| error.to_string())?;
  let artifact = artifacts
    .get(&id)
    .ok_or("The preview synchronization data has expired. Recompile the document.")?;
  let path = std::env::var_os("PATH").unwrap_or_default();
  let executable = bibliography_tool(&artifact.compiler, &path, "synctex")?;
  let pdf = format!("/output/{}.pdf", artifact.job_name);
  let mut command = sandbox_command(
    &artifact.project,
    &artifact.output.0,
    &executable,
    "synctex",
  );
  command.args(["--chdir", "/project", "--"]);
  command.arg(sandbox_executable(&executable, "synctex"));
  if let (Some(source), Some(line)) = (source, line) {
    let canonical = fs::canonicalize(&source).map_err(|error| format!("{source}: {error}"))?;
    let relative = canonical
      .strip_prefix(&artifact.project)
      .map_err(|_| "Source is outside the document folder")?;
    if line == 0 {
      return Err("Invalid source line".into());
    }
    command
      .arg("view")
      .arg("-i")
      .arg(format!("{line}:0:/project/{}", relative.display()))
      .arg("-o")
      .arg(pdf);
  } else if let (Some(page), Some(x), Some(y)) = (page, x, y) {
    if page == 0 || !x.is_finite() || !y.is_finite() || x < 0.0 || y < 0.0 {
      return Err("Invalid PDF position".into());
    }
    command
      .arg("edit")
      .arg("-o")
      .arg(format!("{page}:{x}:{y}:{pdf}"));
  } else {
    return Err("Invalid synchronization request".into());
  }
  let mut child = command
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()
    .map_err(|error| format!("Cannot run SyncTeX: {error}"))?;
  let stdout = child
    .stdout
    .take()
    .ok_or("SyncTeX output pipe unavailable")?;
  let stderr = child
    .stderr
    .take()
    .ok_or("SyncTeX diagnostic pipe unavailable")?;
  let out = thread::spawn(move || diagnostic_tail(stdout));
  let err = thread::spawn(move || diagnostic_tail(stderr));
  let status = typst::wait_with_timeout(&mut child, COMPILER_TIMEOUT);
  let stdout = out.join().map_err(|_| "SyncTeX output thread failed")??;
  let stderr = err
    .join()
    .map_err(|_| "SyncTeX diagnostic thread failed")??;
  let status = status?.ok_or("SyncTeX search timed out")?;
  if !status.success() {
    return Err(format!(
      "SyncTeX failed: {}",
      String::from_utf8_lossy(&stderr)
    ));
  }
  let result = String::from_utf8(stdout).map_err(|error| error.to_string())?;
  let mut mapped = String::new();
  for line in result.lines() {
    if let Some(input) = line.strip_prefix("Input:") {
      let input = Path::new(input);
      let relative = if input.is_absolute() {
        input
          .strip_prefix("/project")
          .map_err(|_| "SyncTeX source is outside the document folder")?
      } else {
        input
      };
      let resolved = fs::canonicalize(artifact.project.join(relative))
        .map_err(|error| format!("Cannot resolve SyncTeX source: {error}"))?;
      if !resolved.starts_with(&artifact.project) {
        return Err("SyncTeX source is outside the document folder".into());
      }
      mapped.push_str(&format!("Input:{}\n", resolved.display()));
    } else {
      mapped.push_str(line);
      mapped.push('\n');
    }
  }
  Ok(mapped)
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::io::Write;
  use std::os::unix::fs::PermissionsExt;

  #[test]
  fn retains_the_end_of_long_diagnostics() {
    let mut message = vec![b'x'; DIAGNOSTIC_LIMIT];
    message.extend_from_slice(b"error at end");
    let result = diagnostic_tail(&message[..]).unwrap();
    assert_eq!(result.len(), DIAGNOSTIC_LIMIT);
    assert!(result.ends_with(b"error at end"));
  }

  #[test]
  fn refuses_symlinked_compiler_output() {
    let output = OutputDirectory::create().unwrap();
    std::os::unix::fs::symlink("/etc/passwd", output.0.join("papyri.pdf")).unwrap();
    assert!(read_output(&output.0, "papyri.pdf", files::PDF_LIMIT).is_err());
  }

  #[test]
  fn does_not_mount_the_home_directory_as_a_tex_distribution() {
    let home = OutputDirectory::create().unwrap();
    fs::create_dir(home.0.join("texmf-dist")).unwrap();
    let executable = home.0.join("bin/lualatex");
    assert_eq!(tex_distribution_root(&executable, Some(&home.0)), None);
    assert_eq!(
      tex_distribution_root(&executable, None),
      Some(home.0.as_path())
    );
  }

  #[test]
  fn keeps_distribution_executables_at_their_original_path_in_the_sandbox() {
    let distribution = OutputDirectory::create().unwrap();
    fs::create_dir(distribution.0.join("texmf-dist")).unwrap();
    let executable = distribution.0.join("bin/x86_64-linux/lualatex");
    assert_eq!(sandbox_executable(&executable, "lualatex"), executable);
    assert_eq!(
      sandbox_executable(Path::new("/opt/lualatex"), "lualatex"),
      Path::new("/compiler/lualatex")
    );
  }

  #[test]
  fn reports_and_cancels_active_compiles() {
    let cancel = Arc::new(AtomicBool::new(false));
    let guard = ActiveCompileGuard::install(
      9_401,
      "/tmp/one.tex".into(),
      "lualatex".into(),
      cancel.clone(),
    );
    let status = compile_status().expect("active compile");
    assert_eq!(status.path, "/tmp/one.tex");
    assert_eq!(status.engine, "lualatex");
    assert!(!cancel_compile(Some("/tmp/other.tex".into())));
    assert!(!cancel.load(Ordering::Relaxed));

    let waiter = thread::spawn(move || {
      thread::sleep(Duration::from_millis(100));
      drop(guard);
    });
    assert!(cancel_compile(Some("/tmp/one.tex".into())));
    assert!(cancel.load(Ordering::Relaxed));
    waiter.join().unwrap();
    assert!(compile_status().is_none());
  }

  #[test]
  fn cancelling_wait_kills_the_child() {
    let mut child = Command::new("sleep").arg("10").spawn().unwrap();
    let cancel = Arc::new(AtomicBool::new(false));
    let flag = cancel.clone();
    let request = thread::spawn(move || {
      thread::sleep(Duration::from_millis(100));
      flag.store(true, Ordering::Relaxed);
    });
    let outcome = wait_with_cancel(&mut child, Duration::from_secs(30), &cancel).unwrap();
    assert!(matches!(outcome, WaitOutcome::Cancelled));
    request.join().unwrap();
  }

  #[test]
  fn waiting_times_out_and_kills_the_child() {
    let mut child = Command::new("sleep").arg("10").spawn().unwrap();
    let outcome = wait_with_cancel(
      &mut child,
      Duration::from_millis(100),
      &AtomicBool::new(false),
    )
    .unwrap();
    assert!(matches!(outcome, WaitOutcome::TimedOut));
  }

  #[test]
  #[ignore = "Requires user namespaces and PAPYRI_TEST_TEX_BIN containing the three engines"]
  fn sandboxed_engines_compile_and_report_errors() {
    let binaries = PathBuf::from(std::env::var_os("PAPYRI_TEST_TEX_BIN").unwrap());
    let project = OutputDirectory::create().unwrap();
    let document = project.0.join("paper with spaces.tex");
    let imported = project.0.join("part.tex");
    fs::write(
      &document,
      "\\documentclass{article}\n\\begin{document}\n\\edef\\actual{\\jobname}\\edef\\expected{\\detokenize{\"paper with spaces\"}}\\ifx\\actual\\expected\\else\\undefinedcommand\\fi\n\\input{part}\n\\end{document}\n",
    )
    .unwrap();
    fs::write(&imported, "Hello from an imported file.").unwrap();
    let name = document.to_string_lossy().into_owned();
    let original = fs::read_to_string(&document).unwrap();
    let snapshot = "\\documentclass{article}\n\\begin{document}\nUnsaved draft\n\\end{document}\n";
    let pdf = compile_snapshot(
      name.clone(),
      "pdflatex".into(),
      binaries.join("pdflatex").to_string_lossy().into_owned(),
      Some(snapshot.into()),
    )
    .unwrap();
    assert!(pdf.starts_with(b"%PDF-"));
    assert_eq!(fs::read_to_string(&document).unwrap(), original);
    let artifact = compile_preview(
      name.clone(),
      "pdflatex".into(),
      binaries.join("pdflatex").to_string_lossy().into_owned(),
      snapshot.into(),
      Vec::new(),
    )
    .unwrap();
    let id = String::from_utf8(artifact[..32].to_vec()).unwrap();
    let forward = sync_query(id.clone(), Some(name.clone()), Some(3), None, None, None).unwrap();
    assert!(forward.contains("Page:1"), "{forward}");
    let number = |key: &str| {
      forward
        .lines()
        .find_map(|line| line.strip_prefix(key))
        .unwrap()
        .parse::<f64>()
        .unwrap()
    };
    let inverse = sync_query(
      id,
      None,
      None,
      Some(1),
      Some(number("x:")),
      Some(number("y:")),
    )
    .unwrap();
    assert!(inverse.contains(&format!("Input:{name}")), "{inverse}");
    let included_snapshot =
      "\\documentclass{article}\n\\begin{document}\n\\input{part}\n\\end{document}\n";
    let included = imported.to_string_lossy().into_owned();
    let artifact = compile_preview(
      name.clone(),
      "pdflatex".into(),
      binaries.join("pdflatex").to_string_lossy().into_owned(),
      included_snapshot.into(),
      vec![(included.clone(), "Unsaved included text.".into())],
    )
    .unwrap();
    let included_id = String::from_utf8(artifact[..32].to_vec()).unwrap();
    let forward = sync_query(
      included_id.clone(),
      Some(included.clone()),
      Some(1),
      None,
      None,
      None,
    )
    .unwrap();
    assert!(forward.contains("Page:1"), "{forward}");
    let number = |key: &str| {
      forward
        .lines()
        .find_map(|line| line.strip_prefix(key))
        .unwrap()
        .parse::<f64>()
        .unwrap()
    };
    let inverse = sync_query(
      included_id,
      None,
      None,
      Some(1),
      Some(number("x:")),
      Some(number("y:")),
    )
    .unwrap();
    assert!(inverse.contains(&format!("Input:{included}")), "{inverse}");
    assert_eq!(
      fs::read_to_string(&imported).unwrap(),
      "Hello from an imported file."
    );
    for engine in ENGINES {
      let binary = binaries.join(engine).to_string_lossy().into_owned();
      let pdf = compile(name.clone(), engine.into(), binary.clone()).unwrap();
      assert!(pdf.starts_with(b"%PDF-"));
      let before = stamp(name.clone()).unwrap();
      fs::write(&imported, format!("Changed for {engine}")).unwrap();
      assert_ne!(stamp(name.clone()).unwrap(), before);
      fs::write(
        &document,
        "\\documentclass{article}\n\\begin{document}\n\\undefinedcommand\n\\end{document}",
      )
      .unwrap();
      assert!(compile(name.clone(), engine.into(), binary)
        .unwrap_err()
        .contains("undefinedcommand"));
      fs::write(
        &document,
        "\\documentclass{article}\n\\begin{document}\n\\input{part}\n\\end{document}\n",
      )
      .unwrap();
    }
    let bibliography = project.0.join("references.bib");
    let style = project.0.join("localstyle.bst");
    let kpsewhich = Command::new(binaries.join("kpsewhich"))
      .arg("plain.bst")
      .output()
      .unwrap();
    assert!(kpsewhich.status.success());
    fs::copy(String::from_utf8(kpsewhich.stdout).unwrap().trim(), &style).unwrap();
    fs::set_permissions(&style, fs::Permissions::from_mode(0o600)).unwrap();
    fs::write(&bibliography, "@article{sample, title={Example article}, author={Example, Anne}, journal={Journal}, year={2024}}\n").unwrap();
    fs::write(&document, "\\documentclass{article}\n\\begin{document}\n\\cite{sample}\n\\bibliographystyle{localstyle}\n\\bibliography{references}\n\\end{document}\n").unwrap();
    let binary = binaries.join("pdflatex").to_string_lossy().into_owned();
    let pdf = compile(name.clone(), "pdflatex".into(), binary.clone()).unwrap();
    assert!(pdf.starts_with(b"%PDF-"));
    if let Ok(mut extract) = Command::new("pdftotext")
      .args(["-", "-"])
      .stdin(Stdio::piped())
      .stdout(Stdio::piped())
      .spawn()
    {
      extract.stdin.take().unwrap().write_all(&pdf).unwrap();
      let output = extract.wait_with_output().unwrap();
      assert!(output.status.success());
      assert!(String::from_utf8_lossy(&output.stdout).contains("Example article"));
    }
    let before = stamp(name.clone()).unwrap();
    let mut style_contents = fs::read(&style).unwrap();
    style_contents.push(b'\n');
    fs::write(&style, style_contents).unwrap();
    assert_ne!(stamp(name.clone()).unwrap(), before);
    fs::write(&bibliography, "@article{other, title={Unrelated}}\n").unwrap();
    assert!(compile(name.clone(), "pdflatex".into(), binary.clone()).is_err());
    fs::write(&bibliography, "@article{sample,\n").unwrap();
    assert_ne!(stamp(name.clone()).unwrap(), before);
    assert!(compile(name.clone(), "pdflatex".into(), binary)
      .unwrap_err()
      .contains("BibTeX failed"));
    fs::remove_file(&bibliography).unwrap();
    fs::remove_file(&style).unwrap();
    let private = OutputDirectory::create().unwrap();
    fs::write(private.0.join("secret.tex"), "private content").unwrap();
    std::os::unix::fs::symlink(private.0.join("secret.tex"), project.0.join("escape.tex")).unwrap();
    fs::write(
      &document,
      "\\documentclass{article}\n\\begin{document}\n\\input{escape}\n\\end{document}",
    )
    .unwrap();
    let binary = binaries.join("lualatex").to_string_lossy().into_owned();
    assert!(compile(name.clone(), "lualatex".into(), binary).is_err());
    fs::remove_file(project.0.join("escape.tex")).unwrap();
    fs::write(
      &document,
      "\\documentclass{article}\n\\begin{document}Test\\end{document}\n",
    )
    .unwrap();
    let distribution = OutputDirectory::create().unwrap();
    fs::create_dir(distribution.0.join("texmf-dist")).unwrap();
    fs::create_dir(distribution.0.join("bin")).unwrap();
    let custom_engine = distribution.0.join("bin/lualatex");
    std::os::unix::fs::symlink(binaries.join("lualatex"), &custom_engine).unwrap();
    assert!(compile(
      name,
      "lualatex".into(),
      custom_engine.to_string_lossy().into_owned()
    )
    .is_ok());
    assert_eq!(fs::read_dir(&project.0).unwrap().count(), 2);
  }

  #[test]
  fn discovery_uses_path_order_and_skips_non_executables() {
    let mut entropy = [0u8; 16];
    getrandom::fill(&mut entropy).unwrap();
    let suffix: String = entropy.iter().map(|byte| format!("{byte:02x}")).collect();
    let root = std::env::temp_dir().join(format!("papyri-engines-{suffix}"));
    let first = root.join("first");
    let second = root.join("second");
    fs::create_dir_all(&first).unwrap();
    fs::create_dir_all(&second).unwrap();
    fs::write(first.join("lualatex"), "not executable").unwrap();
    let found = second.join("lualatex");
    fs::write(&found, "executable").unwrap();
    fs::set_permissions(&found, fs::Permissions::from_mode(0o755)).unwrap();
    let path = std::env::join_paths([&first, &second]).unwrap();
    assert_eq!(find_in_path("lualatex", &path), Some(found.clone()));
    assert_eq!(find_in_path("pdflatex", &path), None);
    assert_eq!(
      resolve_engine("lualatex", None, &path).unwrap(),
      second.join("lualatex")
    );
    assert_eq!(
      resolve_engine("xelatex", Some(&found), &path).unwrap(),
      found
    );
    assert!(resolve_engine("unknown", None, &path).is_err());
    assert!(resolve_engine("lualatex", Some(Path::new("relative")), &path).is_err());
    assert!(resolve_engine("pdflatex", None, &path).is_err());
    fs::remove_dir_all(root).unwrap();
  }
}

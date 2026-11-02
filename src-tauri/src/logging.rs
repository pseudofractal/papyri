//! Launch-time stdout/stderr routing.
//!
//! The CLI normally starts the GUI in a detached process. This module decides
//! whether that is necessary and connects the child's output to a terminal, a
//! file, or a shell command.

use std::{
  env,
  ffi::OsStr,
  fs::{self, File, OpenOptions, Permissions},
  io,
  os::{
    fd::OwnedFd,
    unix::{
      fs::{MetadataExt, OpenOptionsExt, PermissionsExt},
      net::UnixStream,
      process::CommandExt,
    },
  },
  path::{Path, PathBuf},
  process::{Child, Command, Stdio},
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Target {
  Terminal,
  File(PathBuf),
  Command(String),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Mode {
  Attached,
  Detached(Target),
}

impl Target {
  pub fn parse(value: &str) -> Result<Self, String> {
    if value.is_empty() {
      return Err(
        "`--log` needs a target. Use `terminal`, a file path, or `cmd:<command>`.".into(),
      );
    }
    if matches!(value, "-" | "terminal" | "tty") {
      return Ok(Self::Terminal);
    }
    if let Some(path) = value.strip_prefix("file:") {
      if path.is_empty() {
        return Err("`--log file:` needs a path.".into());
      }
      return Ok(Self::File(PathBuf::from(path)));
    }
    if let Some(command) = value.strip_prefix("cmd:") {
      if command.trim().is_empty() {
        return Err("`--log cmd:` needs a command.".into());
      }
      return Ok(Self::Command(command.into()));
    }
    Ok(Self::File(PathBuf::from(value)))
  }

  pub fn describe(&self) -> String {
    match self {
      Self::Terminal => "terminal".into(),
      Self::File(path) => path.display().to_string(),
      Self::Command(command) => format!("command `{command}`"),
    }
  }
}

/// Decide whether this process should run the GUI itself or spawn a detached
/// child. Explicit file and command targets always detach; the terminal target
/// stays attached. Without an explicit target, release builds detach only when
/// started from a terminal. Development builds stay attached so `tauri dev`
/// and debugger sessions keep their stdio.
pub fn select(log: Option<&str>, attached: bool, auto_detach: bool) -> Result<Mode, String> {
  if let Some(value) = log {
    return match Target::parse(value)? {
      Target::Terminal => Ok(Mode::Attached),
      target => Ok(Mode::Detached(target)),
    };
  }
  if attached && auto_detach {
    Ok(Mode::Detached(Target::File(default_file())))
  } else {
    Ok(Mode::Attached)
  }
}

/// Append-only log path used when no explicit target is supplied.
pub fn default_file() -> PathBuf {
  if let Some(base) = env::var_os("XDG_STATE_HOME")
    .filter(|value| !value.is_empty())
    .map(PathBuf::from)
  {
    return base.join("papyri").join("papyri.log");
  }
  if let Some(home) = env::var_os("HOME").filter(|value| !value.is_empty()) {
    return PathBuf::from(home)
      .join(".local")
      .join("state")
      .join("papyri")
      .join("papyri.log");
  }
  if let Some(base) = env::var_os("XDG_CACHE_HOME")
    .filter(|value| !value.is_empty())
    .map(PathBuf::from)
  {
    return base.join("papyri").join("papyri.log");
  }
  let uid = fs::metadata("/proc/self")
    .map(|metadata| metadata.uid())
    .unwrap_or(0);
  env::temp_dir()
    .join(format!("papyri-{uid}"))
    .join("papyri.log")
}

/// Spawn the GUI detached from the terminal, with both output streams routed to
/// `target`. The returned child is normally dropped: the launcher exits and the
/// GUI is reparented.
pub fn spawn_detached(program: &OsStr, target: &Target) -> Result<Child, String> {
  let mut command = Command::new(program);
  command.stdin(Stdio::null()).env("PAPYRI_GUI_PROCESS", "1");
  match target {
    Target::Terminal => return Err("Terminal output cannot be detached.".into()),
    Target::File(path) => {
      let file = open_file(path)?;
      let stderr = file
        .try_clone()
        .map_err(|error| format!("Could not duplicate the log handle: {error}"))?;
      command
        .stdout(Stdio::from(file))
        .stderr(Stdio::from(stderr));
    }
    Target::Command(sink) => {
      let (reader, writer) =
        UnixStream::pair().map_err(|error| format!("Could not create the log pipe: {error}"))?;
      let stderr_writer = writer
        .try_clone()
        .map_err(|error| format!("Could not duplicate the log pipe: {error}"))?;
      let mut sink_command = Command::new("sh");
      sink_command
        .arg("-c")
        .arg(sink)
        .stdin(Stdio::from(file_from_stream(reader)))
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
      detach(&mut sink_command);
      sink_command
        .spawn()
        .map_err(|error| format!("Could not start log command `{sink}`: {error}"))?;
      command
        .stdout(Stdio::from(file_from_stream(writer)))
        .stderr(Stdio::from(file_from_stream(stderr_writer)));
    }
  }
  detach(&mut command);
  command
    .spawn()
    .map_err(|error| format!("Could not start Papyri: {error}"))
}

fn open_file(path: &Path) -> Result<File, String> {
  if let Some(parent) = path.parent() {
    if !parent.as_os_str().is_empty() && !parent.exists() {
      fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create {}: {error}", parent.display()))?;
      fs::set_permissions(parent, Permissions::from_mode(0o700))
        .map_err(|error| format!("Could not secure {}: {error}", parent.display()))?;
    }
  }
  OpenOptions::new()
    .create(true)
    .append(true)
    .mode(0o600)
    .open(path)
    .map_err(|error| format!("Could not open log {}: {error}", path.display()))
}

fn file_from_stream(stream: UnixStream) -> File {
  File::from(OwnedFd::from(stream))
}

fn detach(command: &mut Command) {
  // A new session drops the controlling terminal and keeps terminal shutdown
  // from taking the GUI or its logging command down with it.
  unsafe {
    command.pre_exec(|| {
      if libc::setsid() == -1 {
        return Err(io::Error::last_os_error());
      }
      Ok(())
    });
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::{
    sync::atomic::{AtomicU64, Ordering},
    thread,
    time::{Duration, Instant},
  };

  static NEXT_DIRECTORY: AtomicU64 = AtomicU64::new(0);

  fn test_directory(name: &str) -> PathBuf {
    let directory = env::temp_dir().join(format!(
      "papyri-log-{}-{}-{}",
      std::process::id(),
      name,
      NEXT_DIRECTORY.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir_all(&directory).unwrap();
    directory
  }

  fn writer_script(directory: &Path) -> PathBuf {
    let script = directory.join("emit.sh");
    fs::write(
      &script,
      "#!/bin/sh\nprintf 'stdout-line\\n'\nprintf 'stderr-line\\n' >&2\n",
    )
    .unwrap();
    fs::set_permissions(&script, Permissions::from_mode(0o755)).unwrap();
    script
  }

  fn await_file(path: &Path, expected: &[&str]) {
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
      let text = fs::read_to_string(path).unwrap_or_default();
      if expected.iter().all(|line| text.contains(line)) {
        return;
      }
      assert!(Instant::now() < deadline, "timed out waiting for {path:?}");
      thread::sleep(Duration::from_millis(20));
    }
  }

  #[test]
  fn parses_terminal_file_and_command_targets() {
    assert_eq!(Target::parse("terminal").unwrap(), Target::Terminal);
    assert_eq!(Target::parse("tty").unwrap(), Target::Terminal);
    assert_eq!(Target::parse("-").unwrap(), Target::Terminal);
    assert_eq!(
      Target::parse("/tmp/papyri.log").unwrap(),
      Target::File(PathBuf::from("/tmp/papyri.log"))
    );
    assert_eq!(
      Target::parse("file:notes/papyri.log").unwrap(),
      Target::File(PathBuf::from("notes/papyri.log"))
    );
    assert_eq!(
      Target::parse("cmd:wl-copy").unwrap(),
      Target::Command("wl-copy".into())
    );
    assert!(Target::parse("").is_err());
    assert!(Target::parse("file:").is_err());
    assert!(Target::parse("cmd:").is_err());
    assert!(Target::parse("cmd:   ").is_err());
  }

  #[test]
  fn selects_attached_or_detached_output() {
    assert_eq!(
      select(Some("terminal"), true, true).unwrap(),
      Mode::Attached
    );
    assert_eq!(
      select(Some("/tmp/papyri.log"), false, false).unwrap(),
      Mode::Detached(Target::File(PathBuf::from("/tmp/papyri.log")))
    );
    assert_eq!(
      select(Some("cmd:wl-copy"), false, false).unwrap(),
      Mode::Detached(Target::Command("wl-copy".into()))
    );
    assert!(matches!(
      select(None, true, true).unwrap(),
      Mode::Detached(Target::File(_))
    ));
    assert_eq!(select(None, true, false).unwrap(), Mode::Attached);
    assert_eq!(select(None, false, true).unwrap(), Mode::Attached);
  }

  #[test]
  fn detached_process_writes_both_streams_to_a_file() {
    let directory = test_directory("file");
    let script = writer_script(&directory);
    let log = directory.join("papyri.log");
    let mut child = spawn_detached(script.as_os_str(), &Target::File(log.clone())).unwrap();
    assert!(child.wait().unwrap().success());
    let text = fs::read_to_string(&log).unwrap();
    assert!(text.contains("stdout-line"));
    assert!(text.contains("stderr-line"));
    fs::remove_dir_all(directory).unwrap();
  }

  #[test]
  fn detached_process_streams_both_streams_to_a_command() {
    let directory = test_directory("command");
    let script = writer_script(&directory);
    let sink = directory.join("sink.log");
    let command = format!("cat > {}", sink.display());
    let mut child = spawn_detached(script.as_os_str(), &Target::Command(command)).unwrap();
    assert!(child.wait().unwrap().success());
    await_file(&sink, &["stdout-line", "stderr-line"]);
    fs::remove_dir_all(directory).unwrap();
  }
}

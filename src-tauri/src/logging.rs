//! Launch-time stdout/stderr routing.
//!
//! The CLI normally starts the GUI in a detached process. This module decides
//! whether that is necessary and connects the child's output to a terminal, a
//! file, or a shell command.

use crate::platform;
use std::{
  env,
  fs::{File, OpenOptions},
  io::{self, Read, Write},
  path::{Path, PathBuf},
  process::{Child, Command, Stdio},
  sync::mpsc,
  thread,
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
  platform::state_dir()
    .or_else(platform::cache_dir)
    .unwrap_or_else(env::temp_dir)
    .join("papyri")
    .join("papyri.log")
}

/// Spawn the GUI detached from the terminal, with both output streams routed to
/// `target`. The returned child is normally dropped: the launcher exits and the
/// GUI is reparented.
pub fn spawn_detached(program: &std::ffi::OsStr, target: &Target) -> Result<Child, String> {
  spawn_detached_command(Command::new(program), target)
}

fn spawn_detached_command(mut command: Command, target: &Target) -> Result<Child, String> {
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
      // The sink owns the log stream, and both child streams feed it through a
      // channel so a noisy stderr cannot block stdout (or vice versa).
      let mut sink_command = if cfg!(windows) {
        let mut command = Command::new("cmd");
        command.arg("/C").arg(sink);
        command
      } else {
        let mut command = Command::new("sh");
        command.arg("-c").arg(sink);
        command
      };
      sink_command
        .stdin(Stdio::piped())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
      detach(&mut sink_command);
      let mut sink_child = sink_command
        .spawn()
        .map_err(|error| format!("Could not start log command `{sink}`: {error}"))?;
      let sink_stdin = sink_child
        .stdin
        .take()
        .ok_or_else(|| format!("Could not open the log command `{sink}`"))?;
      command.stdout(Stdio::piped()).stderr(Stdio::piped());
      let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start Papyri: {error}"))?;
      let stdout = child.stdout.take();
      let stderr = child.stderr.take();
      let (sender, receiver) = mpsc::channel::<Vec<u8>>();
      if let Some(stdout) = stdout {
        let sender = sender.clone();
        thread::spawn(move || pump(stdout, sender));
      }
      if let Some(stderr) = stderr {
        let sender = sender.clone();
        thread::spawn(move || pump(stderr, sender));
      }
      drop(sender);
      thread::spawn(move || {
        let mut sink_stdin = sink_stdin;
        for chunk in receiver {
          if sink_stdin.write_all(&chunk).is_err() {
            break;
          }
        }
        let _ = sink_child.wait();
      });
      return Ok(child);
    }
  }
  detach(&mut command);
  command
    .spawn()
    .map_err(|error| format!("Could not start Papyri: {error}"))
}

fn pump(mut pipe: impl Read, sender: mpsc::Sender<Vec<u8>>) {
  let mut buffer = [0u8; 8192];
  loop {
    match pipe.read(&mut buffer) {
      Ok(0) | Err(_) => break,
      Ok(read) => {
        if sender.send(buffer[..read].to_vec()).is_err() {
          break;
        }
      }
    }
  }
}

fn open_file(path: &Path) -> Result<File, String> {
  if let Some(parent) = path.parent() {
    if !parent.as_os_str().is_empty() && !parent.exists() {
      platform::create_private_dir(parent)
        .map_err(|error| format!("Could not create {}: {error}", parent.display()))?;
    }
  }
  let mut options = OpenOptions::new();
  options.create(true).append(true);
  #[cfg(unix)]
  {
    use std::os::unix::fs::OpenOptionsExt;
    options.mode(0o600);
  }
  options
    .open(path)
    .map_err(|error| format!("Could not open log {}: {error}", path.display()))
}

fn detach(command: &mut Command) {
  #[cfg(unix)]
  {
    use std::os::unix::process::CommandExt;
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
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    const DETACHED_PROCESS: u32 = 0x0000_0008;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    command.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::{
    sync::atomic::{AtomicU64, Ordering},
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
    std::fs::create_dir_all(&directory).unwrap();
    directory
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

  #[cfg(unix)]
  fn writer_script(directory: &Path) -> PathBuf {
    let script = directory.join("emit.sh");
    std::fs::write(
      &script,
      "#!/bin/sh\nprintf 'stdout-line\\n'\nprintf 'stderr-line\\n' >&2\n",
    )
    .unwrap();
    script
  }

  #[cfg(unix)]
  fn await_file(path: &Path, expected: &[&str]) {
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
      let text = std::fs::read_to_string(path).unwrap_or_default();
      if expected.iter().all(|line| text.contains(line)) {
        return;
      }
      assert!(Instant::now() < deadline, "timed out waiting for {path:?}");
      thread::sleep(Duration::from_millis(20));
    }
  }

  #[cfg(unix)]
  #[test]
  fn detached_process_writes_both_streams_to_a_file() {
    let directory = test_directory("file");
    let script = writer_script(&directory);
    let log = directory.join("papyri.log");
    let mut command = Command::new("sh");
    command.arg(&script);
    let mut child = spawn_detached_command(command, &Target::File(log.clone())).unwrap();
    assert!(child.wait().unwrap().success());
    let text = std::fs::read_to_string(&log).unwrap();
    assert!(text.contains("stdout-line"));
    assert!(text.contains("stderr-line"));
    std::fs::remove_dir_all(directory).unwrap();
  }

  #[cfg(unix)]
  #[test]
  fn detached_process_streams_both_streams_to_a_command() {
    let directory = test_directory("command");
    let script = writer_script(&directory);
    let sink = directory.join("sink.log");
    let sink_command = format!("cat > {}", sink.display());
    let mut command = Command::new("sh");
    command.arg(&script);
    let mut child = spawn_detached_command(command, &Target::Command(sink_command)).unwrap();
    assert!(child.wait().unwrap().success());
    await_file(&sink, &["stdout-line", "stderr-line"]);
    std::fs::remove_dir_all(directory).unwrap();
  }
}

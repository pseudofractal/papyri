//! Compiler process construction and isolation.
//!
//! Linux uses bubblewrap plus `prlimit`; macOS uses `sandbox-exec` with a
//! profile that denies network and writes outside the output directory;
//! Windows currently runs the user-selected compiler directly. The caller
//! supplies compiler-specific arguments through the small helpers below so the
//! LaTeX and Typst modules do not carry platform `cfg` branches.

use std::{
  env,
  path::{Path, PathBuf},
  process::Command,
};

#[cfg(target_os = "linux")]
pub const MEMORY_BYTES: u64 = 2 * 1024 * 1024 * 1024;
#[cfg(target_os = "linux")]
pub const CPU_SECONDS: u64 = 25;
#[cfg(target_os = "linux")]
pub const FILE_SIZE: u64 = 64 * 1024 * 1024;

#[cfg(target_os = "linux")]
fn tex_distribution_root<'a>(executable: &'a Path, home: Option<&Path>) -> Option<&'a Path> {
  executable.ancestors().find(|parent| {
    parent.is_absolute()
      && *parent != Path::new("/")
      && home != Some(*parent)
      && parent.join("texmf-dist").is_dir()
  })
}

#[cfg(target_os = "linux")]
fn linux_command(project: &Path, output: &Path, binary: &Path, name: &str) -> Command {
  let sandbox = option_env!("PAPYRI_BWRAP_BINARY").unwrap_or("bwrap");
  let limiter = option_env!("PAPYRI_PRLIMIT_BINARY").unwrap_or("prlimit");
  let mut command = Command::new(limiter);
  command.arg(format!("--as={MEMORY_BYTES}"));
  command.arg(format!("--cpu={CPU_SECONDS}"));
  command.arg(format!("--fsize={FILE_SIZE}"));
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
  if let Some(root) = tex_distribution_root(binary, crate::platform::home_dir().as_deref()) {
    command.arg("--ro-bind").arg(root).arg(root);
  }
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

#[cfg(target_os = "macos")]
fn macos_profile(output: &Path) -> String {
  fn quote(path: &Path) -> String {
    path
      .to_string_lossy()
      .replace('\\', "\\\\")
      .replace('"', "\\\"")
  }
  format!(
    "(version 1)\n\
     (deny default)\n\
     (allow process*)\n\
     (allow signal (target self))\n\
     (allow sysctl-read)\n\
     (allow mach-lookup)\n\
     (allow file-read*)\n\
     (allow file-write* (subpath \"{}\") (subpath \"/private/tmp\") (subpath \"/tmp\") (literal \"/dev/null\") (literal \"/dev/stdout\") (literal \"/dev/stderr\"))\n\
     (allow ipc-posix-shm)\n",
    quote(output)
  )
}

#[cfg(target_os = "macos")]
fn macos_command(output: &Path, binary: &Path) -> Command {
  let sandbox = Path::new("/usr/bin/sandbox-exec");
  let mut command = if sandbox.is_file() {
    let mut command = Command::new(sandbox);
    command.arg("-p").arg(macos_profile(output)).arg("--");
    command
  } else {
    Command::new(binary)
  };
  command.env("HOME", output).env("TMPDIR", output);
  command
}

#[cfg(target_os = "windows")]
fn windows_command(output: &Path, binary: &Path) -> Command {
  let mut command = Command::new(binary);
  command
    .env("HOME", output)
    .env("TMPDIR", output)
    .env("TEMP", output);
  command
}

pub fn compiler_command(project: &Path, output: &Path, binary: &Path, name: &str) -> Command {
  #[cfg(target_os = "linux")]
  {
    let _ = (output, binary, name);
    return linux_command(project, output, binary, name);
  }
  #[cfg(target_os = "macos")]
  {
    let _ = (project, name);
    return macos_command(output, binary);
  }
  #[cfg(target_os = "windows")]
  {
    let _ = (project, name);
    return windows_command(output, binary);
  }
  #[allow(unreachable_code)]
  {
    let _ = (project, output);
    Command::new(binary)
  }
}

/// The path LaTeX should invoke for this compiler inside the sandbox.
pub fn executable(binary: &Path, name: &str) -> PathBuf {
  #[cfg(target_os = "linux")]
  {
    if tex_distribution_root(binary, crate::platform::home_dir().as_deref()).is_some() {
      binary.to_path_buf()
    } else {
      Path::new("/compiler").join(name)
    }
  }
  #[cfg(not(target_os = "linux"))]
  {
    let _ = name;
    binary.to_path_buf()
  }
}

/// Append the compiler executable to a command built by `compiler_command`.
///
/// Linux invokes a sandbox wrapper, so the compiler is an argument. macOS also
/// uses `sandbox-exec`, but it consumes the binary after `--`; Windows makes
/// the compiler the command program directly. Keeping this distinction here
/// prevents callers from appending the binary twice.
pub fn configure_program(command: &mut Command, binary: &Path, name: &str) {
  if cfg!(target_os = "linux")
    || (cfg!(target_os = "macos") && Path::new("/usr/bin/sandbox-exec").is_file())
  {
    command.arg(executable(binary, name));
  } else {
    let _ = (binary, name);
  }
}

pub fn project_path(project: &Path) -> PathBuf {
  if cfg!(target_os = "linux") {
    Path::new("/project").to_path_buf()
  } else {
    project.to_path_buf()
  }
}

pub fn output_path(output: &Path) -> PathBuf {
  if cfg!(target_os = "linux") {
    Path::new("/output").to_path_buf()
  } else {
    output.to_path_buf()
  }
}

/// Add a read-only file to the compiler view. Linux bind-mounts it; other
/// platforms already share the real filesystem with the compiler.
pub fn add_read_only(command: &mut Command, host: &Path, target: &Path) {
  if cfg!(target_os = "linux") {
    command.arg("--ro-bind").arg(host).arg(target);
  } else {
    let _ = (host, target);
  }
}

/// Set the compiler working directory and terminate platform wrapper options.
pub fn set_working_directory(command: &mut Command, project: &Path) {
  set_working_directory_at(command, project, &project_path(project));
}

/// Enter an arbitrary host directory using the path visible inside the sandbox.
pub fn set_working_directory_at(command: &mut Command, host: &Path, visible: &Path) {
  if cfg!(target_os = "linux") {
    command.arg("--chdir").arg(visible).arg("--");
  } else {
    command.current_dir(host);
  }
}

pub fn set_env(command: &mut Command, key: &str, value: &str) {
  if cfg!(target_os = "linux") {
    command.args(["--setenv", key, value]);
  } else {
    command.env(key, value);
  }
}

pub fn compilation_hint() -> &'static str {
  if cfg!(target_os = "linux") {
    "Compilation requires Linux user namespaces. Imports must stay in the document folder; packages must already be cached."
  } else if cfg!(target_os = "macos") {
    "Compilation is sandboxed with sandbox-exec; imports must stay in the document folder."
  } else {
    "Compilation runs with the selected compiler; imports must stay in the document folder."
  }
}

/// Create a private temporary directory for compiler output.
pub fn temporary_directory(prefix: &str) -> Result<PathBuf, String> {
  let path = env::temp_dir().join(crate::platform::unique_name(prefix));
  crate::platform::create_private_dir(&path).map_err(|error| error.to_string())?;
  Ok(path)
}

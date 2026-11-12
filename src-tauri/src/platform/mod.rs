//! Platform abstraction for the native shell.
//!
//! Desktop-only subsystems (X11 input, the GTK browser panel, Linux control
//! sockets) are selected here instead of being referenced directly from the
//! commands. Each platform module exposes the same small interface so an
//! Android shell can add its own implementation without touching document,
//! editor, preview, or bibliography code.

use serde::Serialize;
use std::{
  env, fs, io,
  path::{Path, PathBuf},
};

pub mod clipboard;
pub mod control;
pub mod sandbox;

#[cfg(target_os = "linux")]
pub mod linux;
#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(target_os = "windows")]
pub mod windows;

/// Features the frontend may rely on for the current build.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
  pub os: &'static str,
  pub desktop: bool,
  pub mobile: bool,
  pub browser_panel: bool,
  pub input_injection: bool,
  pub screen_capture: bool,
  pub webview_capture: bool,
  pub window_enumeration: bool,
  pub window_capture: bool,
  pub control_socket: bool,
  pub managed_tools: bool,
  pub managed_texlive: bool,
  pub latex: bool,
  pub typst: bool,
  pub sandboxed_compilation: bool,
  pub clipboard_images: bool,
}

pub fn capabilities() -> Capabilities {
  let linux = cfg!(target_os = "linux");
  let macos = cfg!(target_os = "macos");
  let mobile = cfg!(any(target_os = "android", target_os = "ios"));
  let desktop = !mobile;
  Capabilities {
    os: env::consts::OS,
    desktop,
    mobile,
    // The embedded web panel is implemented with GTK child webviews. Other
    // desktop shells use the system browser until a native child-webview
    // implementation is added.
    browser_panel: linux,
    input_injection: linux,
    screen_capture: desktop,
    webview_capture: linux,
    window_enumeration: linux,
    window_capture: linux,
    control_socket: desktop,
    managed_tools: desktop,
    managed_texlive: linux || macos,
    latex: desktop,
    typst: desktop,
    sandboxed_compilation: linux || macos,
    clipboard_images: desktop,
  }
}

pub fn home_dir() -> Option<PathBuf> {
  if cfg!(target_os = "windows") {
    return env::var_os("USERPROFILE")
      .filter(|value| !value.is_empty())
      .map(PathBuf::from)
      .or_else(|| {
        let drive = env::var_os("HOMEDRIVE")?;
        let path = env::var_os("HOMEPATH")?;
        let mut combined = drive;
        combined.push(path);
        Some(PathBuf::from(combined))
      });
  }
  env::var_os("HOME")
    .filter(|value| !value.is_empty())
    .map(PathBuf::from)
}

/// Per-user configuration root used by launchers and the CLI.
pub fn config_dir() -> Option<PathBuf> {
  if let Some(value) = env::var_os("PAPYRI_CONFIG_DIR").filter(|value| !value.is_empty()) {
    return Some(PathBuf::from(value));
  }
  if cfg!(target_os = "windows") {
    return env::var_os("APPDATA")
      .filter(|value| !value.is_empty())
      .map(PathBuf::from);
  }
  if cfg!(target_os = "macos") {
    return home_dir().map(|home| home.join("Library").join("Application Support"));
  }
  env::var_os("XDG_CONFIG_HOME")
    .filter(|value| !value.is_empty())
    .map(PathBuf::from)
    .or_else(|| home_dir().map(|home| home.join(".config")))
}

pub fn cache_dir() -> Option<PathBuf> {
  if cfg!(target_os = "windows") {
    return env::var_os("LOCALAPPDATA")
      .filter(|value| !value.is_empty())
      .map(PathBuf::from);
  }
  if cfg!(target_os = "macos") {
    return home_dir().map(|home| home.join("Library").join("Caches"));
  }
  env::var_os("XDG_CACHE_HOME")
    .filter(|value| !value.is_empty())
    .map(PathBuf::from)
    .or_else(|| home_dir().map(|home| home.join(".cache")))
}

pub fn state_dir() -> Option<PathBuf> {
  if cfg!(target_os = "windows") {
    return config_dir();
  }
  if cfg!(target_os = "macos") {
    return home_dir().map(|home| home.join("Library").join("Logs"));
  }
  env::var_os("XDG_STATE_HOME")
    .filter(|value| !value.is_empty())
    .map(PathBuf::from)
    .or_else(|| home_dir().map(|home| home.join(".local").join("state")))
}

pub fn path_string(path: &Path) -> String {
  let original = path.to_string_lossy();
  if cfg!(target_os = "windows") {
    let text = original.strip_prefix(r"\\?\").unwrap_or(original.as_ref());
    text.replace('\\', "/")
  } else {
    original.into_owned()
  }
}

/// Remove the Windows extended-length prefix that `canonicalize` adds. External
/// compilers and language tools do not consistently accept `\\?\` paths.
pub fn strip_verbatim(path: &Path) -> PathBuf {
  #[cfg(target_os = "windows")]
  {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\") {
      return PathBuf::from(rest);
    }
  }
  path.to_path_buf()
}

/// Replace `target` with `source` in one step.
pub fn replace_file(source: &Path, target: &Path) -> io::Result<()> {
  #[cfg(not(target_os = "windows"))]
  {
    fs::rename(source, target)
  }
  #[cfg(target_os = "windows")]
  {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
      MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let target: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    let result = unsafe {
      MoveFileExW(
        source.as_ptr(),
        target.as_ptr(),
        MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
      )
    };
    if result == 0 {
      Err(io::Error::last_os_error())
    } else {
      Ok(())
    }
  }
}

/// Rename `source` to `target` only when `target` does not already exist.
pub fn rename_no_replace(source: &Path, target: &Path) -> io::Result<()> {
  #[cfg(not(target_os = "windows"))]
  {
    // A hard link followed by removing the old name is atomic with respect to
    // the destination and works on every Unix filesystem.
    fs::hard_link(source, target)?;
    if let Err(error) = fs::remove_file(source) {
      let _ = fs::remove_file(target);
      return Err(error);
    }
    Ok(())
  }
  #[cfg(target_os = "windows")]
  {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::MoveFileExW;
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let target: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    let result = unsafe { MoveFileExW(source.as_ptr(), target.as_ptr(), 0) };
    if result == 0 {
      Err(io::Error::last_os_error())
    } else {
      Ok(())
    }
  }
}

/// Create a directory only the current user can access where the platform
/// supports POSIX permissions.
pub fn create_private_dir(path: &Path) -> io::Result<()> {
  fs::create_dir_all(path)?;
  #[cfg(unix)]
  {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
  }
  Ok(())
}

pub fn make_executable(path: &Path) -> io::Result<()> {
  #[cfg(unix)]
  {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o755))?;
  }
  #[cfg(not(unix))]
  {
    let _ = path;
  }
  Ok(())
}

/// The filename a managed tool should use on this platform.
pub fn executable_name(name: &str) -> String {
  if cfg!(target_os = "windows") {
    format!("{name}.exe")
  } else {
    name.to_owned()
  }
}

/// A temporary filename prefix that avoids collisions between processes.
pub fn unique_name(prefix: &str) -> String {
  let mut random = [0u8; 16];
  let _ = getrandom::fill(&mut random);
  let suffix: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
  format!("{prefix}-{suffix}")
}

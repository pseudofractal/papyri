//! Locate user-configured or PATH-provided executables.
#[cfg(unix)]
use std::fs;
use std::{
  ffi::OsStr,
  path::{Path, PathBuf},
};

#[cfg(unix)]
pub fn is_executable(path: &Path) -> bool {
  use std::os::unix::fs::PermissionsExt;
  fs::metadata(path)
    .is_ok_and(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
}

#[cfg(windows)]
pub fn is_executable(path: &Path) -> bool {
  path.is_file()
    && path
      .extension()
      .and_then(OsStr::to_str)
      .is_some_and(|extension| {
        ["exe", "cmd", "bat", "com"]
          .iter()
          .any(|candidate| extension.eq_ignore_ascii_case(candidate))
      })
}

#[cfg(not(any(unix, windows)))]
pub fn is_executable(path: &Path) -> bool {
  path.is_file()
}

#[cfg(windows)]
fn candidate_names(name: &str) -> Vec<String> {
  const DEFAULT_PATHEXT: &str = ".COM;.EXE;.BAT;.CMD";
  let pathext = std::env::var("PATHEXT").unwrap_or_else(|_| DEFAULT_PATHEXT.into());
  let mut names = vec![name.to_owned()];
  for extension in pathext.split(';').filter(|value| !value.is_empty()) {
    names.push(format!("{name}{extension}"));
  }
  names
}

#[cfg(not(windows))]
fn candidate_names(name: &str) -> Vec<String> {
  vec![name.to_owned()]
}

pub fn find_in_path(name: &str, search_path: &OsStr) -> Option<PathBuf> {
  let candidates = candidate_names(name);
  std::env::split_paths(search_path).find_map(|directory| {
    candidates
      .iter()
      .map(|candidate| directory.join(candidate))
      .find(|path| is_executable(path))
  })
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::fs;

  #[test]
  fn ignores_missing_and_non_executable_candidates() {
    let directory = std::env::temp_dir().join(crate::platform::unique_name("papyri-exec-test"));
    fs::create_dir_all(&directory).unwrap();
    let missing = directory.join(if cfg!(windows) {
      "missing.exe"
    } else {
      "missing"
    });
    assert!(!is_executable(&missing));
    fs::remove_dir_all(directory).unwrap();
  }
}

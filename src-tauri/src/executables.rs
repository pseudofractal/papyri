//! Locate user-configured or PATH-provided executables.
use std::{
  ffi::OsStr,
  fs,
  os::unix::fs::PermissionsExt,
  path::{Path, PathBuf},
};

pub fn is_executable(path: &Path) -> bool {
  fs::metadata(path)
    .is_ok_and(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
}

pub fn find_in_path(name: &str, search_path: &OsStr) -> Option<PathBuf> {
  std::env::split_paths(search_path)
    .map(|directory| directory.join(name))
    .find(|path| is_executable(path))
}

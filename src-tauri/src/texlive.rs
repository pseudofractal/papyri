//! Optional private TeX Live installation and updates via the upstream installer.
use crate::{
  executables, platform,
  tools::{read_limited, verify_executable},
};
use flate2::read::GzDecoder;
use serde::Serialize;
use sha2::{Digest, Sha512};
use std::{
  fs::{self, File, OpenOptions},
  io::{Cursor, Read, Seek, SeekFrom, Write},
  path::{Component, Path, PathBuf},
  process::{Command, Stdio},
  sync::Mutex,
  time::Duration,
};
use tauri::Manager;

const REPOSITORY: &str = "https://ctan.math.illinois.edu/systems/texlive/tlnet";
const INSTALLER_LIMIT: u64 = 32 * 1024 * 1024;
const UNPACKED_LIMIT: u64 = 64 * 1024 * 1024;
const LOG_TAIL: u64 = 8192;
static TEXLIVE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize)]
pub struct TexLivePaths {
  lualatex: String,
  pdflatex: String,
  xelatex: String,
}

fn texlive_platform(architecture: &str) -> Result<&'static str, String> {
  if cfg!(target_os = "android") || cfg!(target_os = "ios") {
    return Err("Managed TeX Live installation is unavailable on mobile.".into());
  }
  if cfg!(target_os = "macos") {
    // The universal macOS binaries run on both Intel and Apple Silicon.
    return Ok("universal-darwin");
  }
  if cfg!(target_os = "windows") {
    return Err(
      "Managed TeX Live installation is not available on Windows; install TeX Live separately."
        .into(),
    );
  }
  match architecture {
    "x86_64" => Ok("x86_64-linux"),
    "aarch64" => Ok("aarch64-linux"),
    _ => Err(format!(
      "TeX Live installation is not supported on {architecture}"
    )),
  }
}

fn engine_paths(root: &Path, architecture: &str) -> Result<TexLivePaths, String> {
  let bin = root.join("bin").join(texlive_platform(architecture)?);
  let mut paths = Vec::new();
  for name in ["lualatex", "pdflatex", "xelatex"] {
    let path = bin.join(name);
    if !executables::is_executable(&path) {
      return Err(format!("TeX Live did not provide {}", path.display()));
    }
    verify_executable(&path, name)?;
    paths.push(path.to_string_lossy().into_owned());
  }
  Ok(TexLivePaths {
    lualatex: paths[0].clone(),
    pdflatex: paths[1].clone(),
    xelatex: paths[2].clone(),
  })
}

fn profile(root: &Path, architecture: &str) -> Result<String, String> {
  let root = root
    .to_str()
    .ok_or("TeX Live directory is not valid UTF-8")?;
  if root.contains(['\n', '\r']) {
    return Err("TeX Live directory contains a newline".into());
  }
  // Specifying any collection makes install-tl ignore the scheme's collection list.
  Ok(format!("selected_scheme scheme-small\nTEXDIR {root}\nTEXMFLOCAL {root}/texmf-local\nTEXMFSYSCONFIG {root}/texmf-config\nTEXMFSYSVAR {root}/texmf-var\nTEXMFCONFIG {root}/texmf-config\nTEXMFVAR {root}/texmf-var\nTEXMFHOME {root}/texmf-local\ninstopt_adjustpath 0\ninstopt_portable 1\ntlpdbopt_install_docfiles 0\ntlpdbopt_install_srcfiles 0\ncollection-basic 1\ncollection-latex 1\ncollection-latexrecommended 1\ncollection-fontsrecommended 1\ncollection-luatex 1\ncollection-xetex 1\nbinary_{} 1\n", texlive_platform(architecture)?))
}

fn unique_directory(parent: &Path, prefix: &str) -> Result<PathBuf, String> {
  fs::create_dir_all(parent).map_err(|error| error.to_string())?;
  let mut random = [0u8; 16];
  getrandom::fill(&mut random).map_err(|error| error.to_string())?;
  let suffix: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
  let path = parent.join(format!("{prefix}-{suffix}"));
  fs::create_dir(&path).map_err(|error| error.to_string())?;
  Ok(path)
}

struct Bootstrap(PathBuf);
impl Drop for Bootstrap {
  fn drop(&mut self) {
    let _ = fs::remove_dir_all(&self.0);
  }
}

fn download_installer(parent: &Path) -> Result<Bootstrap, String> {
  let client = reqwest::blocking::Client::builder()
    .user_agent("Papyri TeX Live installer")
    .https_only(true)
    .connect_timeout(Duration::from_secs(20))
    .timeout(Duration::from_secs(300))
    .build()
    .map_err(|error| error.to_string())?;
  let fetch = |name: &str, limit| -> Result<Vec<u8>, String> {
    let response = client
      .get(format!("{REPOSITORY}/{name}"))
      .send()
      .and_then(|response| response.error_for_status())
      .map_err(|error| format!("Could not download TeX Live installer: {error}"))?;
    read_limited(response, limit)
  };
  let checksum = String::from_utf8(fetch("install-tl-unx.tar.gz.sha512", 4096)?)
    .map_err(|error| error.to_string())?;
  let expected = checksum
    .split_whitespace()
    .next()
    .filter(|value| value.len() == 128 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
    .ok_or("Invalid TeX Live installer checksum")?;
  let bytes = fetch("install-tl-unx.tar.gz", INSTALLER_LIMIT)?;
  let actual: String = Sha512::digest(&bytes)
    .iter()
    .map(|byte| format!("{byte:02x}"))
    .collect();
  if actual != expected.to_ascii_lowercase() {
    return Err("TeX Live installer checksum mismatch".into());
  }
  let directory = Bootstrap(unique_directory(parent, "installer")?);
  let mut archive = tar::Archive::new(GzDecoder::new(Cursor::new(bytes)).take(UNPACKED_LIMIT));
  for entry in archive
    .entries()
    .map_err(|error| format!("Invalid TeX Live installer archive: {error}"))?
  {
    let mut entry = entry.map_err(|error| error.to_string())?;
    let path = entry.path().map_err(|error| error.to_string())?;
    let safe = path
      .components()
      .all(|component| matches!(component, Component::Normal(_)));
    let kind = entry.header().entry_type();
    if !safe || !(kind.is_file() || kind.is_dir()) {
      return Err("Unsafe TeX Live installer archive entry".into());
    }
    if !entry
      .unpack_in(&directory.0)
      .map_err(|error| error.to_string())?
    {
      return Err("Unsafe TeX Live installer archive path".into());
    }
  }
  Ok(directory)
}

fn run(command: &mut Command, log: &Path, operation: &str) -> Result<(), String> {
  let output = OpenOptions::new()
    .create(true)
    .write(true)
    .truncate(true)
    .open(log)
    .map_err(|error| error.to_string())?;
  let stderr = output.try_clone().map_err(|error| error.to_string())?;
  let status = command
    .stdin(Stdio::null())
    .stdout(Stdio::from(output))
    .stderr(Stdio::from(stderr))
    .status()
    .map_err(|error| format!("Could not start {operation}: {error}"))?;
  if status.success() {
    return Ok(());
  }
  let mut file = File::open(log).map_err(|error| error.to_string())?;
  let size = file.metadata().map_err(|error| error.to_string())?.len();
  file
    .seek(SeekFrom::Start(size.saturating_sub(LOG_TAIL)))
    .map_err(|error| error.to_string())?;
  let mut tail = Vec::new();
  file
    .read_to_end(&mut tail)
    .map_err(|error| error.to_string())?;
  Err(format!(
    "{operation} failed ({status}): {}",
    String::from_utf8_lossy(&tail)
  ))
}

fn install(root: &Path) -> Result<TexLivePaths, String> {
  let _guard = TEXLIVE_LOCK
    .lock()
    .map_err(|_| "TeX Live installer is unavailable")?;
  let architecture = std::env::consts::ARCH;
  texlive_platform(architecture)?;
  let bootstrap = download_installer(root)?;
  let installer = fs::read_dir(&bootstrap.0)
    .map_err(|error| error.to_string())?
    .filter_map(Result::ok)
    .map(|entry| entry.path().join("install-tl"))
    .find(|path| path.is_file())
    .ok_or("TeX Live installer is missing")?;
  let installation = unique_directory(root, "distribution")?;
  let profile_path = bootstrap.0.join("papyri.profile");
  fs::write(&profile_path, profile(&installation, architecture)?)
    .map_err(|error| error.to_string())?;
  let log = installation.join("papyri-install.log");
  run(
    Command::new("perl")
      .arg(installer)
      .arg("-profile")
      .arg(profile_path)
      .arg("-repository")
      .arg(REPOSITORY),
    &log,
    "TeX Live installation",
  )
  .map_err(|error| {
    format!(
      "{error}\nPartial installation retained at {}",
      installation.display()
    )
  })?;
  let paths = engine_paths(&installation, architecture).map_err(|error| {
    format!(
      "{error}\nInstallation retained at {}",
      installation.display()
    )
  })?;
  let metadata = root.join("current");
  let temporary = root.join(format!(
    ".current-{}",
    installation.file_name().unwrap().to_string_lossy()
  ));
  let mut file = OpenOptions::new()
    .write(true)
    .create_new(true)
    .open(&temporary)
    .map_err(|error| error.to_string())?;
  let result = file
    .write_all(installation.to_string_lossy().as_bytes())
    .and_then(|()| file.sync_all())
    .and_then(|()| platform::replace_file(&temporary, &metadata))
    .map_err(|error| error.to_string());
  if temporary.exists() {
    let _ = fs::remove_file(&temporary);
  }
  result?;
  Ok(paths)
}

fn update(root: &Path) -> Result<TexLivePaths, String> {
  let _guard = TEXLIVE_LOCK
    .lock()
    .map_err(|_| "TeX Live updater is unavailable")?;
  let root = platform::strip_verbatim(
    &root
      .canonicalize()
      .map_err(|_| "No Papyri-managed TeX Live installation was found")?,
  );
  let recorded = fs::read_to_string(root.join("current"))
    .map_err(|_| "No Papyri-managed TeX Live installation was found")?;
  let installation = platform::strip_verbatim(
    &Path::new(&recorded)
      .canonicalize()
      .map_err(|error| error.to_string())?,
  );
  if !installation.starts_with(&root) || installation == root {
    return Err("Invalid managed TeX Live location".into());
  }
  let bin = installation
    .join("bin")
    .join(texlive_platform(std::env::consts::ARCH)?);
  let manager = bin.join("tlmgr");
  if !executables::is_executable(&manager) {
    return Err("The managed TeX Live updater is missing".into());
  }
  let path = std::env::join_paths(std::iter::once(bin).chain(std::env::split_paths(
    &std::env::var_os("PATH").unwrap_or_default(),
  )))
  .map_err(|error| error.to_string())?;
  run(
    Command::new(manager)
      .args(["--repository", REPOSITORY, "update", "--self", "--all"])
      .env("PATH", path),
    &installation.join("papyri-update.log"),
    "TeX Live update",
  )?;
  engine_paths(&installation, std::env::consts::ARCH)
}

#[tauri::command]
pub async fn manage_texlive(app: tauri::AppHandle, action: String) -> Result<TexLivePaths, String> {
  if cfg!(target_os = "windows") {
    return Err(
      "Managed TeX Live installation is not available on Windows; install TeX Live separately."
        .into(),
    );
  }
  let root = app
    .path()
    .app_data_dir()
    .map_err(|error| error.to_string())?
    .join("texlive");
  tauri::async_runtime::spawn_blocking(move || match action.as_str() {
    "install" => install(&root),
    "update" => update(&root),
    _ => Err("Unsupported TeX Live action".into()),
  })
  .await
  .map_err(|error| format!("TeX Live task failed: {error}"))?
}

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn profile_is_private_and_enables_all_engines() {
    let value = profile(Path::new("/tmp/papyri tex"), "x86_64").unwrap();
    assert!(value.contains("TEXDIR /tmp/papyri tex\n"));
    if cfg!(target_os = "linux") {
      assert!(value.contains("binary_x86_64-linux 1\n"));
    }
    assert!(value.contains("collection-luatex 1\n"));
    assert!(value.contains("collection-xetex 1\n"));
    assert!(value.contains("collection-basic 1\n"));
    assert!(value.contains("collection-latex 1\n"));
    assert!(profile(Path::new("/tmp/bad\npath"), "x86_64").is_err());
    assert!(texlive_platform("unknown").is_err());
  }
  #[test]
  fn missing_installation_is_not_updated() {
    assert!(update(Path::new("/path/that/does/not/exist")).is_err());
  }
  #[test]
  #[ignore = "Downloads the official TeX Live installer"]
  fn downloads_and_verifies_upstream_installer() {
    let root = unique_directory(&std::env::temp_dir(), "papyri-texlive-test").unwrap();
    let bootstrap = download_installer(&root).unwrap();
    let installer = fs::read_dir(&bootstrap.0)
      .unwrap()
      .filter_map(Result::ok)
      .map(|entry| entry.path().join("install-tl"))
      .find(|path| path.is_file())
      .unwrap();
    let result = Command::new("perl")
      .arg(installer)
      .arg("--version")
      .output()
      .unwrap();
    assert!(
      result.status.success(),
      "{}",
      String::from_utf8_lossy(&result.stderr)
    );
    drop(bootstrap);
    fs::remove_dir(root).unwrap();
  }
}

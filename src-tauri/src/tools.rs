//! Download selected upstream releases into Papyri's private tool directory.
use crate::executables;
use flate2::read::GzDecoder;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
  fs::{self, OpenOptions},
  io::{Cursor, Read, Write},
  os::unix::fs::PermissionsExt,
  path::{Path, PathBuf},
  process::{Command, Stdio},
  sync::Mutex,
  thread,
  time::{Duration, Instant},
};
use tauri::Manager;
use xz2::read::XzDecoder;

const RELEASE_LIMIT: u64 = 4 * 1024 * 1024;
const DOWNLOAD_LIMIT: u64 = 256 * 1024 * 1024;
const EXECUTABLE_LIMIT: u64 = 192 * 1024 * 1024;
const ARCHIVE_CONTENT_LIMIT: u64 = 512 * 1024 * 1024;
static INSTALL_LOCK: Mutex<()> = Mutex::new(());

struct Tool {
  name: &'static str,
  repository: &'static str,
  asset: String,
}

fn tool(name: &str, architecture: &str) -> Result<Tool, String> {
  let (arch, short_arch) = match architecture {
    "x86_64" => ("x86_64", "x64"),
    "aarch64" => ("aarch64", "arm64"),
    _ => {
      return Err(format!(
        "No managed downloads for architecture {architecture}"
      ))
    }
  };
  let (name, repository, asset) = match name {
    "marksman" => (
      "marksman",
      "artempyanykh/marksman",
      format!("marksman-linux-{short_arch}"),
    ),
    "tinymist" => (
      "tinymist",
      "Myriad-Dreamin/tinymist",
      format!("tinymist-{arch}-unknown-linux-gnu.tar.gz"),
    ),
    "texlab" => (
      "texlab",
      "latex-lsp/texlab",
      format!("texlab-{arch}-linux.tar.gz"),
    ),
    "typst" => (
      "typst",
      "typst/typst",
      format!("typst-{arch}-unknown-linux-musl.tar.xz"),
    ),
    _ => return Err("Unsupported managed tool".into()),
  };
  Ok(Tool {
    name,
    repository,
    asset,
  })
}

#[derive(Deserialize)]
struct Release {
  tag_name: String,
  assets: Vec<Asset>,
}
#[derive(Deserialize)]
struct Asset {
  name: String,
  browser_download_url: String,
  digest: Option<String>,
  size: u64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledTool {
  path: String,
  version: String,
}

pub(crate) fn read_limited(mut reader: impl Read, limit: u64) -> Result<Vec<u8>, String> {
  let mut bytes = Vec::new();
  reader
    .by_ref()
    .take(limit + 1)
    .read_to_end(&mut bytes)
    .map_err(|error| error.to_string())?;
  if bytes.len() as u64 > limit {
    return Err("Download exceeds the size limit".into());
  }
  Ok(bytes)
}

fn executable_from_archive(tool: &Tool, bytes: &[u8]) -> Result<Vec<u8>, String> {
  if !tool.asset.ends_with(".tar.gz") && !tool.asset.ends_with(".tar.xz") {
    return read_limited(bytes, EXECUTABLE_LIMIT);
  }
  let reader: Box<dyn Read> = if tool.asset.ends_with(".tar.gz") {
    Box::new(GzDecoder::new(Cursor::new(bytes)))
  } else {
    Box::new(XzDecoder::new(Cursor::new(bytes)))
  };
  let mut archive = tar::Archive::new(reader.take(ARCHIVE_CONTENT_LIMIT));
  for entry in archive
    .entries()
    .map_err(|error| format!("Invalid archive: {error}"))?
  {
    let entry = entry.map_err(|error| format!("Invalid archive entry: {error}"))?;
    let path = entry
      .path()
      .map_err(|error| format!("Invalid archive path: {error}"))?;
    if path.file_name().is_some_and(|name| name == tool.name)
      && entry.header().entry_type().is_file()
    {
      return read_limited(entry, EXECUTABLE_LIMIT);
    }
  }
  Err(format!(
    "The release archive does not contain {}",
    tool.name
  ))
}

pub(crate) fn verify_executable(path: &Path, name: &str) -> Result<(), String> {
  let mut child = Command::new(path)
    .arg("--version")
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .spawn()
    .map_err(|error| format!("Downloaded {name} cannot run on this system: {error}. Choose a locally installed executable instead."))?;
  let deadline = Instant::now() + Duration::from_secs(15);
  loop {
    match child.try_wait() {
      Ok(Some(status)) if status.success() => return Ok(()),
      Ok(Some(status)) => {
        return Err(format!(
          "Downloaded {name} failed its version check: {status}"
        ))
      }
      Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(100)),
      Ok(None) => {
        let _ = child.kill();
        let _ = child.wait();
        return Err(format!(
          "Downloaded {name} did not respond to its version check"
        ));
      }
      Err(error) => {
        let _ = child.kill();
        let _ = child.wait();
        return Err(format!("Could not check downloaded {name}: {error}"));
      }
    }
  }
}

fn replace_binary(directory: &Path, name: &str, binary: &[u8]) -> Result<PathBuf, String> {
  fs::create_dir_all(directory)
    .map_err(|error| format!("Cannot create tool directory: {error}"))?;
  let mut random = [0u8; 16];
  getrandom::fill(&mut random).map_err(|error| error.to_string())?;
  let suffix: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
  let staging = directory.join(format!(".staging-{suffix}"));
  fs::create_dir(&staging).map_err(|error| format!("Cannot stage {name}: {error}"))?;
  let temporary = staging.join(name);
  let destination = directory.join(name);
  let result = (|| {
    let mut file = OpenOptions::new()
      .write(true)
      .create_new(true)
      .open(&temporary)
      .map_err(|error| format!("Cannot stage {name}: {error}"))?;
    file
      .write_all(binary)
      .and_then(|()| file.set_permissions(fs::Permissions::from_mode(0o755)))
      .and_then(|()| file.sync_all())
      .map_err(|error| format!("Cannot stage {name}: {error}"))?;
    drop(file);
    verify_executable(&temporary, name)?;
    fs::rename(&temporary, &destination)
      .map_err(|error| format!("Cannot install {name}: {error}"))?;
    Ok(destination)
  })();
  let _ = fs::remove_file(temporary);
  let _ = fs::remove_dir(staging);
  result
}

fn install(directory: &Path, name: &str) -> Result<InstalledTool, String> {
  let _guard = INSTALL_LOCK
    .lock()
    .map_err(|_| "Tool installer is unavailable")?;
  let tool = tool(name, std::env::consts::ARCH)?;
  let client = reqwest::blocking::Client::builder()
    .user_agent("Papyri tool installer")
    .https_only(true)
    .connect_timeout(Duration::from_secs(20))
    .timeout(Duration::from_secs(300))
    .build()
    .map_err(|error| format!("Could not initialize downloads: {error}"))?;
  let release_url = format!(
    "https://api.github.com/repos/{}/releases/latest",
    tool.repository
  );
  let response = client
    .get(release_url)
    .send()
    .and_then(|response| response.error_for_status())
    .map_err(|error| format!("Could not check latest {} release: {error}", tool.name))?;
  let release: Release = serde_json::from_slice(&read_limited(response, RELEASE_LIMIT)?)
    .map_err(|error| format!("Invalid release information: {error}"))?;
  let asset = release
    .assets
    .iter()
    .find(|asset| asset.name == tool.asset)
    .ok_or_else(|| {
      format!(
        "The latest {} release has no {} download",
        tool.name, tool.asset
      )
    })?;
  let prefix = format!("https://github.com/{}/releases/download/", tool.repository);
  if !asset.browser_download_url.starts_with(&prefix)
    || asset.size == 0
    || asset.size > DOWNLOAD_LIMIT
  {
    return Err("The release download is invalid or too large".into());
  }
  let digest = asset
    .digest
    .as_deref()
    .and_then(|digest| digest.strip_prefix("sha256:"))
    .filter(|digest| digest.len() == 64 && digest.bytes().all(|byte| byte.is_ascii_hexdigit()))
    .ok_or("The release does not provide a SHA-256 digest")?;
  let response = client
    .get(&asset.browser_download_url)
    .send()
    .and_then(|response| response.error_for_status())
    .map_err(|error| format!("Could not download {}: {error}", tool.name))?;
  let archive = read_limited(response, DOWNLOAD_LIMIT)?;
  let actual_digest: String = Sha256::digest(&archive)
    .iter()
    .map(|byte| format!("{byte:02x}"))
    .collect();
  if archive.len() as u64 != asset.size || actual_digest != digest.to_ascii_lowercase() {
    return Err("Downloaded file failed its size or SHA-256 check".into());
  }
  let binary = executable_from_archive(&tool, &archive)?;
  let expected_machine = match std::env::consts::ARCH {
    "x86_64" => 62,
    "aarch64" => 183,
    _ => unreachable!(),
  };
  if binary.len() < 20
    || !binary.starts_with(b"\x7fELF")
    || binary[4] != 2
    || binary[5] != 1
    || u16::from_le_bytes([binary[18], binary[19]]) != expected_machine
  {
    return Err("Downloaded executable does not match this Linux architecture".into());
  }
  let destination = replace_binary(directory, tool.name, &binary)?;
  Ok(InstalledTool {
    path: destination.to_string_lossy().into_owned(),
    version: release.tag_name,
  })
}

#[tauri::command]
pub async fn install_tool(app: tauri::AppHandle, name: String) -> Result<InstalledTool, String> {
  let directory: PathBuf = app
    .path()
    .app_data_dir()
    .map_err(|error| error.to_string())?
    .join("tools");
  tauri::async_runtime::spawn_blocking(move || install(&directory, &name))
    .await
    .map_err(|error| format!("Tool installer task failed: {error}"))?
}

#[tauri::command]
pub async fn pick_executable(app: tauri::AppHandle) -> Result<Option<String>, String> {
  use tauri_plugin_dialog::DialogExt;
  tauri::async_runtime::spawn_blocking(move || {
    let Some(selection) = app.dialog().file().blocking_pick_file() else {
      return Ok(None);
    };
    let path = selection.into_path().map_err(|error| error.to_string())?;
    if !path.is_absolute() || !executables::is_executable(&path) {
      return Err("Choose an executable file".into());
    }
    Ok(Some(path.to_string_lossy().into_owned()))
  })
  .await
  .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn permits_only_known_tools_and_architectures() {
    assert_eq!(
      tool("marksman", "x86_64").unwrap().asset,
      "marksman-linux-x64"
    );
    assert_eq!(
      tool("typst", "aarch64").unwrap().asset,
      "typst-aarch64-unknown-linux-musl.tar.xz"
    );
    assert!(tool("../sh", "x86_64").is_err());
    assert!(tool("texlab", "sparc").is_err());
  }
  #[test]
  fn rejects_oversized_input_and_invalid_archives() {
    assert!(read_limited(&b"12345"[..], 4).is_err());
    assert!(executable_from_archive(&tool("texlab", "x86_64").unwrap(), b"invalid").is_err());
  }
  #[test]
  fn failed_update_preserves_the_installed_binary() {
    let directory = std::env::temp_dir().join(format!("papyri-update-test-{}", std::process::id()));
    fs::create_dir(&directory).unwrap();
    let destination = directory.join("marksman");
    fs::write(&destination, b"previous version").unwrap();
    assert!(replace_binary(&directory, "marksman", b"not an executable").is_err());
    assert_eq!(fs::read(&destination).unwrap(), b"previous version");
    assert_eq!(fs::read_dir(&directory).unwrap().count(), 1);
    fs::remove_dir_all(directory).unwrap();
  }

  #[test]
  #[ignore = "Downloads the latest upstream releases"]
  fn installs_upstream_releases() {
    let directory = std::env::temp_dir().join(format!("papyri-tools-test-{}", std::process::id()));
    fs::create_dir(&directory).unwrap();
    for name in ["marksman", "tinymist", "texlab", "typst"] {
      let installed = install(&directory, name).unwrap_or_else(|error| panic!("{name}: {error}"));
      assert!(executables::is_executable(Path::new(&installed.path)));
      let status = std::process::Command::new(&installed.path)
        .arg("--version")
        .status()
        .unwrap_or_else(|error| panic!("{name}: cannot execute downloaded binary: {error}"));
      assert!(status.success(), "{name}: version check failed");
    }
    fs::remove_dir_all(directory).unwrap();
  }
}

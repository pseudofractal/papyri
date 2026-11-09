//! Screen and DOM-element screenshots for the control API.

use serde::{Deserialize, Serialize};
use std::{
  fs,
  io::Write,
  os::unix::fs::OpenOptionsExt,
  path::{Path, PathBuf},
  process::{Command, Stdio},
  sync::mpsc,
  time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const MAX_CAPTURE_BYTES: usize = 128 * 1024 * 1024;
const CAPTURE_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
pub struct ScreenRegion {
  pub x: i32,
  pub y: i32,
  pub width: u32,
  pub height: u32,
}

/// Coordinates are fractions of the visible webview viewport.
#[derive(Clone, Copy, Debug, Deserialize)]
pub struct NormalizedRect {
  pub x: f64,
  pub y: f64,
  pub width: f64,
  pub height: f64,
}

#[derive(Debug, Serialize)]
pub struct CaptureResult {
  pub path: Option<String>,
  pub width: u32,
  pub height: u32,
  pub clipboard: bool,
  pub target: String,
  pub region: Option<ScreenRegion>,
}

#[tauri::command]
pub async fn capture_screen(
  region: Option<ScreenRegion>,
  output: Option<String>,
  clipboard: bool,
  target: Option<String>,
) -> Result<CaptureResult, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let bytes = screen_png(region)?;
    finish(
      bytes,
      region,
      output,
      clipboard,
      target.as_deref().unwrap_or("screen"),
    )
  })
  .await
  .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn capture_webview(
  app: AppHandle,
  rect: Option<NormalizedRect>,
  output: Option<String>,
  clipboard: bool,
  target: Option<String>,
) -> Result<CaptureResult, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let bytes = webview_png(&app, rect)?;
    finish(
      bytes,
      None,
      output,
      clipboard,
      target.as_deref().unwrap_or("app"),
    )
  })
  .await
  .map_err(|error| error.to_string())?
}

pub(crate) fn store_png(
  bytes: Vec<u8>,
  output: Option<String>,
  clipboard: bool,
  target: &str,
) -> Result<serde_json::Value, String> {
  serde_json::to_value(finish(bytes, None, output, clipboard, target)?)
    .map_err(|error| error.to_string())
}

fn finish(
  bytes: Vec<u8>,
  region: Option<ScreenRegion>,
  output: Option<String>,
  clipboard: bool,
  target: &str,
) -> Result<CaptureResult, String> {
  if bytes.len() > MAX_CAPTURE_BYTES {
    return Err("The screenshot exceeds the 128 MiB limit.".into());
  }
  let (width, height) = png_dimensions(&bytes)
    .ok_or_else(|| "The screenshot source did not return a valid PNG image.".to_string())?;
  let copied = if clipboard {
    copy_png(&bytes)?;
    true
  } else {
    false
  };
  let path = if output.is_some() || !clipboard {
    Some(save_png(&bytes, output.as_deref())?)
  } else {
    None
  };
  Ok(CaptureResult {
    path,
    width,
    height,
    clipboard: copied,
    target: target.into(),
    region,
  })
}

fn screen_png(region: Option<ScreenRegion>) -> Result<Vec<u8>, String> {
  if command_available("grim") {
    let mut command = Command::new("grim");
    if let Some(region) = region {
      command
        .arg("-g")
        .arg(format!(
          "{},{} {}x{}",
          region.x, region.y, region.width, region.height
        ))
        .arg("-t")
        .arg("png")
        .arg("-");
    } else {
      command.arg("-t").arg("png").arg("-");
    }
    return run_capture(command, "grim");
  }
  if command_available("import") {
    return import_png(region);
  }
  Err(
    "No screenshot backend is available. Install grim (Wayland) or ImageMagick import (X11)."
      .into(),
  )
}

fn import_png(region: Option<ScreenRegion>) -> Result<Vec<u8>, String> {
  let temp = std::env::temp_dir().join(format!("papyri-capture-{}.png", std::process::id()));
  let status = Command::new("import")
    .arg("-window")
    .arg("root")
    .arg(&temp)
    .status()
    .map_err(|error| format!("Could not run ImageMagick import: {error}"))?;
  if !status.success() {
    let _ = fs::remove_file(&temp);
    return Err("ImageMagick import could not capture the screen.".into());
  }
  let result = if let Some(region) = region {
    if command_available("magick") {
      let mut command = Command::new("magick");
      command
        .arg(&temp)
        .arg("-crop")
        .arg(format!(
          "{}x{}+{}+{}",
          region.width, region.height, region.x, region.y
        ))
        .arg("png:-");
      run_capture(command, "ImageMagick crop")
    } else {
      Err("Cropping an X11 capture requires ImageMagick magick.".into())
    }
  } else {
    fs::read(&temp).map_err(|error| format!("Could not read the screenshot: {error}"))
  };
  let _ = fs::remove_file(&temp);
  result
}

fn run_capture(mut command: Command, label: &str) -> Result<Vec<u8>, String> {
  let output = command
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .output()
    .map_err(|error| format!("Could not run {label}: {error}"))?;
  if !output.status.success() {
    let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
    return Err(if message.is_empty() {
      format!("{label} failed to capture the screen.")
    } else {
      format!("{label} failed: {message}")
    });
  }
  if output.stdout.is_empty() {
    return Err(format!("{label} returned an empty image."));
  }
  Ok(output.stdout)
}

fn webview_png(app: &AppHandle, rect: Option<NormalizedRect>) -> Result<Vec<u8>, String> {
  let window = app
    .get_webview_window("main")
    .ok_or_else(|| "The main window is unavailable.".to_string())?;
  let (sender, receiver) = mpsc::channel::<Result<Vec<u8>, String>>();
  window
    .with_webview(move |platform| {
      use webkit2gtk::{SnapshotOptions, SnapshotRegion, WebViewExt};
      let view = platform.inner();
      view.snapshot(
        SnapshotRegion::Visible,
        SnapshotOptions::NONE,
        None::<&gtk::gio::Cancellable>,
        move |result| {
          let output = result
            .map_err(|error| error.to_string())
            .and_then(|surface| crop_surface(&surface, rect));
          let _ = sender.send(output);
        },
      );
    })
    .map_err(|error| format!("Could not access the main webview: {error}"))?;
  receiver
    .recv_timeout(CAPTURE_TIMEOUT)
    .map_err(|_| "The screenshot request timed out.".to_string())?
}

fn crop_surface(
  surface: &gtk::cairo::Surface,
  rect: Option<NormalizedRect>,
) -> Result<Vec<u8>, String> {
  let image: gtk::cairo::ImageSurface = surface
    .clone()
    .try_into()
    .map_err(|_| "The webview snapshot is not an image surface.".to_string())?;
  let (x, y, width, height) = match rect {
    None => (0, 0, image.width(), image.height()),
    Some(rect) => {
      if !rect.x.is_finite()
        || !rect.y.is_finite()
        || !rect.width.is_finite()
        || !rect.height.is_finite()
        || rect.width <= 0.0
        || rect.height <= 0.0
      {
        return Err("The element rectangle is invalid.".into());
      }
      let surface_width = image.width() as f64;
      let surface_height = image.height() as f64;
      let left = (rect.x.clamp(0.0, 1.0) * surface_width).floor() as i32;
      let top = (rect.y.clamp(0.0, 1.0) * surface_height).floor() as i32;
      let right = ((rect.x + rect.width).clamp(0.0, 1.0) * surface_width).ceil() as i32;
      let bottom = ((rect.y + rect.height).clamp(0.0, 1.0) * surface_height).ceil() as i32;
      let width = (right - left).max(1);
      let height = (bottom - top).max(1);
      if width <= 0 || height <= 0 {
        return Err("The element is outside the visible viewport.".into());
      }
      (left, top, width, height)
    }
  };
  let cropped = gtk::cairo::ImageSurface::create(gtk::cairo::Format::ARgb32, width, height)
    .map_err(|error| error.to_string())?;
  {
    let context = gtk::cairo::Context::new(&cropped).map_err(|error| error.to_string())?;
    context
      .set_source_surface(image.as_ref(), -x as f64, -y as f64)
      .map_err(|error| error.to_string())?;
    context.paint().map_err(|error| error.to_string())?;
  }
  let mut png = Vec::new();
  cropped
    .as_ref()
    .write_to_png(&mut png)
    .map_err(|error| error.to_string())?;
  Ok(png)
}

fn copy_png(bytes: &[u8]) -> Result<(), String> {
  let mut command = if std::env::var_os("WAYLAND_DISPLAY").is_some() && command_available("wl-copy")
  {
    let mut command = Command::new("wl-copy");
    command.arg("--type").arg("image/png");
    command
  } else if std::env::var_os("DISPLAY").is_some() && command_available("xclip") {
    let mut command = Command::new("xclip");
    command
      .arg("-selection")
      .arg("clipboard")
      .arg("-t")
      .arg("image/png")
      .arg("-i");
    command
  } else {
    return Err("No image clipboard backend is available (install wl-copy or xclip).".into());
  };
  let mut child = command
    .stdin(Stdio::piped())
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .spawn()
    .map_err(|error| format!("Could not start the clipboard backend: {error}"))?;
  if let Some(mut stdin) = child.stdin.take() {
    stdin
      .write_all(bytes)
      .map_err(|error| format!("Could not write to the clipboard: {error}"))?;
  }
  // Clipboard owners stay alive while they own the selection. Reap the child
  // in the background so Papyri never blocks on it.
  std::thread::spawn(move || {
    let _ = child.wait();
  });
  Ok(())
}

fn save_png(bytes: &[u8], output: Option<&str>) -> Result<String, String> {
  let path = match output {
    Some(path) => PathBuf::from(path),
    None => default_path(),
  };
  if path.as_os_str().is_empty() {
    return Err("The screenshot output path is empty.".into());
  }
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent)
      .map_err(|error| format!("Could not create {}: {error}", parent.display()))?;
  }
  let mut file = fs::OpenOptions::new()
    .write(true)
    .create(true)
    .truncate(true)
    .mode(0o600)
    .open(&path)
    .map_err(|error| format!("Could not create {}: {error}", path.display()))?;
  file
    .write_all(bytes)
    .map_err(|error| format!("Could not write {}: {error}", path.display()))?;
  Ok(path.to_string_lossy().into_owned())
}

fn default_path() -> PathBuf {
  let base = std::env::var_os("XDG_CACHE_HOME")
    .map(PathBuf::from)
    .or_else(|| std::env::var_os("HOME").map(|home| Path::new(&home).join(".cache")))
    .unwrap_or_else(std::env::temp_dir)
    .join("papyri")
    .join("screenshots");
  let stamp = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|duration| duration.as_millis())
    .unwrap_or(0);
  base.join(format!("screenshot-{stamp}-{}.png", std::process::id()))
}

fn command_available(name: &str) -> bool {
  std::env::var_os("PATH")
    .is_some_and(|paths| std::env::split_paths(&paths).any(|path| path.join(name).is_file()))
}

fn png_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
  const SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
  if bytes.len() < 24 || &bytes[..8] != SIGNATURE || &bytes[12..16] != b"IHDR" {
    return None;
  }
  Some((
    u32::from_be_bytes(bytes[16..20].try_into().ok()?),
    u32::from_be_bytes(bytes[20..24].try_into().ok()?),
  ))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn reads_png_dimensions_from_ihdr() {
    let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
    bytes.extend_from_slice(&13u32.to_be_bytes());
    bytes.extend_from_slice(b"IHDR");
    bytes.extend_from_slice(&640u32.to_be_bytes());
    bytes.extend_from_slice(&480u32.to_be_bytes());
    assert_eq!(png_dimensions(&bytes), Some((640, 480)));
    assert_eq!(png_dimensions(b"not a png"), None);
  }

  #[test]
  fn rejects_invalid_capture_rectangles() {
    let surface =
      gtk::cairo::ImageSurface::create(gtk::cairo::Format::ARgb32, 10, 10).expect("surface");
    assert!(crop_surface(
      surface.as_ref(),
      Some(NormalizedRect {
        x: 0.0,
        y: 0.0,
        width: 0.0,
        height: 1.0,
      })
    )
    .is_err());
  }
}

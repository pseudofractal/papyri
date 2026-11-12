//! Clipboard commands shared by every desktop build.
//!
//! Linux keeps the existing `wl-copy`/`xclip` backends so images and text work
//! in both Wayland and X11 sessions. macOS and Windows use the native
//! `arboard` clipboard, including RGBA image support.

use serde_json::Value;
use std::io::Write;
use std::process::{Command, Stdio};

#[cfg(target_os = "linux")]
fn prefer_x11_clipboard() -> bool {
  std::env::var_os("DISPLAY").is_some()
    && std::env::var("GDK_BACKEND").map_or(true, |backend| backend != "wayland")
}

#[cfg(target_os = "linux")]
fn clipboard_command_read() -> Result<Command, String> {
  if prefer_x11_clipboard() {
    let mut command = Command::new("xclip");
    command.args(["-selection", "clipboard", "-o"]);
    return Ok(command);
  }
  if std::env::var_os("WAYLAND_DISPLAY").is_some() {
    return Ok(Command::new("wl-paste"));
  }
  if std::env::var_os("DISPLAY").is_some() {
    let mut command = Command::new("xclip");
    command.args(["-selection", "clipboard", "-o"]);
    return Ok(command);
  }
  Err("No clipboard backend is available.".into())
}

#[cfg(target_os = "linux")]
fn clipboard_command_write() -> Result<Command, String> {
  if prefer_x11_clipboard() {
    let mut command = Command::new("xclip");
    command.args(["-selection", "clipboard"]);
    return Ok(command);
  }
  if std::env::var_os("WAYLAND_DISPLAY").is_some() {
    return Ok(Command::new("wl-copy"));
  }
  if std::env::var_os("DISPLAY").is_some() {
    let mut command = Command::new("xclip");
    command.args(["-selection", "clipboard"]);
    return Ok(command);
  }
  Err("No clipboard backend is available.".into())
}

#[cfg(target_os = "linux")]
pub fn read_text() -> Result<String, String> {
  let mut command = clipboard_command_read()?;
  let output = command
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .output()
    .map_err(|error| format!("Could not read the clipboard: {error}"))?;
  if !output.status.success() {
    return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
  }
  String::from_utf8(output.stdout).map_err(|error| error.to_string())
}

#[cfg(target_os = "linux")]
pub fn write_text(text: &str) -> Result<(), String> {
  let mut command = clipboard_command_write()?;
  let mut child = command
    .stdin(Stdio::piped())
    .stdout(Stdio::null())
    .stderr(Stdio::piped())
    .spawn()
    .map_err(|error| format!("Could not write the clipboard: {error}"))?;
  if let Some(mut stdin) = child.stdin.take() {
    stdin
      .write_all(text.as_bytes())
      .map_err(|error| error.to_string())?;
  }
  let status = child.wait().map_err(|error| error.to_string())?;
  if !status.success() {
    return Err("The clipboard backend failed.".into());
  }
  Ok(())
}

#[cfg(target_os = "linux")]
fn clipboard_image_read_command() -> Result<Command, String> {
  if prefer_x11_clipboard() {
    let mut command = Command::new("xclip");
    command.args(["-selection", "clipboard", "-t", "image/png", "-o"]);
    return Ok(command);
  }
  if std::env::var_os("WAYLAND_DISPLAY").is_some() {
    let mut command = Command::new("wl-paste");
    command.args(["--type", "image/png"]);
    return Ok(command);
  }
  if std::env::var_os("DISPLAY").is_some() {
    let mut command = Command::new("xclip");
    command.args(["-selection", "clipboard", "-t", "image/png", "-o"]);
    return Ok(command);
  }
  Err("No clipboard backend is available.".into())
}

#[cfg(target_os = "linux")]
fn clipboard_image_write_command() -> Result<Command, String> {
  if prefer_x11_clipboard() {
    let mut command = Command::new("xclip");
    command.args(["-selection", "clipboard", "-t", "image/png", "-i"]);
    return Ok(command);
  }
  if std::env::var_os("WAYLAND_DISPLAY").is_some() {
    let mut command = Command::new("wl-copy");
    command.args(["--type", "image/png"]);
    return Ok(command);
  }
  if std::env::var_os("DISPLAY").is_some() {
    let mut command = Command::new("xclip");
    command.args(["-selection", "clipboard", "-t", "image/png", "-i"]);
    return Ok(command);
  }
  Err("No clipboard backend is available.".into())
}

#[cfg(target_os = "linux")]
pub fn read_image_bytes() -> Result<Vec<u8>, String> {
  let mut command = clipboard_image_read_command()?;
  let output = command
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .output()
    .map_err(|error| format!("Could not read the clipboard image: {error}"))?;
  if !output.status.success() || output.stdout.is_empty() {
    return Err("The clipboard does not contain a PNG image.".into());
  }
  if output.stdout.len() > 128 * 1024 * 1024 {
    return Err("The clipboard image exceeds the 128 MiB limit.".into());
  }
  Ok(output.stdout)
}

#[cfg(target_os = "linux")]
pub fn write_image_bytes(bytes: &[u8]) -> Result<(), String> {
  let mut command = clipboard_image_write_command()?;
  let mut child = command
    .stdin(Stdio::piped())
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .spawn()
    .map_err(|error| format!("Could not write the clipboard image: {error}"))?;
  if let Some(mut stdin) = child.stdin.take() {
    stdin.write_all(bytes).map_err(|error| error.to_string())?;
  }
  std::thread::spawn(move || {
    let _ = child.wait();
  });
  Ok(())
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn native_clipboard() -> Result<arboard::Clipboard, String> {
  arboard::Clipboard::new().map_err(|error| format!("Could not open the clipboard: {error}"))
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
pub fn read_text() -> Result<String, String> {
  let mut clipboard = native_clipboard()?;
  clipboard
    .get_text()
    .map_err(|error| format!("Could not read the clipboard: {error}"))
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
pub fn write_text(text: &str) -> Result<(), String> {
  let mut clipboard = native_clipboard()?;
  clipboard
    .set_text(text)
    .map_err(|error| format!("Could not write the clipboard: {error}"))
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn encode_png(width: usize, height: usize, rgba: &[u8]) -> Result<Vec<u8>, String> {
  let mut bytes = Vec::new();
  {
    let mut encoder = png::Encoder::new(&mut bytes, width as u32, height as u32);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder
      .write_header()
      .map_err(|error| format!("Could not encode the clipboard image: {error}"))?;
    writer
      .write_image_data(rgba)
      .map_err(|error| format!("Could not encode the clipboard image: {error}"))?;
  }
  Ok(bytes)
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn decode_png(bytes: &[u8]) -> Result<(usize, usize, Vec<u8>), String> {
  let decoder = png::Decoder::new(bytes);
  let mut reader = decoder
    .read_info()
    .map_err(|error| format!("Could not decode the clipboard image: {error}"))?;
  let mut buffer = vec![0; reader.output_buffer_size()];
  let info = reader
    .next_frame(&mut buffer)
    .map_err(|error| format!("Could not decode the clipboard image: {error}"))?;
  if info.color_type != png::ColorType::Rgba || info.bit_depth != png::BitDepth::Eight {
    return Err("The clipboard image must be 8-bit RGBA PNG data.".into());
  }
  buffer.truncate(info.buffer_size());
  Ok((info.width as usize, info.height as usize, buffer))
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
pub fn read_image_bytes() -> Result<Vec<u8>, String> {
  let mut clipboard = native_clipboard()?;
  let image = clipboard
    .get_image()
    .map_err(|error| format!("The clipboard does not contain an image: {error}"))?;
  encode_png(image.width, image.height, image.bytes.as_ref())
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
pub fn write_image_bytes(bytes: &[u8]) -> Result<(), String> {
  let (width, height, rgba) = decode_png(bytes)?;
  let mut clipboard = native_clipboard()?;
  clipboard
    .set_image(arboard::ImageData {
      width,
      height,
      bytes: std::borrow::Cow::Owned(rgba),
    })
    .map_err(|error| format!("Could not write the clipboard image: {error}"))
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
pub fn read_text() -> Result<String, String> {
  Err("Clipboard access is unavailable on this platform.".into())
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
pub fn write_text(_text: &str) -> Result<(), String> {
  Err("Clipboard access is unavailable on this platform.".into())
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
pub fn read_image_bytes() -> Result<Vec<u8>, String> {
  Err("Clipboard image access is unavailable on this platform.".into())
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
pub fn write_image_bytes(_bytes: &[u8]) -> Result<(), String> {
  Err("Clipboard image access is unavailable on this platform.".into())
}

#[tauri::command]
pub async fn clipboard_read() -> Result<String, String> {
  tauri::async_runtime::spawn_blocking(read_text)
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn clipboard_write(text: String) -> Result<(), String> {
  tauri::async_runtime::spawn_blocking(move || write_text(&text))
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn clipboard_read_image(output: Option<String>) -> Result<Value, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let bytes = read_image_bytes()?;
    crate::screenshot::store_png(bytes, output, false, "clipboard")
  })
  .await
  .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn clipboard_write_image(path: String) -> Result<(), String> {
  tauri::async_runtime::spawn_blocking(move || {
    let bytes = std::fs::read(&path).map_err(|error| format!("Could not read {path}: {error}"))?;
    if bytes.len() > 128 * 1024 * 1024 {
      return Err("The clipboard image exceeds the 128 MiB limit.".into());
    }
    write_image_bytes(&bytes)
  })
  .await
  .map_err(|error| error.to_string())?
}

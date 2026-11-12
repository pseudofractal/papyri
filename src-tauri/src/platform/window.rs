//! Cross-platform desktop window enumeration, focusing, and capture.
//!
//! Uses `xcap` for macOS and Windows window discovery/capture, with native
//! focus calls. Linux keeps the GTK path in `input.rs`.

use serde_json::{json, Value};

fn png_bytes(image: &xcap::image::RgbaImage) -> Result<Vec<u8>, String> {
  let mut bytes = Vec::new();
  {
    let mut encoder = png::Encoder::new(&mut bytes, image.width(), image.height());
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder
      .write_header()
      .map_err(|error| format!("Could not encode the window image: {error}"))?;
    writer
      .write_image_data(image.as_raw())
      .map_err(|error| format!("Could not encode the window image: {error}"))?;
  }
  Ok(bytes)
}

pub fn list() -> Result<Value, String> {
  let windows = xcap::Window::all().map_err(|error| format!("Could not list windows: {error}"))?;
  let values = windows
    .into_iter()
    .filter_map(|window| {
      let title = window.title().ok().unwrap_or_default();
      let app = window.app_name().ok().unwrap_or_default();
      if title.is_empty() && app.is_empty() {
        return None;
      }
      Some(json!({
        "id": window.id().ok()?.to_string(),
        "title": title,
        "role": app,
        "visible": !window.is_minimized().unwrap_or(false),
        "active": window.is_focused().unwrap_or(false),
        "width": window.width().unwrap_or(0),
        "height": window.height().unwrap_or(0),
        "x": window.x().unwrap_or(0),
        "y": window.y().unwrap_or(0),
      }))
    })
    .collect::<Vec<_>>();
  Ok(Value::Array(values))
}

pub fn focus(id: &str) -> Result<(), String> {
  let id: u32 = id.parse().map_err(|_| format!("Invalid window id: {id}"))?;
  let windows = xcap::Window::all().map_err(|error| format!("Could not list windows: {error}"))?;
  let _window = windows
    .into_iter()
    .find(|window| window.id().ok() == Some(id))
    .ok_or_else(|| format!("Window is no longer available: {id}"))?;
  #[cfg(target_os = "windows")]
  {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
      SetForegroundWindow, ShowWindow, SW_RESTORE,
    };
    let hwnd = id as usize as *mut core::ffi::c_void;
    unsafe {
      ShowWindow(hwnd, SW_RESTORE);
      if SetForegroundWindow(hwnd) == 0 {
        return Err("Windows could not focus the selected window.".into());
      }
    }
    Ok(())
  }
  #[cfg(target_os = "macos")]
  {
    let pid = _window
      .pid()
      .map_err(|error| format!("Could not inspect the selected window: {error}"))?;
    let script = format!(
      "tell application \"System Events\" to set frontmost of first process whose unix id is {pid} to true"
    );
    let output = std::process::Command::new("osascript")
      .args(["-e", &script])
      .output()
      .map_err(|error| format!("Could not focus the selected window: {error}"))?;
    if output.status.success() {
      Ok(())
    } else {
      Err(format!(
        "Could not focus the selected window: {}",
        String::from_utf8_lossy(&output.stderr).trim()
      ))
    }
  }
}

pub fn capture(id: &str) -> Result<Vec<u8>, String> {
  let id: u32 = id.parse().map_err(|_| format!("Invalid window id: {id}"))?;
  let windows = xcap::Window::all().map_err(|error| format!("Could not list windows: {error}"))?;
  let window = windows
    .into_iter()
    .find(|window| window.id().ok() == Some(id))
    .ok_or_else(|| format!("Window is no longer available: {id}"))?;
  let image = window
    .capture_image()
    .map_err(|error| format!("Could not capture the window: {error}"))?;
  png_bytes(&image)
}

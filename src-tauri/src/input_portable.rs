//! Input and window commands for non-Linux desktop builds.
//!
//! Tauri can enumerate and focus its own windows on every platform, while
//! coordinate input injection remains a Linux/X11 capability. Returning a
//! typed error keeps the control protocol stable and lets the capability flags
//! hide unsupported commands.

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize};

#[derive(Serialize)]
struct WindowInfo {
  id: String,
  title: String,
  role: String,
  visible: bool,
  active: bool,
  width: i32,
  height: i32,
  x: i32,
  y: i32,
}

#[tauri::command]
pub async fn input_inject(_action: String, _params: Value) -> Result<Value, String> {
  Err("Native input injection is only available in the Linux build.".into())
}

#[tauri::command]
pub async fn window_list(app: AppHandle) -> Result<Value, String> {
  let windows = app
    .webview_windows()
    .into_iter()
    .map(|(label, window)| {
      let position = window
        .outer_position()
        .unwrap_or(PhysicalPosition::new(0, 0));
      let size = window.outer_size().unwrap_or(PhysicalSize::new(0, 0));
      WindowInfo {
        id: label,
        title: window.title().unwrap_or_default(),
        role: "window".into(),
        visible: window.is_visible().unwrap_or(false),
        active: window.is_focused().unwrap_or(false),
        width: size.width as i32,
        height: size.height as i32,
        x: position.x,
        y: position.y,
      }
    })
    .collect::<Vec<_>>();
  serde_json::to_value(windows).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn window_focus(app: AppHandle, id: String) -> Result<(), String> {
  let window = app
    .get_webview_window(&id)
    .ok_or_else(|| format!("Window is no longer available: {id}"))?;
  window.unminimize().map_err(|error| error.to_string())?;
  window.show().map_err(|error| error.to_string())?;
  window.set_focus().map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn window_capture(
  _app: AppHandle,
  _id: String,
  _output: Option<String>,
  _clipboard: bool,
) -> Result<Value, String> {
  Err("Window capture is only available in the Linux build.".into())
}

//! Input and window commands for non-Linux desktop builds.
//!
//! Input injection dispatches to CoreGraphics on macOS and `SendInput` on
//! Windows. Window discovery/capture uses `xcap` on both platforms; mobile
//! fallbacks can still enumerate Tauri's own windows.

use serde_json::Value;

#[tauri::command]
pub async fn input_inject(action: String, params: Value) -> Result<Value, String> {
  tauri::async_runtime::spawn_blocking(move || {
    #[cfg(target_os = "macos")]
    {
      return crate::platform::macos::inject(&action, &params);
    }
    #[cfg(target_os = "windows")]
    {
      return crate::platform::windows::inject(&action, &params);
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
      let _ = (action, params);
      Err("Native input injection is unavailable on this platform.".into())
    }
  })
  .await
  .map_err(|error| error.to_string())?
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
#[tauri::command]
pub async fn window_list(_app: tauri::AppHandle) -> Result<Value, String> {
  tauri::async_runtime::spawn_blocking(crate::platform::window::list)
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
#[tauri::command]
pub async fn window_focus(_app: tauri::AppHandle, id: String) -> Result<(), String> {
  tauri::async_runtime::spawn_blocking(move || crate::platform::window::focus(&id))
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
#[tauri::command]
pub async fn window_capture(
  _app: tauri::AppHandle,
  id: String,
  output: Option<String>,
  clipboard: bool,
) -> Result<Value, String> {
  let bytes = tauri::async_runtime::spawn_blocking(move || crate::platform::window::capture(&id))
    .await
    .map_err(|error| error.to_string())??;
  crate::screenshot::store_png(bytes, output, clipboard, "window")
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
#[tauri::command]
pub async fn window_list(app: tauri::AppHandle) -> Result<Value, String> {
  use tauri::Manager;
  let windows = app
    .webview_windows()
    .into_iter()
    .map(|(label, window)| {
      serde_json::json!({
        "id": label,
        "title": window.title().unwrap_or_default(),
        "role": "window",
        "visible": window.is_visible().unwrap_or(false),
        "active": window.is_focused().unwrap_or(false),
        "width": window.outer_size().map(|size| size.width).unwrap_or(0),
        "height": window.outer_size().map(|size| size.height).unwrap_or(0),
        "x": window.outer_position().map(|position| position.x).unwrap_or(0),
        "y": window.outer_position().map(|position| position.y).unwrap_or(0),
      })
    })
    .collect::<Vec<_>>();
  Ok(Value::Array(windows))
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
#[tauri::command]
pub async fn window_focus(app: tauri::AppHandle, id: String) -> Result<(), String> {
  use tauri::Manager;
  let window = app
    .get_webview_window(&id)
    .ok_or_else(|| format!("Window is no longer available: {id}"))?;
  window.unminimize().map_err(|error| error.to_string())?;
  window.show().map_err(|error| error.to_string())?;
  window.set_focus().map_err(|error| error.to_string())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
#[tauri::command]
pub async fn window_capture(
  _app: tauri::AppHandle,
  _id: String,
  _output: Option<String>,
  _clipboard: bool,
) -> Result<Value, String> {
  Err("Window capture is unavailable on this platform.".into())
}

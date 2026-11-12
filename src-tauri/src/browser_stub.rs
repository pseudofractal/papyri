//! Browser-panel command surface for non-Linux desktop builds.
//!
//! The panel itself is a GTK child-webview implementation. Keeping these
//! commands registered (and returning a precise error) lets the shared frontend
//! call them defensively while `platform::capabilities()` hides the panel.

use serde_json::Value;
use std::path::PathBuf;
use tauri::AppHandle;

const UNAVAILABLE: &str = "The embedded browser panel is only available in the Linux build.";

#[allow(dead_code)]
pub fn install(
  _window: &tauri::WebviewWindow,
  _app: AppHandle,
  _data_dir: PathBuf,
  _cache_dir: PathBuf,
) -> Result<(), String> {
  Ok(())
}

#[tauri::command]
pub async fn browser_capture(
  _app: AppHandle,
  _rect: Option<crate::screenshot::NormalizedRect>,
  _output: Option<String>,
  _clipboard: bool,
) -> Result<Value, String> {
  Err(UNAVAILABLE.into())
}

#[tauri::command]
pub async fn browser_dom(
  _app: AppHandle,
  _action: String,
  _params: Value,
) -> Result<Value, String> {
  Err(UNAVAILABLE.into())
}

#[tauri::command]
pub fn browser_show(_app: AppHandle, _site: String, _url: Option<String>) -> Result<(), String> {
  Err(UNAVAILABLE.into())
}

#[tauri::command]
pub fn browser_select(_app: AppHandle, _site: String) -> Result<(), String> {
  Err(UNAVAILABLE.into())
}

#[tauri::command]
pub fn browser_open_window(_app: AppHandle, _url: Option<String>) -> Result<(), String> {
  Err(UNAVAILABLE.into())
}

#[tauri::command]
pub fn browser_set_zoom(_app: AppHandle, _zoom: f64) {}

#[tauri::command]
pub fn browser_quote(_app: AppHandle, _site: String, _text: String) -> Result<(), String> {
  Err(UNAVAILABLE.into())
}

#[tauri::command]
pub fn browser_search_wikipedia(_app: AppHandle, _text: String) -> Result<(), String> {
  Err(UNAVAILABLE.into())
}

#[tauri::command]
pub fn browser_navigate(_app: AppHandle, _url: String) -> Result<(), String> {
  Err(UNAVAILABLE.into())
}

#[tauri::command]
pub fn browser_back(_app: AppHandle) {}

#[tauri::command]
pub fn browser_forward(_app: AppHandle) {}

#[tauri::command]
pub fn browser_reload(_app: AppHandle) {}

#[tauri::command]
pub fn browser_stop(_app: AppHandle) {}

#[tauri::command]
pub fn browser_set_visible(_app: AppHandle, _visible: bool) {}

#[tauri::command]
pub fn browser_set_bounds(_app: AppHandle, _x: i32, _y: i32, _width: i32, _height: i32) {}

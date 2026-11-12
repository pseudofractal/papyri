//! Native input, clipboard access, and window enumeration for agent control.

use gtk::prelude::*;
use serde::Serialize;
use serde_json::{json, Value};
use std::{ffi::CString, sync::mpsc, time::Duration};
use tauri::{AppHandle, Manager};
use x11_dl::{xlib, xtest};

const BUTTON_HOLD: Duration = Duration::from_millis(30);
const KEY_HOLD: Duration = Duration::from_millis(5);
const KEY_GAP: Duration = Duration::from_millis(9);

#[derive(Clone, Copy, Debug)]
enum MouseButton {
  Left,
  Middle,
  Right,
}

impl MouseButton {
  fn number(self) -> u32 {
    match self {
      Self::Left => 1,
      Self::Middle => 2,
      Self::Right => 3,
    }
  }
}

fn mouse_button(value: Option<&str>) -> Result<MouseButton, String> {
  match value.unwrap_or("left") {
    "left" => Ok(MouseButton::Left),
    "middle" => Ok(MouseButton::Middle),
    "right" => Ok(MouseButton::Right),
    other => Err(format!("Unknown mouse button: {other}")),
  }
}

struct XServer {
  xlib: xlib::Xlib,
  xtest: xtest::Xf86vmode,
  display: *mut xlib::Display,
}

impl XServer {
  fn open() -> Result<Self, String> {
    let xlib = xlib::Xlib::open().map_err(|error| error.to_string())?;
    let xtest = xtest::Xf86vmode::open().map_err(|error| error.to_string())?;
    let display = unsafe { (xlib.XOpenDisplay)(std::ptr::null()) };
    if display.is_null() {
      return Err(
        "Coordinate input requires an X11 display. Start Papyri with GDK_BACKEND=x11.".into(),
      );
    }
    Ok(Self {
      xlib,
      xtest,
      display,
    })
  }

  fn flush(&self) {
    unsafe { (self.xlib.XFlush)(self.display) };
  }

  fn move_pointer(&self, x: i32, y: i32) {
    unsafe { (self.xtest.XTestFakeMotionEvent)(self.display, -1, x, y, 0) };
    self.flush();
  }

  fn press_button(&self, button: MouseButton) {
    unsafe { (self.xtest.XTestFakeButtonEvent)(self.display, button.number(), 1, 0) };
    self.flush();
  }

  fn release_button(&self, button: MouseButton) {
    unsafe { (self.xtest.XTestFakeButtonEvent)(self.display, button.number(), 0, 0) };
    self.flush();
  }

  fn click_button(&self, button: MouseButton) {
    self.press_button(button);
    std::thread::sleep(BUTTON_HOLD);
    self.release_button(button);
  }

  fn key_sym(&self, name: &str) -> Option<u64> {
    let normalized = name.to_ascii_lowercase();
    let canonical = match normalized.as_str() {
      "ctrl" | "control" => "Control_L",
      "shift" => "Shift_L",
      "alt" | "option" => "Alt_L",
      "super" | "meta" | "win" => "Super_L",
      "enter" | "return" => "Return",
      "esc" | "escape" => "Escape",
      "tab" => "Tab",
      "space" => "space",
      "backspace" => "BackSpace",
      "delete" | "del" => "Delete",
      "insert" => "Insert",
      "home" => "Home",
      "end" => "End",
      "pageup" => "Page_Up",
      "pagedown" => "Page_Down",
      "left" => "Left",
      "right" => "Right",
      "up" => "Up",
      "down" => "Down",
      other => other,
    };
    let c = CString::new(canonical).ok()?;
    let sym = unsafe { (self.xlib.XStringToKeysym)(c.as_ptr()) };
    (sym != 0).then_some(sym)
  }

  fn keycode(&self, name: &str) -> Result<u32, String> {
    let keysym = self
      .key_sym(name)
      .ok_or_else(|| format!("Unknown key: {name}"))?;
    let code = unsafe { (self.xlib.XKeysymToKeycode)(self.display, keysym) };
    if code == 0 {
      return Err(format!("No keycode for: {name}"));
    }
    Ok(code as u32)
  }

  fn shift_code(&self) -> u32 {
    self.keycode("Shift_L").unwrap_or_default()
  }

  fn press_keys(&self, keys: &str) -> Result<(), String> {
    let parts: Vec<&str> = keys
      .split('+')
      .map(str::trim)
      .filter(|part| !part.is_empty())
      .collect();
    if parts.is_empty() {
      return Err("The key combination is empty.".into());
    }
    let mut codes = Vec::new();
    for part in &parts {
      codes.push((self.keycode(part)?, shifted(part)));
    }
    let shift = self.shift_code();
    for (code, needs_shift) in &codes {
      if *needs_shift && shift != 0 {
        unsafe { (self.xtest.XTestFakeKeyEvent)(self.display, shift, 1, 0) };
      }
      unsafe { (self.xtest.XTestFakeKeyEvent)(self.display, *code, 1, 0) };
      self.flush();
      std::thread::sleep(KEY_HOLD);
    }
    for (code, needs_shift) in codes.iter().rev() {
      unsafe { (self.xtest.XTestFakeKeyEvent)(self.display, *code, 0, 0) };
      if *needs_shift && shift != 0 {
        unsafe { (self.xtest.XTestFakeKeyEvent)(self.display, shift, 0, 0) };
      }
      self.flush();
      std::thread::sleep(KEY_HOLD);
    }
    std::thread::sleep(KEY_GAP);
    Ok(())
  }

  fn type_text(&self, text: &str) -> Result<(), String> {
    if !text.chars().all(|character| {
      matches!(character, '\n' | '\t' | '\r') || character_key(character).is_some()
    }) {
      return self.paste_text(text);
    }
    for character in text.chars() {
      match character {
        '\n' => self.press_keys("Return")?,
        '\t' => self.press_keys("Tab")?,
        '\r' => {}
        other => {
          let (name, needs_shift) =
            character_key(other).ok_or_else(|| format!("Cannot type character: {other:?}"))?;
          if needs_shift {
            self.press_keys(&format!("Shift+{name}"))?;
          } else {
            self.press_keys(&name)?;
          }
        }
      }
      std::thread::sleep(KEY_GAP);
    }
    Ok(())
  }

  fn paste_text(&self, text: &str) -> Result<(), String> {
    let previous = crate::platform::clipboard::read_text().ok();
    crate::platform::clipboard::write_text(text)?;
    std::thread::sleep(Duration::from_millis(250));
    self.press_keys("ctrl+v")?;
    std::thread::sleep(Duration::from_millis(350));
    if let Some(previous) = previous {
      let _ = crate::platform::clipboard::write_text(&previous);
    }
    Ok(())
  }
}

impl Drop for XServer {
  fn drop(&mut self) {
    unsafe {
      (self.xlib.XCloseDisplay)(self.display);
    }
  }
}

#[tauri::command]
pub async fn input_inject(action: String, params: Value) -> Result<Value, String> {
  tauri::async_runtime::spawn_blocking(move || inject(&action, &params))
    .await
    .map_err(|error| error.to_string())?
}

fn inject(action: &str, params: &Value) -> Result<Value, String> {
  let server = XServer::open()?;
  match action {
    "move" => {
      server.move_pointer(number(params, "x")?, number(params, "y")?);
      Ok(json!({ "moved": true }))
    }
    "click" => {
      let button = mouse_button(params.get("button").and_then(Value::as_str))?;
      let count = integer(params, "count").unwrap_or(1).clamp(1, 3);
      server.move_pointer(number(params, "x")?, number(params, "y")?);
      for index in 0..count {
        server.click_button(button);
        if index + 1 < count {
          std::thread::sleep(Duration::from_millis(80));
        }
      }
      Ok(json!({ "clicked": true, "count": count }))
    }
    "drag" => {
      let button = mouse_button(params.get("button").and_then(Value::as_str))?;
      server.move_pointer(number(params, "x")?, number(params, "y")?);
      server.press_button(button);
      std::thread::sleep(BUTTON_HOLD);
      server.move_pointer(number(params, "toX")?, number(params, "toY")?);
      std::thread::sleep(BUTTON_HOLD);
      server.release_button(button);
      Ok(json!({ "dragged": true }))
    }
    "scroll" => {
      let vertical = number(params, "dy")? as i64;
      let horizontal = integer(params, "dx").unwrap_or(0) as i64;
      server.move_pointer(number(params, "x")?, number(params, "y")?);
      scroll_axis(&server, vertical, 4, 5)?;
      scroll_axis(&server, horizontal, 6, 7)?;
      Ok(json!({ "scrolled": true }))
    }
    "key" => {
      let keys = params
        .get("keys")
        .and_then(Value::as_str)
        .ok_or_else(|| "`keys` must be a key combination string.".to_string())?;
      server.press_keys(keys)?;
      Ok(json!({ "pressed": keys }))
    }
    "type" => {
      let text = params
        .get("text")
        .and_then(Value::as_str)
        .ok_or_else(|| "`text` must be a string.".to_string())?;
      server.type_text(text)?;
      Ok(json!({ "typed": text.chars().count() }))
    }
    other => Err(format!("Unknown input action: {other}")),
  }
}

fn scroll_axis(server: &XServer, amount: i64, up: u32, down: u32) -> Result<(), String> {
  if amount == 0 {
    return Ok(());
  }
  let (button, count) = if amount < 0 {
    (up, (-amount) as usize)
  } else {
    (down, amount as usize)
  };
  for _ in 0..count.min(100) {
    unsafe {
      (server.xtest.XTestFakeButtonEvent)(server.display, button, 1, 0);
      (server.xtest.XTestFakeButtonEvent)(server.display, button, 0, 0);
    }
    server.flush();
    std::thread::sleep(Duration::from_millis(12));
  }
  Ok(())
}

fn shifted(name: &str) -> bool {
  name.chars().count() == 1 && name.chars().next().is_some_and(|c| c.is_ascii_uppercase())
}

fn character_key(character: char) -> Option<(String, bool)> {
  Some(match character {
    'a'..='z' | '0'..='9' => (character.to_string(), false),
    'A'..='Z' => (character.to_ascii_lowercase().to_string(), true),
    ' ' => ("space".into(), false),
    '!' => ("1".into(), true),
    '@' => ("2".into(), true),
    '#' => ("3".into(), true),
    '$' => ("4".into(), true),
    '%' => ("5".into(), true),
    '^' => ("6".into(), true),
    '&' => ("7".into(), true),
    '*' => ("8".into(), true),
    '(' => ("9".into(), true),
    ')' => ("0".into(), true),
    '-' => ("minus".into(), false),
    '_' => ("minus".into(), true),
    '=' => ("equal".into(), false),
    '+' => ("equal".into(), true),
    '[' => ("bracketleft".into(), false),
    '{' => ("bracketleft".into(), true),
    ']' => ("bracketright".into(), false),
    '}' => ("bracketright".into(), true),
    '\\' => ("backslash".into(), false),
    '|' => ("backslash".into(), true),
    ';' => ("semicolon".into(), false),
    ':' => ("semicolon".into(), true),
    '\'' => ("apostrophe".into(), false),
    '"' => ("apostrophe".into(), true),
    ',' => ("comma".into(), false),
    '<' => ("comma".into(), true),
    '.' => ("period".into(), false),
    '>' => ("period".into(), true),
    '/' => ("slash".into(), false),
    '?' => ("slash".into(), true),
    '`' => ("grave".into(), false),
    '~' => ("grave".into(), true),
    _ => return None,
  })
}

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
pub async fn window_list(app: AppHandle) -> Result<Value, String> {
  let (sender, receiver) = mpsc::channel();
  app
    .run_on_main_thread(move || {
      let windows = gtk::Window::list_toplevels()
        .into_iter()
        .filter_map(|widget| widget.downcast::<gtk::Window>().ok())
        .map(|window| window_info(&window))
        .collect::<Vec<_>>();
      let _ = sender.send(serde_json::to_value(windows).unwrap_or(Value::Null));
    })
    .map_err(|error| format!("Could not enumerate windows: {error}"))?;
  receiver
    .recv_timeout(Duration::from_secs(3))
    .map_err(|_| "Window enumeration timed out.".to_string())
}

fn window_info(window: &gtk::Window) -> WindowInfo {
  let (width, height) = window.size();
  let (x, y) = window.position();
  WindowInfo {
    id: format!("{:x}", window.as_ptr() as usize),
    title: window
      .title()
      .map(|value| value.to_string())
      .unwrap_or_default(),
    role: format!("{:?}", gtk::prelude::GtkWindowExt::type_(window)),
    visible: window.is_visible(),
    active: window.has_toplevel_focus(),
    width,
    height,
    x,
    y,
  }
}

fn find_window(id: &str) -> Result<gtk::Window, String> {
  gtk::Window::list_toplevels()
    .into_iter()
    .filter_map(|widget| widget.downcast::<gtk::Window>().ok())
    .find(|window| format!("{:x}", window.as_ptr() as usize) == id)
    .ok_or_else(|| format!("Window is no longer available: {id}"))
}

#[tauri::command]
pub async fn window_focus(app: AppHandle, id: String) -> Result<(), String> {
  let (sender, receiver) = mpsc::channel();
  let app_handle = app.clone();
  app
    .run_on_main_thread(move || {
      let result = find_window(&id).map(|window| {
        window.present();
        window.grab_focus();
        if window.title().as_deref() == Some("Papyri") {
          if let Some(main) = app_handle.get_webview_window("main") {
            let _ = main.unminimize();
            let _ = main.show();
            let _ = main.set_focus();
          }
        }
      });
      let _ = sender.send(result);
    })
    .map_err(|error| format!("Could not focus the window: {error}"))?;
  receiver
    .recv_timeout(Duration::from_secs(3))
    .map_err(|_| "Window focus timed out.".to_string())?
}

#[tauri::command]
pub async fn window_capture(
  app: AppHandle,
  id: String,
  output: Option<String>,
  clipboard: bool,
) -> Result<Value, String> {
  let (sender, receiver) = mpsc::channel();
  app
    .run_on_main_thread(move || {
      let result = (|| {
        let window = find_window(&id)?;
        let drawable = window
          .window()
          .ok_or_else(|| "The window has no drawable surface.".to_string())?;
        let (width, height) = window.size();
        let pixbuf = drawable
          .pixbuf(0, 0, width, height)
          .ok_or_else(|| "Could not capture the window surface.".to_string())?;
        pixbuf
          .save_to_bufferv("png", &[])
          .map_err(|error| error.to_string())
      })();
      let _ = sender.send(result);
    })
    .map_err(|error| format!("Could not capture the window: {error}"))?;
  let bytes = receiver
    .recv_timeout(Duration::from_secs(10))
    .map_err(|_| "Window capture timed out.".to_string())??;
  crate::screenshot::store_png(bytes, output, clipboard, "window")
}

fn number(params: &Value, key: &str) -> Result<i32, String> {
  params
    .get(key)
    .and_then(Value::as_f64)
    .filter(|value| value.is_finite())
    .map(|value| value.round() as i32)
    .ok_or_else(|| format!("`{key}` must be a finite number."))
}

fn integer(params: &Value, key: &str) -> Option<i64> {
  params.get(key).and_then(Value::as_i64)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn maps_printable_characters_to_keys() {
    assert_eq!(character_key('a'), Some(("a".into(), false)));
    assert_eq!(character_key('A'), Some(("a".into(), true)));
    assert_eq!(character_key('!'), Some(("1".into(), true)));
    assert_eq!(character_key('?'), Some(("slash".into(), true)));
    assert_eq!(character_key('世'), None);
  }
}

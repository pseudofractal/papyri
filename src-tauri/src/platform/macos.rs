//! macOS-specific platform helpers.
//!
//! Input injection uses CoreGraphics events. macOS requires the user to grant
//! Papyri Accessibility permission before synthetic events are delivered.

use core_graphics::event::{
  CGEvent, CGEventFlags, CGEventTapLocation, CGEventType, CGMouseButton, EventField, KeyCode,
  ScrollEventUnit,
};
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
use core_graphics::geometry::CGPoint;
use serde_json::{json, Value};
use std::time::Duration;

const BUTTON_HOLD: Duration = Duration::from_millis(30);
const KEY_HOLD: Duration = Duration::from_millis(5);
const KEY_GAP: Duration = Duration::from_millis(9);

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
  fn AXIsProcessTrusted() -> u8;
}

fn source() -> Result<CGEventSource, String> {
  CGEventSource::new(CGEventSourceStateID::HIDSystemState)
    .map_err(|_| "macOS could not create an event source.".to_string())
}

fn trusted() -> bool {
  unsafe { AXIsProcessTrusted() != 0 }
}

fn require_accessibility() -> Result<(), String> {
  if trusted() {
    Ok(())
  } else {
    Err(
      "macOS requires Accessibility permission for input injection. Open System Settings > Privacy & Security > Accessibility and enable Papyri."
        .into(),
    )
  }
}

fn number(params: &Value, key: &str) -> Result<f64, String> {
  params
    .get(key)
    .and_then(Value::as_f64)
    .filter(|value| value.is_finite())
    .ok_or_else(|| format!("`{key}` must be a finite number."))
}

fn integer(params: &Value, key: &str) -> Option<i64> {
  params.get(key).and_then(Value::as_i64)
}

fn mouse_button(value: Option<&str>) -> Result<(CGMouseButton, CGEventType, CGEventType), String> {
  match value.unwrap_or("left") {
    "left" => Ok((
      CGMouseButton::Left,
      CGEventType::LeftMouseDown,
      CGEventType::LeftMouseUp,
    )),
    "right" => Ok((
      CGMouseButton::Right,
      CGEventType::RightMouseDown,
      CGEventType::RightMouseUp,
    )),
    "middle" => Ok((
      CGMouseButton::Center,
      CGEventType::OtherMouseDown,
      CGEventType::OtherMouseUp,
    )),
    other => Err(format!("Unknown mouse button: {other}")),
  }
}

fn post_mouse(
  source: &CGEventSource,
  event_type: CGEventType,
  x: f64,
  y: f64,
  button: CGMouseButton,
) -> Result<(), String> {
  let event = CGEvent::new_mouse_event(source.clone(), event_type, CGPoint::new(x, y), button)
    .map_err(|_| "macOS could not create a mouse event.".to_string())?;
  event.post(CGEventTapLocation::HID);
  Ok(())
}

fn move_pointer(source: &CGEventSource, x: f64, y: f64) -> Result<(), String> {
  post_mouse(source, CGEventType::MouseMoved, x, y, CGMouseButton::Left)
}

fn click(source: &CGEventSource, x: f64, y: f64, button: &str, count: i64) -> Result<(), String> {
  let (mouse, down, up) = mouse_button(Some(button))?;
  move_pointer(source, x, y)?;
  for index in 0..count.clamp(1, 3) {
    let down_event = CGEvent::new_mouse_event(source.clone(), down, CGPoint::new(x, y), mouse)
      .map_err(|_| "macOS could not create a mouse event.".to_string())?;
    down_event.set_integer_value_field(EventField::MOUSE_EVENT_CLICK_STATE, index + 1);
    down_event.post(CGEventTapLocation::HID);
    std::thread::sleep(BUTTON_HOLD);
    post_mouse(source, up, x, y, mouse)?;
    if index + 1 < count {
      std::thread::sleep(Duration::from_millis(80));
    }
  }
  Ok(())
}

fn drag(
  source: &CGEventSource,
  x: f64,
  y: f64,
  to_x: f64,
  to_y: f64,
  button: &str,
) -> Result<(), String> {
  let (mouse, down, up) = mouse_button(Some(button))?;
  let dragged = match mouse {
    CGMouseButton::Left => CGEventType::LeftMouseDragged,
    CGMouseButton::Right => CGEventType::RightMouseDragged,
    CGMouseButton::Center => CGEventType::OtherMouseDragged,
  };
  move_pointer(source, x, y)?;
  post_mouse(source, down, x, y, mouse)?;
  std::thread::sleep(BUTTON_HOLD);
  post_mouse(source, dragged, to_x, to_y, mouse)?;
  std::thread::sleep(BUTTON_HOLD);
  post_mouse(source, up, to_x, to_y, mouse)?;
  Ok(())
}

fn scroll(source: &CGEventSource, x: f64, y: f64, dy: i64, dx: i64) -> Result<(), String> {
  move_pointer(source, x, y)?;
  let vertical =
    CGEvent::new_scroll_event(source.clone(), ScrollEventUnit::LINE, 1, -dy as i32, 0, 0)
      .map_err(|_| "macOS could not create a scroll event.".to_string())?;
  vertical.post(CGEventTapLocation::HID);
  if dx != 0 {
    let horizontal =
      CGEvent::new_scroll_event(source.clone(), ScrollEventUnit::LINE, 2, 0, -dx as i32, 0)
        .map_err(|_| "macOS could not create a scroll event.".to_string())?;
    horizontal.post(CGEventTapLocation::HID);
  }
  Ok(())
}

fn character_key(character: char) -> Option<(u16, bool)> {
  let shifted = character.is_ascii_uppercase();
  let lower = character.to_ascii_lowercase();
  let code = match lower {
    'a' => KeyCode::ANSI_A,
    'b' => KeyCode::ANSI_B,
    'c' => KeyCode::ANSI_C,
    'd' => KeyCode::ANSI_D,
    'e' => KeyCode::ANSI_E,
    'f' => KeyCode::ANSI_F,
    'g' => KeyCode::ANSI_G,
    'h' => KeyCode::ANSI_H,
    'i' => KeyCode::ANSI_I,
    'j' => KeyCode::ANSI_J,
    'k' => KeyCode::ANSI_K,
    'l' => KeyCode::ANSI_L,
    'm' => KeyCode::ANSI_M,
    'n' => KeyCode::ANSI_N,
    'o' => KeyCode::ANSI_O,
    'p' => KeyCode::ANSI_P,
    'q' => KeyCode::ANSI_Q,
    'r' => KeyCode::ANSI_R,
    's' => KeyCode::ANSI_S,
    't' => KeyCode::ANSI_T,
    'u' => KeyCode::ANSI_U,
    'v' => KeyCode::ANSI_V,
    'w' => KeyCode::ANSI_W,
    'x' => KeyCode::ANSI_X,
    'y' => KeyCode::ANSI_Y,
    'z' => KeyCode::ANSI_Z,
    '0' => KeyCode::ANSI_0,
    '1' => KeyCode::ANSI_1,
    '2' => KeyCode::ANSI_2,
    '3' => KeyCode::ANSI_3,
    '4' => KeyCode::ANSI_4,
    '5' => KeyCode::ANSI_5,
    '6' => KeyCode::ANSI_6,
    '7' => KeyCode::ANSI_7,
    '8' => KeyCode::ANSI_8,
    '9' => KeyCode::ANSI_9,
    ' ' => KeyCode::SPACE,
    '-' => KeyCode::ANSI_MINUS,
    '=' => KeyCode::ANSI_EQUAL,
    '[' => KeyCode::ANSI_LEFT_BRACKET,
    ']' => KeyCode::ANSI_RIGHT_BRACKET,
    '\\' => KeyCode::ANSI_BACKSLASH,
    ';' => KeyCode::ANSI_SEMICOLON,
    '\'' => KeyCode::ANSI_QUOTE,
    ',' => KeyCode::ANSI_COMMA,
    '.' => KeyCode::ANSI_PERIOD,
    '/' => KeyCode::ANSI_SLASH,
    '`' => KeyCode::ANSI_GRAVE,
    '!' => KeyCode::ANSI_1,
    '@' => KeyCode::ANSI_2,
    '#' => KeyCode::ANSI_3,
    '$' => KeyCode::ANSI_4,
    '%' => KeyCode::ANSI_5,
    '^' => KeyCode::ANSI_6,
    '&' => KeyCode::ANSI_7,
    '*' => KeyCode::ANSI_8,
    '(' => KeyCode::ANSI_9,
    ')' => KeyCode::ANSI_0,
    '_' => KeyCode::ANSI_MINUS,
    '+' => KeyCode::ANSI_EQUAL,
    '{' => KeyCode::ANSI_LEFT_BRACKET,
    '}' => KeyCode::ANSI_RIGHT_BRACKET,
    '|' => KeyCode::ANSI_BACKSLASH,
    ':' => KeyCode::ANSI_SEMICOLON,
    '"' => KeyCode::ANSI_QUOTE,
    '<' => KeyCode::ANSI_COMMA,
    '>' => KeyCode::ANSI_PERIOD,
    '?' => KeyCode::ANSI_SLASH,
    '~' => KeyCode::ANSI_GRAVE,
    _ => return None,
  };
  let requires_shift = shifted
    || matches!(
      character,
      '!'
        | '@'
        | '#'
        | '$'
        | '%'
        | '^'
        | '&'
        | '*'
        | '('
        | ')'
        | '_'
        | '+'
        | '{'
        | '}'
        | '|'
        | ':'
        | '"'
        | '<'
        | '>'
        | '?'
        | '~'
    );
  Some((code, requires_shift))
}

fn named_key(name: &str) -> Option<(u16, bool)> {
  let lower = name.to_ascii_lowercase();
  let code = match lower.as_str() {
    "enter" | "return" => KeyCode::RETURN,
    "tab" => KeyCode::TAB,
    "escape" | "esc" => KeyCode::ESCAPE,
    "space" => KeyCode::SPACE,
    "backspace" => KeyCode::DELETE,
    "delete" | "del" => KeyCode::FORWARD_DELETE,
    "home" => KeyCode::HOME,
    "end" => KeyCode::END,
    "pageup" => KeyCode::PAGE_UP,
    "pagedown" => KeyCode::PAGE_DOWN,
    "left" => KeyCode::LEFT_ARROW,
    "right" => KeyCode::RIGHT_ARROW,
    "up" => KeyCode::UP_ARROW,
    "down" => KeyCode::DOWN_ARROW,
    "f1" => KeyCode::F1,
    "f2" => KeyCode::F2,
    "f3" => KeyCode::F3,
    "f4" => KeyCode::F4,
    "f5" => KeyCode::F5,
    "f6" => KeyCode::F6,
    "f7" => KeyCode::F7,
    "f8" => KeyCode::F8,
    "f9" => KeyCode::F9,
    "f10" => KeyCode::F10,
    "f11" => KeyCode::F11,
    "f12" => KeyCode::F12,
    "ctrl" | "control" => KeyCode::CONTROL,
    "shift" => KeyCode::SHIFT,
    "alt" | "option" => KeyCode::OPTION,
    "super" | "meta" | "win" | "cmd" | "command" => KeyCode::COMMAND,
    _ => {
      let mut characters = lower.chars();
      let character = characters.next()?;
      if characters.next().is_some() {
        return None;
      }
      return character_key(character);
    }
  };
  Some((code, false))
}

fn key_flags(name: &str) -> CGEventFlags {
  let bits = match name {
    "control" | "ctrl" => 0x0004_0000,
    "shift" => 0x0002_0000,
    "alt" | "option" => 0x0008_0000,
    "super" | "meta" | "win" | "cmd" | "command" => 0x0010_0000,
    _ => 0,
  };
  CGEventFlags::from_bits_truncate(bits)
}

fn press_keys(source: &CGEventSource, keys: &str) -> Result<(), String> {
  let parts: Vec<String> = keys
    .split('+')
    .map(str::trim)
    .filter(|part| !part.is_empty())
    .map(|part| part.to_ascii_lowercase())
    .collect();
  if parts.is_empty() {
    return Err("The key combination is empty.".into());
  }
  let mut modifiers = Vec::new();
  let mut key = None;
  for (index, part) in parts.iter().enumerate() {
    let (code, shifted) = named_key(part).ok_or_else(|| format!("Unknown key: {part}"))?;
    if index + 1 == parts.len() {
      key = Some((code, shifted));
    } else {
      modifiers.push((code, key_flags(part)));
    }
  }
  let (key_code, shifted) = key.ok_or_else(|| "The key combination needs a key.".to_string())?;
  let mut flags = CGEventFlags::from_bits_truncate(0);
  for (code, flag) in &modifiers {
    flags |= *flag;
    if let Ok(event) = CGEvent::new_keyboard_event(source.clone(), *code, true) {
      event.set_flags(flags);
      event.post(CGEventTapLocation::HID);
    }
    std::thread::sleep(KEY_HOLD);
  }
  if shifted {
    flags |= CGEventFlags::from_bits_truncate(0x0002_0000);
    if let Ok(event) = CGEvent::new_keyboard_event(source.clone(), KeyCode::SHIFT, true) {
      event.post(CGEventTapLocation::HID);
    }
  }
  let down = CGEvent::new_keyboard_event(source.clone(), key_code, true)
    .map_err(|_| "macOS could not create a key event.".to_string())?;
  down.set_flags(flags);
  down.post(CGEventTapLocation::HID);
  std::thread::sleep(KEY_HOLD);
  let up = CGEvent::new_keyboard_event(source.clone(), key_code, false)
    .map_err(|_| "macOS could not create a key event.".to_string())?;
  up.set_flags(flags);
  up.post(CGEventTapLocation::HID);
  if shifted {
    if let Ok(event) = CGEvent::new_keyboard_event(source.clone(), KeyCode::SHIFT, false) {
      event.post(CGEventTapLocation::HID);
    }
  }
  for (code, _) in modifiers.iter().rev() {
    if let Ok(event) = CGEvent::new_keyboard_event(source.clone(), *code, false) {
      event.post(CGEventTapLocation::HID);
    }
    std::thread::sleep(KEY_HOLD);
  }
  std::thread::sleep(KEY_GAP);
  Ok(())
}

fn type_text(source: &CGEventSource, text: &str) -> Result<(), String> {
  for character in text.chars() {
    match character {
      '\n' => press_keys(source, "Return")?,
      '\t' => press_keys(source, "Tab")?,
      '\r' => {}
      '\u{0}' => {}
      other => {
        let mut units = [0u16; 2];
        for unit in other.encode_utf16(&mut units) {
          let down = CGEvent::new_keyboard_event(source.clone(), 0, true)
            .map_err(|_| "macOS could not create a text event.".to_string())?;
          down.set_string_from_utf16_unchecked(&[*unit]);
          down.post(CGEventTapLocation::HID);
          let up = CGEvent::new_keyboard_event(source.clone(), 0, false)
            .map_err(|_| "macOS could not create a text event.".to_string())?;
          up.set_string_from_utf16_unchecked(&[*unit]);
          up.post(CGEventTapLocation::HID);
        }
      }
    }
    std::thread::sleep(KEY_GAP);
  }
  Ok(())
}

pub fn inject(action: &str, params: &Value) -> Result<Value, String> {
  require_accessibility()?;
  let source = source()?;
  match action {
    "move" => {
      move_pointer(&source, number(params, "x")?, number(params, "y")?)?;
      Ok(json!({ "moved": true }))
    }
    "click" => {
      let button = params
        .get("button")
        .and_then(Value::as_str)
        .unwrap_or("left");
      let count = integer(params, "count").unwrap_or(1).clamp(1, 3);
      click(
        &source,
        number(params, "x")?,
        number(params, "y")?,
        button,
        count,
      )?;
      Ok(json!({ "clicked": true, "count": count }))
    }
    "drag" => {
      let button = params
        .get("button")
        .and_then(Value::as_str)
        .unwrap_or("left");
      drag(
        &source,
        number(params, "x")?,
        number(params, "y")?,
        number(params, "toX")?,
        number(params, "toY")?,
        button,
      )?;
      Ok(json!({ "dragged": true }))
    }
    "scroll" => {
      let dy = integer(params, "dy").unwrap_or(0);
      let dx = integer(params, "dx").unwrap_or(0);
      scroll(&source, number(params, "x")?, number(params, "y")?, dy, dx)?;
      Ok(json!({ "scrolled": true }))
    }
    "key" => {
      let keys = params
        .get("keys")
        .and_then(Value::as_str)
        .ok_or_else(|| "`keys` must be a key combination string.".to_string())?;
      press_keys(&source, keys)?;
      Ok(json!({ "pressed": keys }))
    }
    "type" => {
      let text = params
        .get("text")
        .and_then(Value::as_str)
        .ok_or_else(|| "`text` must be a string.".to_string())?;
      type_text(&source, text)?;
      Ok(json!({ "typed": text.chars().count() }))
    }
    other => Err(format!("Unknown input action: {other}")),
  }
}

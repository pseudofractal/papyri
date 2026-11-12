//! Windows-specific platform helpers.
//!
//! Input injection uses `SendInput`. Windows blocks synthetic input targeted at
//! higher-integrity windows; normal user-level windows work without elevation.

use serde_json::{json, Value};
use std::{mem::size_of, time::Duration};
use windows_sys::Win32::UI::{
  Input::KeyboardAndMouse::{
    SendInput, VkKeyScanW, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT,
    KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE, MOUSEEVENTF_HWHEEL,
    MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP,
    MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP, MOUSEEVENTF_WHEEL, MOUSEINPUT, MOUSE_EVENT_FLAGS,
    VIRTUAL_KEY, VK_BACK, VK_CONTROL, VK_DELETE, VK_DOWN, VK_END, VK_ESCAPE, VK_F1, VK_F10, VK_F11,
    VK_F12, VK_F2, VK_F3, VK_F4, VK_F5, VK_F6, VK_F7, VK_F8, VK_F9, VK_HOME, VK_LEFT, VK_LWIN,
    VK_MENU, VK_NEXT, VK_PRIOR, VK_RETURN, VK_RIGHT, VK_SHIFT, VK_SPACE, VK_TAB, VK_UP,
  },
  WindowsAndMessaging::SetCursorPos,
};

const BUTTON_HOLD: Duration = Duration::from_millis(30);
const KEY_HOLD: Duration = Duration::from_millis(5);
const KEY_GAP: Duration = Duration::from_millis(9);

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

fn send_mouse(flags: MOUSE_EVENT_FLAGS, data: u32) -> Result<(), String> {
  let input = INPUT {
    r#type: INPUT_MOUSE,
    Anonymous: INPUT_0 {
      mi: MOUSEINPUT {
        dx: 0,
        dy: 0,
        mouseData: data,
        dwFlags: flags,
        time: 0,
        dwExtraInfo: 0,
      },
    },
  };
  let sent = unsafe { SendInput(1, &input, size_of::<INPUT>() as i32) };
  if sent == 1 {
    Ok(())
  } else {
    Err("Windows rejected the mouse input.".into())
  }
}

fn send_key(vk: VIRTUAL_KEY, flags: KEYBD_EVENT_FLAGS) -> Result<(), String> {
  let input = INPUT {
    r#type: INPUT_KEYBOARD,
    Anonymous: INPUT_0 {
      ki: KEYBDINPUT {
        wVk: vk,
        wScan: 0,
        dwFlags: flags,
        time: 0,
        dwExtraInfo: 0,
      },
    },
  };
  let sent = unsafe { SendInput(1, &input, size_of::<INPUT>() as i32) };
  if sent == 1 {
    Ok(())
  } else {
    Err("Windows rejected the keyboard input.".into())
  }
}

fn send_unicode(unit: u16, keyup: bool) -> Result<(), String> {
  let input = INPUT {
    r#type: INPUT_KEYBOARD,
    Anonymous: INPUT_0 {
      ki: KEYBDINPUT {
        wVk: 0,
        wScan: unit,
        dwFlags: KEYEVENTF_UNICODE | if keyup { KEYEVENTF_KEYUP } else { 0 },
        time: 0,
        dwExtraInfo: 0,
      },
    },
  };
  let sent = unsafe { SendInput(1, &input, size_of::<INPUT>() as i32) };
  if sent == 1 {
    Ok(())
  } else {
    Err("Windows rejected the text input.".into())
  }
}

fn move_pointer(x: i32, y: i32) -> Result<(), String> {
  if unsafe { SetCursorPos(x, y) } != 0 {
    Ok(())
  } else {
    Err("Windows could not move the pointer.".into())
  }
}

fn click(x: i32, y: i32, button: &str, count: i64) -> Result<(), String> {
  let (down, up) = match button {
    "left" => (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP),
    "right" => (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP),
    "middle" => (MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP),
    other => return Err(format!("Unknown mouse button: {other}")),
  };
  move_pointer(x, y)?;
  for index in 0..count.clamp(1, 3) {
    send_mouse(down, 0)?;
    std::thread::sleep(BUTTON_HOLD);
    send_mouse(up, 0)?;
    if index + 1 < count {
      std::thread::sleep(Duration::from_millis(80));
    }
  }
  Ok(())
}

fn drag(x: i32, y: i32, to_x: i32, to_y: i32, button: &str) -> Result<(), String> {
  let (down, up) = match button {
    "left" => (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP),
    "right" => (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP),
    "middle" => (MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP),
    other => return Err(format!("Unknown mouse button: {other}")),
  };
  move_pointer(x, y)?;
  send_mouse(down, 0)?;
  std::thread::sleep(BUTTON_HOLD);
  move_pointer(to_x, to_y)?;
  std::thread::sleep(BUTTON_HOLD);
  send_mouse(up, 0)?;
  Ok(())
}

fn scroll(x: i32, y: i32, dy: i64, dx: i64) -> Result<(), String> {
  move_pointer(x, y)?;
  if dy != 0 {
    send_mouse(
      MOUSEEVENTF_WHEEL,
      (-dy.clamp(-100, 100) * 120) as i32 as u32,
    )?;
  }
  if dx != 0 {
    send_mouse(
      MOUSEEVENTF_HWHEEL,
      (dx.clamp(-100, 100) * 120) as i32 as u32,
    )?;
  }
  Ok(())
}

fn named_key(name: &str) -> Option<(VIRTUAL_KEY, bool)> {
  let lower = name.to_ascii_lowercase();
  let value = match lower.as_str() {
    "enter" | "return" => VK_RETURN,
    "tab" => VK_TAB,
    "escape" | "esc" => VK_ESCAPE,
    "space" => VK_SPACE,
    "backspace" => VK_BACK,
    "delete" | "del" => VK_DELETE,
    "home" => VK_HOME,
    "end" => VK_END,
    "pageup" => VK_PRIOR,
    "pagedown" => VK_NEXT,
    "left" => VK_LEFT,
    "right" => VK_RIGHT,
    "up" => VK_UP,
    "down" => VK_DOWN,
    "f1" => VK_F1,
    "f2" => VK_F2,
    "f3" => VK_F3,
    "f4" => VK_F4,
    "f5" => VK_F5,
    "f6" => VK_F6,
    "f7" => VK_F7,
    "f8" => VK_F8,
    "f9" => VK_F9,
    "f10" => VK_F10,
    "f11" => VK_F11,
    "f12" => VK_F12,
    "ctrl" | "control" => VK_CONTROL,
    "shift" => VK_SHIFT,
    "alt" | "option" => VK_MENU,
    "super" | "meta" | "win" | "cmd" | "command" => VK_LWIN,
    _ => {
      let mut characters = name.chars();
      let character = characters.next()?;
      if characters.next().is_some() {
        return None;
      }
      let scan = unsafe { VkKeyScanW(character as u16) };
      if scan == -1 {
        return None;
      }
      return Some(((scan as u16) & 0xff, (scan as u16 & 0x100) != 0));
    }
  };
  Some((value, false))
}

fn modifier_key(name: &str) -> Option<VIRTUAL_KEY> {
  match name {
    "ctrl" | "control" => Some(VK_CONTROL),
    "shift" => Some(VK_SHIFT),
    "alt" | "option" => Some(VK_MENU),
    "super" | "meta" | "win" | "cmd" | "command" => Some(VK_LWIN),
    _ => None,
  }
}

fn press_keys(keys: &str) -> Result<(), String> {
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
      modifiers.push(modifier_key(part).unwrap_or(code));
    }
  }
  let (key_code, shifted) = key.ok_or_else(|| "The key combination needs a key.".to_string())?;
  for modifier in &modifiers {
    send_key(*modifier, 0)?;
    std::thread::sleep(KEY_HOLD);
  }
  if shifted {
    send_key(VK_SHIFT, 0)?;
  }
  send_key(key_code, 0)?;
  std::thread::sleep(KEY_HOLD);
  send_key(key_code, KEYEVENTF_KEYUP)?;
  if shifted {
    send_key(VK_SHIFT, KEYEVENTF_KEYUP)?;
  }
  for modifier in modifiers.iter().rev() {
    send_key(*modifier, KEYEVENTF_KEYUP)?;
    std::thread::sleep(KEY_HOLD);
  }
  std::thread::sleep(KEY_GAP);
  Ok(())
}

fn type_text(text: &str) -> Result<(), String> {
  for character in text.chars() {
    match character {
      '\n' => press_keys("Return")?,
      '\t' => press_keys("Tab")?,
      '\r' => {}
      other => {
        let mut units = [0u16; 2];
        for unit in other.encode_utf16(&mut units) {
          send_unicode(*unit, false)?;
          send_unicode(*unit, true)?;
        }
      }
    }
    std::thread::sleep(KEY_GAP);
  }
  Ok(())
}

pub fn inject(action: &str, params: &Value) -> Result<Value, String> {
  match action {
    "move" => {
      move_pointer(number(params, "x")?, number(params, "y")?)?;
      Ok(json!({ "moved": true }))
    }
    "click" => {
      let button = params
        .get("button")
        .and_then(Value::as_str)
        .unwrap_or("left");
      let count = integer(params, "count").unwrap_or(1).clamp(1, 3);
      click(number(params, "x")?, number(params, "y")?, button, count)?;
      Ok(json!({ "clicked": true, "count": count }))
    }
    "drag" => {
      let button = params
        .get("button")
        .and_then(Value::as_str)
        .unwrap_or("left");
      drag(
        number(params, "x")?,
        number(params, "y")?,
        number(params, "toX")?,
        number(params, "toY")?,
        button,
      )?;
      Ok(json!({ "dragged": true }))
    }
    "scroll" => {
      scroll(
        number(params, "x")?,
        number(params, "y")?,
        integer(params, "dy").unwrap_or(0),
        integer(params, "dx").unwrap_or(0),
      )?;
      Ok(json!({ "scrolled": true }))
    }
    "key" => {
      let keys = params
        .get("keys")
        .and_then(Value::as_str)
        .ok_or_else(|| "`keys` must be a key combination string.".to_string())?;
      press_keys(keys)?;
      Ok(json!({ "pressed": keys }))
    }
    "type" => {
      let text = params
        .get("text")
        .and_then(Value::as_str)
        .ok_or_else(|| "`text` must be a string.".to_string())?;
      type_text(text)?;
      Ok(json!({ "typed": text.chars().count() }))
    }
    other => Err(format!("Unknown input action: {other}")),
  }
}

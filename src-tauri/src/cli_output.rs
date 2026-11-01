//! Human-readable and JSON formatting for control responses.

use crate::control::PROTOCOL_VERSION;
use serde_json::Value;
use std::{
  fmt::Write as _,
  io::{self, Write as _},
};

pub(crate) fn print_result(method: &str, value: Value, json_output: bool) {
  let mut output = String::new();
  if json_output {
    let _ = writeln!(
      output,
      "{}",
      serde_json::to_string(&value).unwrap_or_default()
    );
  } else {
    match method {
      "state" => print_state(&mut output, &value),
      "open" | "focus" | "close" | "tab.next" | "tab.previous" | "tab.activate" | "tab.close"
      | "heading" | "page" | "command" => print_active(&mut output, &value),
      "ping" => print_ping(&mut output, &value),
      "headings" => print_headings(&mut output, &value),
      "commands" => print_commands(&mut output, &value),
      "scroll.to" | "scroll.by" | "scroll.top" | "scroll.bottom" => {
        print_scroll(&mut output, &value)
      }
      "theme" => print_theme(&mut output, &value),
      "zoom" => print_zoom(&mut output, &value),
      "fit-width" | "panel" => print_view(&mut output, &value),
      "search" => print_search(&mut output, &value),
      "refresh" => {
        let _ = writeln!(output, "Refreshed");
      }
      "raise" => {
        let _ = writeln!(output, "Focused Papyri");
      }
      "quit" => {
        let _ = writeln!(output, "Quitting Papyri");
      }
      "preferences" => {
        let _ = writeln!(
          output,
          "{}",
          serde_json::to_string_pretty(&value).unwrap_or_default()
        );
      }
      _ => {
        if !value.is_null() {
          let _ = writeln!(
            output,
            "{}",
            serde_json::to_string_pretty(&value).unwrap_or_default()
          );
        }
      }
    }
  }
  write_output(&output);
}

/// Write one response. A closed consumer is a normal end of output, not a panic.
fn write_output(output: &str) {
  if output.is_empty() {
    return;
  }
  let mut stdout = io::stdout().lock();
  match stdout
    .write_all(output.as_bytes())
    .and_then(|()| stdout.flush())
  {
    Ok(()) => {}
    Err(error) if error.kind() == io::ErrorKind::BrokenPipe => {}
    Err(error) => {
      let _ = writeln!(io::stderr(), "error: could not write output: {error}");
      std::process::exit(1);
    }
  }
}

fn print_active(output: &mut String, value: &Value) {
  let active = value.get("active").and_then(Value::as_str).unwrap_or("");
  let _ = writeln!(
    output,
    "Active: {}",
    if active.is_empty() { "(none)" } else { active }
  );
  if let Some(secondary) = value.get("secondary").and_then(Value::as_str) {
    if !secondary.is_empty() {
      let _ = writeln!(output, "Secondary: {secondary}");
    }
  }
}

fn print_theme(output: &mut String, value: &Value) {
  let theme = value
    .get("preferences")
    .and_then(|preferences| preferences.get("theme"))
    .and_then(Value::as_str)
    .unwrap_or("?");
  let _ = writeln!(output, "Theme: {theme}");
}

fn print_zoom(output: &mut String, value: &Value) {
  let Some(preferences) = value.get("preferences") else {
    return;
  };
  let number = |key: &str| {
    preferences
      .get(key)
      .and_then(Value::as_f64)
      .unwrap_or(100.0)
  };
  let _ = writeln!(
    output,
    "Zoom: document {:.0}% · PDF {:.0}% · UI {:.0}%",
    number("documentZoom"),
    number("pdfZoom"),
    number("uiZoom")
  );
}

fn print_view(output: &mut String, value: &Value) {
  let Some(view) = value.get("view").and_then(Value::as_object) else {
    return;
  };
  print_view_flags(output, view);
}

fn print_view_flags(output: &mut String, view: &serde_json::Map<String, Value>) {
  let flag = |name: &str| {
    if view.get(name).and_then(Value::as_bool) == Some(true) {
      "on"
    } else {
      "off"
    }
  };
  let _ = writeln!(
    output,
    "View: sidebar={} outline={} split={} palette={} search={} settings={}",
    flag("sidebar"),
    flag("outline"),
    flag("split"),
    flag("palette"),
    flag("search"),
    flag("settings")
  );
}

fn print_search(output: &mut String, value: &Value) {
  let query = value
    .get("view")
    .and_then(|view| view.get("query"))
    .and_then(Value::as_str)
    .unwrap_or("");
  if query.is_empty() {
    let _ = writeln!(output, "Search cleared");
  } else {
    let _ = writeln!(output, "Search: {query}");
  }
}

fn print_ping(output: &mut String, value: &Value) {
  let version = value.get("version").and_then(Value::as_str).unwrap_or("?");
  let protocol = value
    .get("protocol")
    .and_then(Value::as_u64)
    .unwrap_or(PROTOCOL_VERSION);
  let pid = value.get("pid").and_then(Value::as_u64).unwrap_or(0);
  let ready = value.get("ready").and_then(Value::as_bool).unwrap_or(false);
  let _ = writeln!(
    output,
    "Papyri {version} · protocol {protocol} · pid {pid} · {}",
    if ready { "ready" } else { "starting" }
  );
  if let Some(socket) = value.get("socket").and_then(Value::as_str) {
    let _ = writeln!(output, "Socket: {socket}");
  }
}

fn print_state(output: &mut String, value: &Value) {
  let active = value.get("active").and_then(Value::as_str).unwrap_or("");
  let _ = writeln!(
    output,
    "Active: {}",
    if active.is_empty() { "(none)" } else { active }
  );
  if let Some(secondary) = value.get("secondary").and_then(Value::as_str) {
    if !secondary.is_empty() {
      let _ = writeln!(output, "Secondary: {secondary}");
    }
  }
  if let Some(tabs) = value.get("tabs").and_then(Value::as_array) {
    let _ = writeln!(output, "Tabs ({}):", tabs.len());
    for tab in tabs {
      let path = tab.get("path").and_then(Value::as_str).unwrap_or("?");
      let kind = tab.get("kind").and_then(Value::as_str).unwrap_or("?");
      let scroll = tab.get("scroll").and_then(Value::as_f64).unwrap_or(0.0);
      let marker = if tab.get("active").and_then(Value::as_bool) == Some(true) {
        "*"
      } else {
        " "
      };
      let _ = writeln!(output, "  {marker} {path} ({kind}, scroll {scroll:.0})");
      if let Some(error) = tab.get("error").and_then(Value::as_str) {
        let _ = writeln!(output, "      error: {error}");
      }
    }
  }
  if let Some(pdf) = value.get("pdf") {
    if let (Some(page), Some(total)) = (
      pdf.get("page").and_then(Value::as_u64),
      pdf.get("total").and_then(Value::as_u64),
    ) {
      let _ = writeln!(output, "PDF page: {page}/{total}");
    }
  }
  if let Some(view) = value.get("view").and_then(Value::as_object) {
    print_view_flags(output, view);
    if let Some(query) = view.get("query").and_then(Value::as_str) {
      if !query.is_empty() {
        let _ = writeln!(output, "Search: {query}");
      }
    }
  }
  if let Some(preferences) = value.get("preferences").and_then(Value::as_object) {
    let theme = preferences
      .get("theme")
      .and_then(Value::as_str)
      .unwrap_or("?");
    let document_zoom = preferences
      .get("documentZoom")
      .and_then(Value::as_f64)
      .unwrap_or(100.0);
    let ui_zoom = preferences
      .get("uiZoom")
      .and_then(Value::as_f64)
      .unwrap_or(100.0);
    let _ = writeln!(
      output,
      "Theme: {theme} · document zoom {document_zoom:.0}% · UI zoom {ui_zoom:.0}%"
    );
  }
  if let Some(error) = value.get("error").and_then(Value::as_str) {
    if !error.is_empty() {
      let _ = writeln!(output, "Error: {error}");
    }
  }
}

fn print_headings(output: &mut String, value: &Value) {
  let path = value.get("path").and_then(Value::as_str).unwrap_or("");
  if !path.is_empty() {
    let _ = writeln!(output, "{path}");
  }
  if let Some(headings) = value.get("headings").and_then(Value::as_array) {
    for heading in headings {
      let level = heading.get("level").and_then(Value::as_u64).unwrap_or(1);
      let text = heading.get("text").and_then(Value::as_str).unwrap_or("");
      let id = heading.get("id").and_then(Value::as_str).unwrap_or("");
      let indent = level.saturating_sub(1) as usize * 2;
      let _ = writeln!(output, "  {:width$} {text}  [{id}]", "", width = indent);
    }
  }
}

fn print_commands(output: &mut String, value: &Value) {
  if let Some(commands) = value.get("commands").and_then(Value::as_array) {
    for command in commands {
      let id = command.get("id").and_then(Value::as_str).unwrap_or("?");
      let label = command.get("label").and_then(Value::as_str).unwrap_or("?");
      let group = command.get("group").and_then(Value::as_str).unwrap_or("");
      if group.is_empty() {
        let _ = writeln!(output, "  {id}: {label}");
      } else {
        let _ = writeln!(output, "  [{group}] {id}: {label}");
      }
    }
  }
}

fn print_scroll(output: &mut String, value: &Value) {
  let pane = value.get("pane").and_then(Value::as_str).unwrap_or("main");
  let y = value.get("y").and_then(Value::as_f64).unwrap_or(0.0);
  let _ = writeln!(output, "Scrolled {pane} to {y:.0}");
}

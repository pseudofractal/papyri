//! Human-readable and JSON formatting for control responses.

use crate::control::PROTOCOL_VERSION;
use serde_json::Value;

pub(crate) fn print_result(method: &str, value: Value, json_output: bool) {
  if json_output {
    println!("{}", serde_json::to_string(&value).unwrap_or_default());
    return;
  }
  match method {
    "state" => print_state(&value),
    "open" | "focus" | "close" | "tab.next" | "tab.previous" | "tab.activate" | "tab.close"
    | "heading" | "page" | "command" => print_active(&value),
    "ping" => print_ping(&value),
    "headings" => print_headings(&value),
    "commands" => print_commands(&value),
    "scroll.to" | "scroll.by" | "scroll.top" | "scroll.bottom" => print_scroll(&value),
    "theme" => print_theme(&value),
    "zoom" => print_zoom(&value),
    "fit-width" | "panel" => print_view(&value),
    "search" => print_search(&value),
    "refresh" => println!("Refreshed"),
    "raise" => println!("Focused Papyri"),
    "quit" => println!("Quitting Papyri"),
    "preferences" => println!(
      "{}",
      serde_json::to_string_pretty(&value).unwrap_or_default()
    ),
    _ => {
      if !value.is_null() {
        println!(
          "{}",
          serde_json::to_string_pretty(&value).unwrap_or_default()
        );
      }
    }
  }
}

fn print_active(value: &Value) {
  let active = value.get("active").and_then(Value::as_str).unwrap_or("");
  println!(
    "Active: {}",
    if active.is_empty() { "(none)" } else { active }
  );
  if let Some(secondary) = value.get("secondary").and_then(Value::as_str) {
    if !secondary.is_empty() {
      println!("Secondary: {secondary}");
    }
  }
}

fn print_theme(value: &Value) {
  let theme = value
    .get("preferences")
    .and_then(|preferences| preferences.get("theme"))
    .and_then(Value::as_str)
    .unwrap_or("?");
  println!("Theme: {theme}");
}

fn print_zoom(value: &Value) {
  let Some(preferences) = value.get("preferences") else {
    return;
  };
  let number = |key: &str| {
    preferences
      .get(key)
      .and_then(Value::as_f64)
      .unwrap_or(100.0)
  };
  println!(
    "Zoom: document {:.0}% · PDF {:.0}% · UI {:.0}%",
    number("documentZoom"),
    number("pdfZoom"),
    number("uiZoom")
  );
}

fn print_view(value: &Value) {
  let Some(view) = value.get("view").and_then(Value::as_object) else {
    return;
  };
  let flag = |name: &str| {
    if view.get(name).and_then(Value::as_bool) == Some(true) {
      "on"
    } else {
      "off"
    }
  };
  println!(
    "View: sidebar={} outline={} split={} palette={} search={} settings={}",
    flag("sidebar"),
    flag("outline"),
    flag("split"),
    flag("palette"),
    flag("search"),
    flag("settings")
  );
}

fn print_search(value: &Value) {
  let query = value
    .get("view")
    .and_then(|view| view.get("query"))
    .and_then(Value::as_str)
    .unwrap_or("");
  if query.is_empty() {
    println!("Search cleared");
  } else {
    println!("Search: {query}");
  }
}

fn print_ping(value: &Value) {
  let version = value.get("version").and_then(Value::as_str).unwrap_or("?");
  let protocol = value
    .get("protocol")
    .and_then(Value::as_u64)
    .unwrap_or(PROTOCOL_VERSION);
  let pid = value.get("pid").and_then(Value::as_u64).unwrap_or(0);
  let ready = value.get("ready").and_then(Value::as_bool).unwrap_or(false);
  println!(
    "Papyri {version} · protocol {protocol} · pid {pid} · {}",
    if ready { "ready" } else { "starting" }
  );
  if let Some(socket) = value.get("socket").and_then(Value::as_str) {
    println!("Socket: {socket}");
  }
}

fn print_state(value: &Value) {
  let active = value.get("active").and_then(Value::as_str).unwrap_or("");
  println!(
    "Active: {}",
    if active.is_empty() { "(none)" } else { active }
  );
  if let Some(secondary) = value.get("secondary").and_then(Value::as_str) {
    if !secondary.is_empty() {
      println!("Secondary: {secondary}");
    }
  }
  if let Some(tabs) = value.get("tabs").and_then(Value::as_array) {
    println!("Tabs ({}):", tabs.len());
    for tab in tabs {
      let path = tab.get("path").and_then(Value::as_str).unwrap_or("?");
      let kind = tab.get("kind").and_then(Value::as_str).unwrap_or("?");
      let scroll = tab.get("scroll").and_then(Value::as_f64).unwrap_or(0.0);
      let marker = if tab.get("active").and_then(Value::as_bool) == Some(true) {
        "*"
      } else {
        " "
      };
      println!("  {marker} {path} ({kind}, scroll {scroll:.0})");
      if let Some(error) = tab.get("error").and_then(Value::as_str) {
        println!("      error: {error}");
      }
    }
  }
  if let Some(pdf) = value.get("pdf") {
    if let (Some(page), Some(total)) = (
      pdf.get("page").and_then(Value::as_u64),
      pdf.get("total").and_then(Value::as_u64),
    ) {
      println!("PDF page: {page}/{total}");
    }
  }
  if let Some(view) = value.get("view").and_then(Value::as_object) {
    let flag = |name: &str| {
      if view.get(name).and_then(Value::as_bool) == Some(true) {
        "on"
      } else {
        "off"
      }
    };
    println!(
      "View: sidebar={} outline={} split={} palette={} search={} settings={}",
      flag("sidebar"),
      flag("outline"),
      flag("split"),
      flag("palette"),
      flag("search"),
      flag("settings")
    );
    if let Some(query) = view.get("query").and_then(Value::as_str) {
      if !query.is_empty() {
        println!("Search: {query}");
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
    println!("Theme: {theme} · document zoom {document_zoom:.0}% · UI zoom {ui_zoom:.0}%");
  }
  if let Some(error) = value.get("error").and_then(Value::as_str) {
    if !error.is_empty() {
      println!("Error: {error}");
    }
  }
}

fn print_headings(value: &Value) {
  let path = value.get("path").and_then(Value::as_str).unwrap_or("");
  if !path.is_empty() {
    println!("{path}");
  }
  if let Some(headings) = value.get("headings").and_then(Value::as_array) {
    for heading in headings {
      let level = heading.get("level").and_then(Value::as_u64).unwrap_or(1);
      let text = heading.get("text").and_then(Value::as_str).unwrap_or("");
      let id = heading.get("id").and_then(Value::as_str).unwrap_or("");
      let indent = level.saturating_sub(1) as usize * 2;
      println!("  {:width$} {text}  [{id}]", "", width = indent);
    }
  }
}

fn print_commands(value: &Value) {
  if let Some(commands) = value.get("commands").and_then(Value::as_array) {
    for command in commands {
      let id = command.get("id").and_then(Value::as_str).unwrap_or("?");
      let label = command.get("label").and_then(Value::as_str).unwrap_or("?");
      let group = command.get("group").and_then(Value::as_str).unwrap_or("");
      if group.is_empty() {
        println!("  {id}: {label}");
      } else {
        println!("  [{group}] {id}: {label}");
      }
    }
  }
}

fn print_scroll(value: &Value) {
  let pane = value.get("pane").and_then(Value::as_str).unwrap_or("main");
  let y = value.get("y").and_then(Value::as_f64).unwrap_or(0.0);
  println!("Scrolled {pane} to {y:.0}");
}

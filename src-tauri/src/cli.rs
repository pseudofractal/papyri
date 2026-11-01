//! Command-line entry point.
//!
//! A bare `papyri [PATH]` keeps the historical behavior of opening the GUI.
//! `papyri ctl ...` talks to the running instance over the local socket, and a
//! path passed while Papyri is running is forwarded to that instance.

use crate::cli_args::*;
use crate::cli_output::print_result;
use crate::control::{self, Request};
use clap::Parser;
use serde_json::{json, Value};
use std::{
  io::{BufRead, BufReader, Write},
  path::{Path, PathBuf},
  process::{Command, Stdio},
  thread,
  time::{Duration, Instant},
};

const MAX_WAIT_SECONDS: f64 = 86_400.0;

/// Returns true when the process should exit instead of starting the GUI.
pub fn intercept() -> bool {
  let cli = Cli::parse();
  match cli.command {
    Some(TopCommand::Ctl(args)) => {
      if let Err(error) = run_ctl(args) {
        eprintln!("error: {error}");
        std::process::exit(1);
      }
      true
    }
    None => match cli.path {
      Some(path) => {
        if control::is_running() {
          if let Err(error) = forward_path(&path) {
            eprintln!("error: {error}");
            std::process::exit(1);
          }
          true
        } else {
          false
        }
      }
      None => {
        if control::is_running() {
          if let Err(error) = control::request("raise", json!({}), Duration::from_secs_f64(0.0)) {
            eprintln!("error: {error}");
            std::process::exit(1);
          }
          true
        } else {
          false
        }
      }
    },
  }
}

fn run_ctl(args: CtlArgs) -> Result<(), String> {
  let wait = seconds(args.wait);
  match args.command {
    CtlCommand::Ping => print_result("ping", ping(wait)?, args.json),
    CtlCommand::State => print_result("state", request("state", json!({}), wait)?, args.json),
    CtlCommand::Headings => {
      print_result("headings", request("headings", json!({}), wait)?, args.json)
    }
    CtlCommand::Commands => {
      print_result("commands", request("commands", json!({}), wait)?, args.json)
    }
    CtlCommand::Open(open) => print_result("open", open_document(open, wait)?, args.json),
    CtlCommand::Close { path } => {
      let params = match path {
        Some(path) => json!({ "path": absolute_path(&path)?.to_string_lossy() }),
        None => json!({}),
      };
      print_result("close", request("close", params, wait)?, args.json)
    }
    CtlCommand::Focus { path } => {
      let params = json!({ "path": absolute_path(&path)?.to_string_lossy() });
      print_result("focus", request("focus", params, wait)?, args.json)
    }
    CtlCommand::Tab(tab) => match tab.command {
      TabCommand::Next => {
        print_result("tab.next", request("tab.next", json!({}), wait)?, args.json)
      }
      TabCommand::Previous => print_result(
        "tab.previous",
        request("tab.previous", json!({}), wait)?,
        args.json,
      ),
      TabCommand::List => print_result("state", request("state", json!({}), wait)?, args.json),
      TabCommand::Activate { path } => {
        let params = json!({ "path": absolute_path(&path)?.to_string_lossy() });
        print_result(
          "tab.activate",
          request("tab.activate", params, wait)?,
          args.json,
        )
      }
      TabCommand::Close { path } => {
        let params = match path {
          Some(path) => json!({ "path": absolute_path(&path)?.to_string_lossy() }),
          None => json!({}),
        };
        print_result("tab.close", request("tab.close", params, wait)?, args.json)
      }
    },
    CtlCommand::Scroll(scroll) => {
      let (method, params) = scroll_request(scroll.command);
      print_result(method, request(method, params, wait)?, args.json)
    }
    CtlCommand::Zoom(zoom) => {
      let params = zoom_request(zoom)?;
      print_result("zoom", request("zoom", params, wait)?, args.json)
    }
    CtlCommand::FitWidth { action } => {
      let params = match action {
        Some(ToggleAction::On) => json!({ "enabled": true }),
        Some(ToggleAction::Off) => json!({ "enabled": false }),
        Some(ToggleAction::Toggle) | None => json!({}),
      };
      print_result("fit-width", request("fit-width", params, wait)?, args.json)
    }
    CtlCommand::Theme(theme) => {
      let value = match theme.theme {
        ThemeArg::Light => "latte",
        ThemeArg::Dark => "mocha",
        ThemeArg::Toggle => "toggle",
      };
      print_result(
        "theme",
        request("theme", json!({ "theme": value }), wait)?,
        args.json,
      )
    }
    CtlCommand::Panel(panel) => {
      let params = json!({ "name": panel.name.as_str(), "action": panel.action.as_str() });
      print_result("panel", request("panel", params, wait)?, args.json)
    }
    CtlCommand::Search { query } => print_result(
      "search",
      request("search", json!({ "query": query }), wait)?,
      args.json,
    ),
    CtlCommand::Heading { id } => print_result(
      "heading",
      request("heading", json!({ "id": id }), wait)?,
      args.json,
    ),
    CtlCommand::Page { page } => {
      if page == 0 {
        return Err("Page numbers start at 1.".into());
      }
      print_result(
        "page",
        request("page", json!({ "page": page }), wait)?,
        args.json,
      )
    }
    CtlCommand::Command { id } => print_result(
      "command",
      request("command", json!({ "id": id }), wait)?,
      args.json,
    ),
    CtlCommand::Preferences(preferences) => match preferences.command {
      PreferenceCommand::Get => {
        let state = request("state", json!({}), wait)?;
        let value = state
          .get("preferences")
          .cloned()
          .ok_or("Papyri did not report preferences.")?;
        print_result("preferences", value, args.json)
      }
      PreferenceCommand::Set { patch } => {
        let patch: Value = serde_json::from_str(&patch)
          .map_err(|error| format!("Invalid preference JSON: {error}"))?;
        if !patch.is_object() {
          return Err("Preference updates must be a JSON object.".into());
        }
        print_result(
          "preferences",
          request("preferences.set", json!({ "patch": patch }), wait)?,
          args.json,
        )
      }
    },
    CtlCommand::Refresh => print_result("refresh", request("refresh", json!({}), wait)?, args.json),
    CtlCommand::Watch(watch) => run_watch(watch, wait)?,
    CtlCommand::Raise => print_result("raise", request("raise", json!({}), wait)?, args.json),
    CtlCommand::Quit => print_result("quit", request("quit", json!({}), wait)?, args.json),
    CtlCommand::Raw(raw) => {
      let params: Value = serde_json::from_str(&raw.params)
        .map_err(|error| format!("Invalid parameter JSON: {error}"))?;
      print_result(&raw.method, request(&raw.method, params, wait)?, args.json)
    }
  }
  Ok(())
}

fn request(method: &str, params: Value, wait: Duration) -> Result<Value, String> {
  control::request(method, params, wait)
}

/// Wait for the socket, then keep polling until the host UI reports ready.
fn ping(wait: Duration) -> Result<Value, String> {
  let deadline = Instant::now() + wait;
  let mut value = request("ping", json!({}), wait)?;
  if wait.is_zero() {
    return Ok(value);
  }
  loop {
    if value.get("ready").and_then(Value::as_bool) == Some(true) {
      return Ok(value);
    }
    if Instant::now() >= deadline {
      return Err(format!(
        "Papyri is running but its control bridge was not ready after {:.1} seconds.",
        wait.as_secs_f64()
      ));
    }
    thread::sleep(Duration::from_millis(50));
    value = request("ping", json!({}), Duration::ZERO)?;
  }
}

fn open_document(args: OpenArgs, wait: Duration) -> Result<Value, String> {
  let path = resolve_path(&args.path)?;
  let directory = path.is_dir();
  let mut params = json!({
    "path": path.to_string_lossy(),
    "pane": if args.secondary { "secondary" } else { "main" },
    "directory": directory,
  });
  if let Some(anchor) = args.anchor {
    params["anchor"] = Value::String(anchor);
  }
  if control::is_running() {
    return request("open", params, wait);
  }
  if args.no_launch {
    return Err(format!(
      "Papyri is not running (no control socket at {}).",
      control::socket_path().display()
    ));
  }
  launch(&path)?;
  let timeout = args
    .launch_timeout
    .map(seconds)
    .unwrap_or(Duration::from_secs(30))
    .max(wait);
  request("open", params, timeout)
}

fn forward_path(path: &Path) -> Result<(), String> {
  let path = resolve_path(path)?;
  let directory = path.is_dir();
  request(
    "open",
    json!({
      "path": path.to_string_lossy(),
      "pane": "main",
      "directory": directory,
    }),
    Duration::from_secs(0),
  )?;
  Ok(())
}

fn launch(path: &Path) -> Result<(), String> {
  let program = std::env::args_os()
    .next()
    .filter(|value| !value.is_empty())
    .unwrap_or_else(|| {
      std::env::current_exe()
        .map(|path| path.into_os_string())
        .unwrap_or_default()
    });
  match spawn(&program, path) {
    Ok(()) => Ok(()),
    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
      let current = std::env::current_exe()
        .map_err(|error| format!("Could not find the Papyri executable: {error}"))?;
      spawn(current.as_os_str(), path).map_err(|error| format!("Could not launch Papyri: {error}"))
    }
    Err(error) => Err(format!("Could not launch Papyri: {error}")),
  }
}

fn spawn(program: &std::ffi::OsStr, path: &Path) -> std::io::Result<()> {
  let mut command = Command::new(program);
  command
    .arg(path)
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::null());
  #[cfg(unix)]
  {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
  }
  command.spawn().map(|_| ())
}

fn scroll_request(command: ScrollCommand) -> (&'static str, Value) {
  match command {
    ScrollCommand::To { y, pane } => ("scroll.to", json!({ "pane": pane.as_str(), "y": y })),
    ScrollCommand::By { dy, pane } => ("scroll.by", json!({ "pane": pane.as_str(), "dy": dy })),
    ScrollCommand::Top { pane } => ("scroll.top", json!({ "pane": pane.as_str() })),
    ScrollCommand::Bottom { pane } => ("scroll.bottom", json!({ "pane": pane.as_str() })),
  }
}

fn zoom_request(args: ZoomArgs) -> Result<Value, String> {
  let mut params = json!({ "target": args.target.as_str() });
  match args.action {
    ZoomAction::In | ZoomAction::Out | ZoomAction::Reset => {
      if args.value.is_some() {
        return Err("`zoom in`, `zoom out`, and `zoom reset` do not take a percentage.".into());
      }
      let action = match args.action {
        ZoomAction::In => "in",
        ZoomAction::Out => "out",
        _ => "reset",
      };
      params["action"] = Value::String(action.into());
    }
    ZoomAction::Set => {
      let value = args
        .value
        .ok_or("`zoom set` needs a percentage, e.g. `papyri ctl zoom set 120`.")?;
      if !value.is_finite() || value <= 0.0 {
        return Err("Zoom must be a positive percentage.".into());
      }
      params["value"] = json!(value);
    }
  }
  Ok(params)
}

fn absolute_path(path: &Path) -> Result<PathBuf, String> {
  std::path::absolute(path)
    .map_err(|error| format!("Could not resolve {}: {error}", path.display()))
}

fn resolve_path(path: &Path) -> Result<PathBuf, String> {
  let absolute = absolute_path(path)?;
  if !absolute.exists() {
    return Err(format!("{} does not exist.", absolute.display()));
  }
  Ok(absolute)
}

fn seconds(value: f64) -> Duration {
  let value = if value.is_finite() {
    value.clamp(0.0, MAX_WAIT_SECONDS)
  } else {
    0.0
  };
  Duration::from_secs_f64(value)
}

fn run_watch(args: WatchArgs, wait: Duration) -> Result<(), String> {
  let mut stream = control::connect(wait)?;
  stream
    .set_read_timeout(None)
    .map_err(|error| error.to_string())?;
  control::send_request(
    &mut stream,
    &Request {
      id: json!(1),
      method: "subscribe".into(),
      params: if args.events.is_empty() {
        json!({})
      } else {
        json!({ "events": args.events })
      },
    },
  )?;
  let mut reader = BufReader::new(stream);
  let mut line = String::new();
  reader
    .read_line(&mut line)
    .map_err(|error| format!("Could not read the subscription response: {error}"))?;
  let response: Value = serde_json::from_str(line.trim())
    .map_err(|error| format!("Invalid subscription response: {error}"))?;
  if let Some(error) = response.get("error") {
    return Err(
      error
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("The window rejected the subscription.")
        .to_string(),
    );
  }
  let mut stdout = std::io::stdout();
  if !args.no_initial {
    if let Some(state) = response
      .get("result")
      .and_then(|result| result.get("state"))
    {
      if writeln!(stdout, "{}", json!({ "event": "state", "data": state })).is_err() {
        return Ok(());
      }
      if stdout.flush().is_err() {
        return Ok(());
      }
    }
  }
  loop {
    line.clear();
    match reader.read_line(&mut line) {
      Ok(0) => return Ok(()),
      Ok(_) => {
        if write!(stdout, "{line}").is_err() || stdout.flush().is_err() {
          return Ok(());
        }
      }
      Err(error) => return Err(format!("Control stream failed: {error}")),
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn parses_control_commands() {
    let cli = Cli::try_parse_from(["papyri", "ctl", "state"]).unwrap();
    assert!(matches!(
      cli.command,
      Some(TopCommand::Ctl(CtlArgs {
        command: CtlCommand::State,
        ..
      }))
    ));

    let cli = Cli::try_parse_from([
      "papyri",
      "ctl",
      "open",
      "notes.md",
      "--secondary",
      "--anchor",
      "intro",
    ])
    .unwrap();
    let Some(TopCommand::Ctl(CtlArgs {
      command: CtlCommand::Open(open),
      ..
    })) = cli.command
    else {
      panic!("expected open");
    };
    assert_eq!(open.path, PathBuf::from("notes.md"));
    assert!(open.secondary);
    assert_eq!(open.anchor.as_deref(), Some("intro"));
  }

  #[test]
  fn keeps_bare_path_launches() {
    let cli = Cli::try_parse_from(["papyri", "notes.md"]).unwrap();
    assert_eq!(cli.path, Some(PathBuf::from("notes.md")));
    assert!(cli.command.is_none());
  }

  #[test]
  fn parses_scroll_and_zoom() {
    let cli = Cli::try_parse_from(["papyri", "ctl", "scroll", "by", "-100"]).unwrap();
    let Some(TopCommand::Ctl(CtlArgs {
      command:
        CtlCommand::Scroll(ScrollArgs {
          command: ScrollCommand::By { dy, pane },
        }),
      ..
    })) = cli.command
    else {
      panic!("expected negative scroll");
    };
    assert_eq!(dy, -100.0);
    assert!(matches!(pane, PaneArg::Main));

    let (method, params) = scroll_request(ScrollCommand::By {
      dy: 200.0,
      pane: PaneArg::Secondary,
    });
    assert_eq!(method, "scroll.by");
    assert_eq!(params, json!({ "pane": "secondary", "dy": 200.0 }));

    let params = zoom_request(ZoomArgs {
      action: ZoomAction::Set,
      value: Some(120.0),
      target: ZoomTarget::Ui,
    })
    .unwrap();
    assert_eq!(params, json!({ "target": "ui", "value": 120.0 }));

    assert!(zoom_request(ZoomArgs {
      action: ZoomAction::Set,
      value: None,
      target: ZoomTarget::Document,
    })
    .is_err());
    assert!(zoom_request(ZoomArgs {
      action: ZoomAction::In,
      value: Some(120.0),
      target: ZoomTarget::Document,
    })
    .is_err());
  }

  #[test]
  fn parses_fit_width_and_watch() {
    let cli = Cli::try_parse_from(["papyri", "ctl", "fit-width", "on"]).unwrap();
    assert!(matches!(
      cli.command,
      Some(TopCommand::Ctl(CtlArgs {
        command: CtlCommand::FitWidth {
          action: Some(ToggleAction::On)
        },
        ..
      }))
    ));
    let cli =
      Cli::try_parse_from(["papyri", "ctl", "watch", "--events", "state,headings"]).unwrap();
    let Some(TopCommand::Ctl(CtlArgs {
      command: CtlCommand::Watch(watch),
      ..
    })) = cli.command
    else {
      panic!("expected watch");
    };
    assert_eq!(
      watch.events,
      vec!["state".to_string(), "headings".to_string()]
    );
  }

  #[test]
  fn parses_panel_and_preference_commands() {
    let cli = Cli::try_parse_from(["papyri", "ctl", "panel", "sidebar", "toggle"]).unwrap();
    let Some(TopCommand::Ctl(CtlArgs {
      command: CtlCommand::Panel(panel),
      ..
    })) = cli.command
    else {
      panic!("expected panel");
    };
    assert_eq!(panel.name.as_str(), "sidebar");
    assert_eq!(panel.action.as_str(), "toggle");

    let cli = Cli::try_parse_from([
      "papyri",
      "ctl",
      "preferences",
      "set",
      r#"{"theme":"latte"}"#,
    ])
    .unwrap();
    assert!(matches!(
      cli.command,
      Some(TopCommand::Ctl(CtlArgs {
        command: CtlCommand::Preferences(PreferencesArgs {
          command: PreferenceCommand::Set { .. }
        }),
        ..
      }))
    ));
  }
}

//! Command-line entry point.
//!
//! A bare `papyri [PATH]` keeps the historical behavior of opening the GUI.
//! `papyri ctl ...` talks to the running instance over the local socket, and a
//! path passed while Papyri is running is forwarded to that instance.

use crate::control::{self, Request, PROTOCOL_VERSION};
use clap::{Args, Parser, Subcommand, ValueEnum};
use serde_json::{json, Value};
use std::{
  io::{BufRead, BufReader, Write},
  path::{Path, PathBuf},
  process::{Command, Stdio},
  thread,
  time::{Duration, Instant},
};

#[derive(Parser, Debug)]
#[command(
  name = "papyri",
  version,
  about = "Read Markdown, PDF, Typst, and LaTeX documents",
  long_about = "Papyri is a read-only document viewer. Run `papyri ctl --help` to control a running window."
)]
struct Cli {
  /// Document or directory to open. A running window receives this path.
  #[arg(value_name = "PATH")]
  path: Option<PathBuf>,
  #[command(subcommand)]
  command: Option<TopCommand>,
}

#[derive(Subcommand, Debug)]
enum TopCommand {
  /// Control a running Papyri window over its local socket
  Ctl(CtlArgs),
}

#[derive(Args, Debug)]
struct CtlArgs {
  /// Print compact JSON instead of a human-readable summary
  #[arg(long, global = true)]
  json: bool,
  /// Wait up to this many seconds for Papyri to start
  #[arg(long, global = true, value_name = "SECONDS", default_value_t = 0.0)]
  wait: f64,
  #[command(subcommand)]
  command: CtlCommand,
}

#[derive(Subcommand, Debug)]
enum CtlCommand {
  /// Check whether Papyri is running
  Ping,
  /// Print the current document, tabs, view, and preferences
  State,
  /// Print the active document's headings
  Headings,
  /// List palette commands that `command` can run
  Commands,
  /// Open a document or folder, launching Papyri if needed
  Open(OpenArgs),
  /// Close a tab (the active tab by default)
  Close {
    #[arg(value_name = "PATH")]
    path: Option<PathBuf>,
  },
  /// Focus an open tab, opening it if needed
  Focus {
    #[arg(value_name = "PATH")]
    path: PathBuf,
  },
  /// Switch, focus, close, or list tabs
  Tab(TabArgs),
  /// Scroll a preview pane
  Scroll(ScrollArgs),
  /// Change document or interface zoom
  Zoom(ZoomArgs),
  /// Toggle or set fit-to-width
  FitWidth {
    #[arg(value_enum, value_name = "ACTION")]
    action: Option<ToggleAction>,
  },
  /// Set the color theme
  Theme(ThemeArgs),
  /// Show or hide a panel
  Panel(PanelArgs),
  /// Set the document search query (empty clears it)
  Search {
    #[arg(value_name = "QUERY")]
    query: String,
  },
  /// Scroll to a heading or PDF outline target
  Heading {
    #[arg(value_name = "ID")]
    id: String,
  },
  /// Go to a PDF page in the active document
  Page {
    #[arg(value_name = "PAGE")]
    page: u32,
  },
  /// Run a command palette action by id
  Command {
    #[arg(value_name = "ID")]
    id: String,
  },
  /// Read or update preferences
  Preferences(PreferencesArgs),
  /// Refresh the active document and explorer
  Refresh,
  /// Stream state events as newline-delimited JSON
  Watch(WatchArgs),
  /// Focus the main window
  Raise,
  /// Quit Papyri
  Quit,
  /// Send an arbitrary control method (advanced)
  Raw(RawArgs),
}

#[derive(Args, Debug)]
struct OpenArgs {
  #[arg(value_name = "PATH")]
  path: PathBuf,
  /// Scroll to an anchor after opening
  #[arg(long)]
  anchor: Option<String>,
  /// Open in the secondary split pane
  #[arg(long)]
  secondary: bool,
  /// Fail instead of launching Papyri when it is not running
  #[arg(long)]
  no_launch: bool,
  /// Seconds to wait for a launched window (default 30)
  #[arg(long, value_name = "SECONDS")]
  launch_timeout: Option<f64>,
}

#[derive(Args, Debug)]
struct TabArgs {
  #[command(subcommand)]
  command: TabCommand,
}

#[derive(Subcommand, Debug)]
enum TabCommand {
  /// Select the next tab
  Next,
  /// Select the previous tab
  Previous,
  /// Print open tabs
  List,
  /// Focus an open tab
  Activate {
    #[arg(value_name = "PATH")]
    path: PathBuf,
  },
  /// Close a tab (the active tab by default)
  Close {
    #[arg(value_name = "PATH")]
    path: Option<PathBuf>,
  },
}

#[derive(Args, Debug)]
struct ScrollArgs {
  #[command(subcommand)]
  command: ScrollCommand,
}

#[derive(Subcommand, Debug)]
enum ScrollCommand {
  /// Scroll to an absolute position
  To {
    #[arg(value_name = "Y")]
    y: f64,
    #[arg(long, value_enum, default_value_t = PaneArg::Main)]
    pane: PaneArg,
  },
  /// Scroll by a relative amount
  By {
    #[arg(value_name = "DY")]
    dy: f64,
    #[arg(long, value_enum, default_value_t = PaneArg::Main)]
    pane: PaneArg,
  },
  /// Scroll to the top
  Top {
    #[arg(long, value_enum, default_value_t = PaneArg::Main)]
    pane: PaneArg,
  },
  /// Scroll to the bottom
  Bottom {
    #[arg(long, value_enum, default_value_t = PaneArg::Main)]
    pane: PaneArg,
  },
}

#[derive(Args, Debug)]
struct ZoomArgs {
  #[arg(value_enum)]
  action: ZoomAction,
  /// Percentage for `set`
  #[arg(value_name = "PERCENT")]
  value: Option<f64>,
  #[arg(long, value_enum, default_value_t = ZoomTarget::Document)]
  target: ZoomTarget,
}

#[derive(Args, Debug)]
struct ThemeArgs {
  #[arg(value_enum)]
  theme: ThemeArg,
}

#[derive(Args, Debug)]
struct PanelArgs {
  #[arg(value_enum)]
  name: PanelName,
  #[arg(value_enum)]
  action: ToggleAction,
}

#[derive(Args, Debug)]
struct PreferencesArgs {
  #[command(subcommand)]
  command: PreferenceCommand,
}

#[derive(Subcommand, Debug)]
enum PreferenceCommand {
  /// Print the current preferences
  Get,
  /// Merge a JSON object into preferences
  Set {
    #[arg(value_name = "JSON")]
    patch: String,
  },
}

#[derive(Args, Debug)]
struct WatchArgs {
  /// Event names to stream (default: all)
  #[arg(long, value_delimiter = ',')]
  events: Vec<String>,
  /// Do not print the initial state snapshot
  #[arg(long)]
  no_initial: bool,
}

#[derive(Args, Debug)]
struct RawArgs {
  #[arg(value_name = "METHOD")]
  method: String,
  /// JSON object with method parameters
  #[arg(value_name = "JSON", default_value = "{}")]
  params: String,
}

#[derive(Clone, Copy, Debug, ValueEnum)]
enum PaneArg {
  Main,
  Secondary,
}

impl PaneArg {
  fn as_str(self) -> &'static str {
    match self {
      Self::Main => "main",
      Self::Secondary => "secondary",
    }
  }
}

#[derive(Clone, Copy, Debug, ValueEnum)]
enum ZoomAction {
  In,
  Out,
  Reset,
  Set,
}

#[derive(Clone, Copy, Debug, ValueEnum)]
enum ZoomTarget {
  Document,
  Ui,
}

impl ZoomTarget {
  fn as_str(self) -> &'static str {
    match self {
      Self::Document => "document",
      Self::Ui => "ui",
    }
  }
}

#[derive(Clone, Copy, Debug, ValueEnum)]
enum ThemeArg {
  Light,
  Dark,
  Toggle,
}

#[derive(Clone, Copy, Debug, ValueEnum)]
enum PanelName {
  Sidebar,
  Outline,
  Settings,
  Palette,
  Search,
  Split,
}

impl PanelName {
  fn as_str(self) -> &'static str {
    match self {
      Self::Sidebar => "sidebar",
      Self::Outline => "outline",
      Self::Settings => "settings",
      Self::Palette => "palette",
      Self::Search => "search",
      Self::Split => "split",
    }
  }
}

#[derive(Clone, Copy, Debug, ValueEnum)]
enum ToggleAction {
  On,
  Off,
  Toggle,
}

impl ToggleAction {
  fn as_str(self) -> &'static str {
    match self {
      Self::On => "on",
      Self::Off => "off",
      Self::Toggle => "toggle",
    }
  }
}

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
    value.clamp(0.0, 86_400.0)
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
  if !args.no_initial {
    if let Some(state) = response
      .get("result")
      .and_then(|result| result.get("state"))
    {
      println!("{}", json!({ "event": "state", "data": state }));
      let _ = std::io::stdout().flush();
    }
  }
  loop {
    line.clear();
    match reader.read_line(&mut line) {
      Ok(0) => return Ok(()),
      Ok(_) => {
        print!("{line}");
        let _ = std::io::stdout().flush();
      }
      Err(error) => return Err(format!("Control stream failed: {error}")),
    }
  }
}

fn print_result(method: &str, value: Value, json_output: bool) {
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

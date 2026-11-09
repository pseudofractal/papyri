//! Command-line entry point.
//!
//! A bare `papyri [PATH]` keeps the historical behavior of opening the GUI.
//! `papyri ctl ...` talks to the running instance over the local socket, and a
//! path passed while Papyri is running is forwarded to that instance.

use crate::cli_args::*;
use crate::cli_output::{print_result, write_output};
use crate::control::{self, ProtocolError, Request};
use crate::logging::{self, Mode as LogMode, Target as LogTarget};
use clap::{CommandFactory, Parser};
use serde_json::{json, Value};
use std::{
  ffi::OsString,
  fmt,
  io::{BufRead, BufReader, IsTerminal, Read, Write},
  path::{Path, PathBuf},
  sync::atomic::{AtomicU64, Ordering},
  thread,
  time::{Duration, Instant},
};

const MAX_WAIT_SECONDS: f64 = 86_400.0;
const DEFAULT_REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const TOOL_REQUEST_TIMEOUT: Duration = Duration::from_secs(3600);
static REQUEST_TIMEOUT_MS: AtomicU64 = AtomicU64::new(60_000);

#[derive(Debug)]
struct CliError {
  code: String,
  message: String,
}

impl CliError {
  fn new(code: &str, message: impl Into<String>) -> Self {
    Self {
      code: code.into(),
      message: message.into(),
    }
  }
}

impl From<String> for CliError {
  fn from(message: String) -> Self {
    Self::new("error", message)
  }
}

impl From<&str> for CliError {
  fn from(message: &str) -> Self {
    Self::new("error", message)
  }
}

impl From<ProtocolError> for CliError {
  fn from(error: ProtocolError) -> Self {
    Self::new(&error.code, error.message)
  }
}

impl fmt::Display for CliError {
  fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
    write!(formatter, "{}", self.message)
  }
}

fn fail(error: CliError, json_output: bool) -> ! {
  if json_output {
    print_result(
      "error",
      json!({ "error": { "code": error.code, "message": error.message } }),
      true,
    );
  } else {
    eprintln!("error: {}", error.message);
  }
  std::process::exit(1);
}

/// Returns true when the process should exit instead of starting the GUI.
pub fn intercept() -> bool {
  let cli = Cli::parse();
  // The launcher already configured stdio and the initial view for this
  // process. Do not detach again.
  if std::env::var_os("PAPYRI_GUI_PROCESS").is_some() {
    return false;
  }
  if let Err(error) = validate_launch_flags(&cli) {
    fail(error, false);
  }
  match cli.command {
    Some(TopCommand::Ctl(args)) => {
      let json_output = args.json;
      if let Err(error) = run_ctl(args) {
        fail(error, json_output);
      }
      true
    }
    Some(TopCommand::Completions(args)) => {
      if let Err(error) = run_completions(args) {
        fail(error, false);
      }
      true
    }
    None => match open_or_launch(cli.path, cli.decorationless, cli.log.as_deref()) {
      Ok(should_exit) => should_exit,
      Err(error) => fail(error, false),
    },
  }
}

fn validate_launch_flags(cli: &Cli) -> Result<(), CliError> {
  if cli.decorationless && cli.command.is_some() {
    return Err(CliError::new(
      "usage",
      "`--decorationless` only applies when opening a document or folder.",
    ));
  }
  if cli.log.is_some() && cli.command.is_some() {
    return Err(CliError::new(
      "usage",
      "`--log` only applies when starting Papyri.",
    ));
  }
  Ok(())
}

/// Forward a path or mode to the running window, or prepare this process to
/// start the GUI with the requested initial view.
fn open_or_launch(
  path: Option<PathBuf>,
  decorationless: bool,
  log: Option<&str>,
) -> Result<bool, CliError> {
  if control::is_running() {
    if log.is_some() {
      return Err(CliError::new(
        "usage",
        "`--log` only applies when starting Papyri; a window is already running. Omit it to forward this request.",
      ));
    }
    if let Some(path) = path.as_ref() {
      forward_path(path)?;
    }
    if decorationless {
      request(
        "decorationless",
        json!({ "enabled": true }),
        Duration::from_secs_f64(0.0),
      )?;
    }
    if path.is_none() {
      request("raise", json!({}), Duration::from_secs_f64(0.0))?;
    }
    Ok(true)
  } else {
    if decorationless {
      std::env::set_var("PAPYRI_DECORATIONLESS", "1");
    }
    if let Some(path) = path.as_ref() {
      record_initial_path(path)?;
    }
    let attached = std::io::stdout().is_terminal() || std::io::stderr().is_terminal();
    match logging::select(log, attached, !cfg!(debug_assertions))? {
      LogMode::Attached => Ok(false),
      LogMode::Detached(target) => {
        logging::spawn_detached(&program_path()?, &target)?;
        let _ = writeln!(
          std::io::stderr(),
          "Papyri started in the background; logging to {}.",
          target.describe()
        );
        Ok(true)
      }
    }
  }
}

fn program_path() -> Result<OsString, String> {
  std::env::current_exe()
    .ok()
    .map(|path| path.into_os_string())
    .or_else(|| std::env::args_os().next().filter(|value| !value.is_empty()))
    .ok_or_else(|| "Could not find the Papyri executable.".into())
}

/// Pass the launch target to the native startup hooks without making them
/// re-parse CLI flags such as `--decorationless`.
fn record_initial_path(path: &Path) -> Result<(), CliError> {
  let path = absolute_path(path)?;
  std::env::set_var("PAPYRI_INITIAL_PATH", path);
  Ok(())
}

fn run_completions(args: CompletionsArgs) -> Result<(), CliError> {
  let mut command = Cli::command();
  let mut generated = Vec::new();
  clap_complete::generate(args.shell, &mut command, "papyri", &mut generated);
  let generated = String::from_utf8_lossy(&generated);
  write_output(&generated).map_err(|error| {
    CliError::new(
      "io-error",
      format!("Could not write shell completions: {error}"),
    )
  })
}

fn run_ctl(args: CtlArgs) -> Result<(), CliError> {
  if let Some(socket) = args.socket.as_ref() {
    let socket = socket_override(socket)?;
    std::env::set_var("PAPYRI_CONTROL_SOCKET", socket);
  }
  let wait = seconds(args.wait);
  let timeout = args
    .timeout
    .map(seconds)
    .unwrap_or(DEFAULT_REQUEST_TIMEOUT)
    .max(Duration::from_millis(1_000));
  REQUEST_TIMEOUT_MS.store(
    timeout.as_millis().min(u64::MAX as u128) as u64,
    Ordering::Relaxed,
  );
  let tool_timeout = args
    .timeout
    .map(seconds)
    .unwrap_or(TOOL_REQUEST_TIMEOUT)
    .max(timeout);
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
      TabCommand::List => {
        let state = request("state", json!({}), wait)?;
        print_result("tab.list", tab_list_value(&state), args.json)
      }
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
    CtlCommand::Decorationless { action } => {
      let params = match action {
        Some(ToggleAction::On) => json!({ "enabled": true }),
        Some(ToggleAction::Off) => json!({ "enabled": false }),
        Some(ToggleAction::Toggle) | None => json!({}),
      };
      print_result(
        "decorationless",
        request("decorationless", params, wait)?,
        args.json,
      )
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
    CtlCommand::Editor(editor) => {
      let (method, params) = editor_request(editor.command)?;
      print_result(method, request(method, params, wait)?, args.json)
    }
    CtlCommand::Explorer(explorer) => {
      let (method, params) = explorer_request(explorer.command)?;
      print_result(method, request(method, params, wait)?, args.json)
    }
    CtlCommand::Note(note) => {
      let (method, params) = note_request(note.command)?;
      print_result(method, request(method, params, wait)?, args.json)
    }
    CtlCommand::Trust { action } => {
      let params = match action {
        Some(ToggleAction::On) => json!({ "enabled": true }),
        Some(ToggleAction::Off) => json!({ "enabled": false }),
        Some(ToggleAction::Toggle) | None => json!({}),
      };
      print_result("trust", request("trust", params, wait)?, args.json)
    }
    CtlCommand::Menu(menu) => {
      let (method, params) = menu_request(menu.command)?;
      let result = if method == "menu.get" {
        let state = request("state", json!({}), wait)?;
        state.get("menu").cloned().unwrap_or(Value::Null)
      } else {
        request(method, params, wait)?
      };
      print_result(method, result, args.json)
    }
    CtlCommand::Dom(dom) => {
      let (method, params) = dom_request(dom.command, dom.frame)?;
      print_result(method, request(method, params, wait)?, args.json)
    }
    CtlCommand::Screenshot(screenshot) => {
      let (method, params) = screenshot_request(screenshot)?;
      print_result(method, request(method, params, wait)?, args.json)
    }
    CtlCommand::Input(input) => {
      let (method, params) = input_request(input.command)?;
      print_result(method, request(method, params, wait)?, args.json)
    }
    CtlCommand::Clipboard(clipboard) => match clipboard.command {
      ClipboardCommand::Get => print_result(
        "clipboard.get",
        request("clipboard.get", json!({}), wait)?,
        args.json,
      ),
      ClipboardCommand::Set(input) => {
        let text = text_input(input, "clipboard text")?;
        print_result(
          "clipboard.set",
          request("clipboard.set", json!({ "text": text }), wait)?,
          args.json,
        )
      }
      ClipboardCommand::GetImage { output } => {
        let mut params = json!({});
        if let Some(output) = output {
          params["output"] = json!(absolute_path(&expand_home(&output))?.to_string_lossy());
        }
        print_result(
          "clipboard.get-image",
          request("clipboard.get-image", params, wait)?,
          args.json,
        )
      }
      ClipboardCommand::SetImage { path } => print_result(
        "clipboard.set-image",
        request(
          "clipboard.set-image",
          json!({ "path": absolute_path(&expand_home(&path))?.to_string_lossy() }),
          wait,
        )?,
        args.json,
      ),
    },
    CtlCommand::Record(record) => {
      if record.count == 0 || record.count > 300 {
        return Err("--count must be between 1 and 300.".into());
      }
      if record.interval_ms < 100 || record.interval_ms > 60_000 {
        return Err("--interval-ms must be between 100 and 60000.".into());
      }
      let output_dir = absolute_path(&expand_home(&record.output_dir))?;
      let capture_seconds = (record.count as f64 * record.interval_ms as f64) / 1000.0;
      let record_timeout = args
        .timeout
        .map(seconds)
        .unwrap_or_else(|| Duration::from_secs_f64((capture_seconds + 30.0).clamp(60.0, 86_400.0)));
      print_result(
        "record",
        request_with_timeout(
          "record",
          json!({
            "count": record.count,
            "intervalMs": record.interval_ms,
            "target": record.target.as_str(),
            "outputDir": output_dir.to_string_lossy(),
          }),
          wait,
          record_timeout,
        )?,
        args.json,
      )
    }
    CtlCommand::Wait(wait_args) => {
      let (method, params) = wait_request(wait_args.command)?;
      print_result(method, request(method, params, wait)?, args.json)
    }
    CtlCommand::Window(window) => match window.command {
      WindowCommand::List => print_result(
        "window.list",
        request("window.list", json!({}), wait)?,
        args.json,
      ),
      WindowCommand::Focus { id } => print_result(
        "window.focus",
        request("window.focus", json!({ "id": id }), wait)?,
        args.json,
      ),
      WindowCommand::Capture {
        id,
        output,
        clipboard,
      } => {
        let mut params = json!({ "id": id, "clipboard": clipboard });
        if let Some(output) = output {
          params["output"] = json!(absolute_path(&expand_home(&output))?.to_string_lossy());
        }
        print_result(
          "window.capture",
          request("window.capture", params, wait)?,
          args.json,
        )
      }
    },
    CtlCommand::Right { tab } => print_result(
      "right.tab",
      request("right.tab", json!({ "tab": tab.as_str() }), wait)?,
      args.json,
    ),
    CtlCommand::Browser(browser) => {
      let (method, params) = browser_request(browser.command)?;
      print_result(method, request(method, params, wait)?, args.json)
    }
    CtlCommand::Search(search) => {
      let chosen = [search.query.is_some(), search.next, search.previous]
        .into_iter()
        .filter(|value| *value)
        .count();
      if chosen != 1 {
        return Err("Use a query, --next, or --previous (exactly one).".into());
      }
      if let Some(query) = search.query {
        print_result(
          "search",
          request("search", json!({ "query": query }), wait)?,
          args.json,
        )
      } else if search.next {
        print_result(
          "search.next",
          request("search.next", json!({}), wait)?,
          args.json,
        )
      } else {
        print_result(
          "search.previous",
          request("search.previous", json!({}), wait)?,
          args.json,
        )
      }
    }
    CtlCommand::Pdf(pdf) => match pdf.command {
      PdfCommand::Password { password, stdin } => {
        let password = match password {
          Some(value) => value,
          None if stdin => read_stdin("PDF password")?
            .trim_end_matches(&['\r', '\n'][..])
            .to_string(),
          None => return Err("Provide a password or pass --stdin.".into()),
        };
        print_result(
          "pdf.password",
          request("pdf.password", json!({ "password": password }), wait)?,
          args.json,
        )
      }
    },
    CtlCommand::LivePreview { action } => {
      let params = match action {
        Some(ToggleAction::On) => json!({ "enabled": true }),
        Some(ToggleAction::Off) => json!({ "enabled": false }),
        Some(ToggleAction::Toggle) | None => json!({}),
      };
      print_result(
        "live-preview",
        request("live-preview", params, wait)?,
        args.json,
      )
    }
    CtlCommand::LivePreviewZoom { action } => print_result(
      "live-preview.zoom",
      request(
        "live-preview.zoom",
        json!({ "action": action.as_str() }),
        wait,
      )?,
      args.json,
    ),
    CtlCommand::LivePreviewFit => print_result(
      "live-preview.fit",
      request("live-preview.fit", json!({}), wait)?,
      args.json,
    ),
    CtlCommand::LivePreviewSplit { percent } => {
      if !(10.0..=90.0).contains(&percent) {
        return Err("The split percentage must be between 10 and 90.".into());
      }
      print_result(
        "live-preview.split",
        request("live-preview.split", json!({ "value": percent }), wait)?,
        args.json,
      )
    }
    CtlCommand::Selection(selection) => {
      let (method, params) = selection_request(selection.command)?;
      print_result(method, request(method, params, wait)?, args.json)
    }
    CtlCommand::Tools(tools) => match tools.command {
      ToolsCommand::Install { names } => {
        let mut installed = Vec::new();
        for name in names {
          installed.push(request_with_timeout(
            "tools.install",
            json!({ "name": name.as_str() }),
            wait,
            tool_timeout,
          )?);
        }
        print_result(
          "tools.install",
          json!({ "installed": installed }),
          args.json,
        )
      }
      ToolsCommand::Texlive { action } => print_result(
        "tools.texlive",
        request_with_timeout(
          "tools.texlive",
          json!({ "action": action.as_str() }),
          wait,
          tool_timeout,
        )?,
        args.json,
      ),
      ToolsCommand::Status => {
        let state = request("state", json!({}), wait)?;
        let tools = state
          .get("tools")
          .cloned()
          .unwrap_or_else(|| json!({ "busy": false, "message": "", "error": "" }));
        let preferences = state.get("preferences").cloned().unwrap_or(Value::Null);
        print_result(
          "tools.status",
          json!({ "tools": tools, "preferences": preferences }),
          args.json,
        )
      }
    },
    CtlCommand::Settings { tab } => {
      let (method, params) = match tab {
        Some(tab) => ("settings.tab", json!({ "tab": tab.as_str() })),
        None => ("panel", json!({ "name": "settings", "action": "on" })),
      };
      print_result(method, request(method, params, wait)?, args.json)
    }
    CtlCommand::Document(document) => match document.command {
      DocumentCommand::CopyRaw => print_result(
        "document.copy",
        request("document.copy", json!({}), wait)?,
        args.json,
      ),
      DocumentCommand::Stats => {
        let state = request("state", json!({}), wait)?;
        let stats = state.get("stats").cloned().unwrap_or(Value::Null);
        print_result("document.stats", stats, args.json)
      }
    },
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
    CtlCommand::Socket => print_result(
      "socket",
      json!({ "path": control::socket_path().to_string_lossy() }),
      args.json,
    ),
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

fn editor_request(command: EditorCommand) -> Result<(&'static str, Value), CliError> {
  Ok(match command {
    EditorCommand::Open => ("editor.open", json!({})),
    EditorCommand::Close => ("editor.close", json!({})),
    EditorCommand::Toggle => ("editor.toggle", json!({})),
    EditorCommand::Save => ("editor.save", json!({})),
    EditorCommand::Reload { force } => ("editor.reload", json!({ "discard": force })),
    EditorCommand::Discard => ("editor.discard", json!({})),
    EditorCommand::Get => ("editor.get", json!({})),
    EditorCommand::Set(input) => (
      "editor.set",
      json!({ "text": text_input(input, "source text")? }),
    ),
    EditorCommand::Reveal { line, column } => {
      if line == 0 || column == 0 {
        return Err("Line and column numbers start at 1.".into());
      }
      (
        "editor.reveal",
        json!({ "line": line - 1, "character": column - 1 }),
      )
    }
    EditorCommand::Sync => ("editor.sync", json!({})),
    EditorCommand::Undo => ("editor.undo", json!({})),
    EditorCommand::Redo => ("editor.redo", json!({})),
    EditorCommand::SelectAll => ("editor.select-all", json!({})),
    EditorCommand::Select { from, to } => ("editor.select", json!({ "from": from, "to": to })),
    EditorCommand::Copy => ("editor.copy", json!({})),
    EditorCommand::Cut => ("editor.cut", json!({})),
    EditorCommand::Paste => ("editor.paste", json!({})),
    EditorCommand::Diagnostics => ("editor.diagnostics", json!({})),
  })
}

fn explorer_request(command: ExplorerCommand) -> Result<(&'static str, Value), CliError> {
  Ok(match command {
    ExplorerCommand::List { path } => (
      "explorer.list",
      json!({ "path": path.map(|path| absolute_path(&path).map(|path| path.to_string_lossy().into_owned())).transpose()? }),
    ),
    ExplorerCommand::Cwd { path } => ("explorer.cwd", path_params(path)?),
    ExplorerCommand::Expand { path } => ("explorer.expand", path_params(path)?),
    ExplorerCommand::Collapse { path } => ("explorer.collapse", path_params(path)?),
    ExplorerCommand::Select { path } => ("explorer.select", path_params(path)?),
    ExplorerCommand::Read { path } => ("explorer.read", path_params(path)?),
    ExplorerCommand::Create { path, kind } => {
      let path = absolute_path(&path)?;
      let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return Err("The new entry needs a file or folder name.".into());
      };
      if name.is_empty() {
        return Err("The new entry needs a file or folder name.".into());
      }
      let extension = kind.extension();
      let name = if !extension.is_empty() && !name.to_lowercase().ends_with(extension) {
        format!("{name}{extension}")
      } else {
        name.to_string()
      };
      let Some(directory) = path.parent() else {
        return Err("The new entry needs a parent folder.".into());
      };
      (
        "explorer.create",
        json!({
          "directory": directory.to_string_lossy(),
          "name": name,
          "kind": kind.as_str(),
        }),
      )
    }
    ExplorerCommand::Rename { path, name } => {
      if name.trim().is_empty() {
        return Err("The new name must not be empty.".into());
      }
      let mut params = path_params(path)?;
      params["name"] = Value::String(name);
      ("explorer.rename", params)
    }
    ExplorerCommand::Delete { path, yes } => {
      if !yes {
        return Err("Deleting is permanent; pass --yes to confirm.".into());
      }
      let mut params = path_params(path)?;
      params["force"] = Value::Bool(true);
      ("explorer.delete", params)
    }
    ExplorerCommand::Refresh => ("refresh", json!({})),
  })
}

fn path_params(path: PathBuf) -> Result<Value, CliError> {
  Ok(json!({ "path": absolute_path(&path)?.to_string_lossy() }))
}

fn note_request(command: NoteCommand) -> Result<(&'static str, Value), CliError> {
  Ok(match command {
    NoteCommand::Get => ("note.get", json!({})),
    NoteCommand::Set(input) => ("note.set", json!({ "text": text_input(input, "note")? })),
    NoteCommand::Clear => ("note.set", json!({ "text": "" })),
  })
}

fn menu_request(command: MenuCommand) -> Result<(&'static str, Value), CliError> {
  Ok(match command {
    MenuCommand::Open {
      kind,
      path,
      x,
      y,
      directory,
      document,
    } => {
      let mut params = json!({ "kind": kind.as_str() });
      if matches!(kind, MenuTargetArg::Tab | MenuTargetArg::File) {
        let Some(path) = path else {
          return Err("A tab or file menu needs a path.".into());
        };
        params["path"] = Value::String(absolute_path(&path)?.to_string_lossy().into_owned());
      } else if path.is_some() {
        return Err("Only tab and file menus take a path.".into());
      }
      if (directory || document) && !matches!(kind, MenuTargetArg::File) {
        return Err("--directory and --document only apply to file menus.".into());
      }
      if let Some(x) = x {
        if !x.is_finite() {
          return Err("--x must be a finite number.".into());
        }
        params["x"] = json!(x);
      }
      if let Some(y) = y {
        if !y.is_finite() {
          return Err("--y must be a finite number.".into());
        }
        params["y"] = json!(y);
      }
      if directory {
        params["directory"] = Value::Bool(true);
      }
      if document {
        params["document"] = Value::Bool(true);
      }
      ("menu.open", params)
    }
    MenuCommand::Activate { index } => ("menu.activate", json!({ "index": index })),
    MenuCommand::Close => ("menu.close", json!({})),
    MenuCommand::Get => ("menu.get", json!({})),
  })
}

fn wait_request(command: WaitCommand) -> Result<(&'static str, Value), CliError> {
  Ok(match command {
    WaitCommand::Idle { timeout_ms } => ("wait.idle", json!({ "timeoutMs": timeout_ms })),
    WaitCommand::Selector {
      selector,
      frame,
      timeout_ms,
    } => (
      "wait.selector",
      json!({
        "selector": selector,
        "frame": frame.as_str(),
        "timeoutMs": timeout_ms,
      }),
    ),
    WaitCommand::State {
      path,
      equals,
      timeout_ms,
    } => {
      let equals = serde_json::from_str::<Value>(&equals).unwrap_or_else(|_| Value::String(equals));
      (
        "wait.state",
        json!({ "path": path, "equals": equals, "timeoutMs": timeout_ms }),
      )
    }
  })
}

fn input_request(command: InputCommand) -> Result<(&'static str, Value), CliError> {
  Ok(match command {
    InputCommand::Move { x, y } => ("input.move", json!({ "x": x, "y": y })),
    InputCommand::Click {
      x,
      y,
      button,
      count,
    } => {
      if count == 0 || count > 3 {
        return Err("--count must be between 1 and 3.".into());
      }
      (
        "input.click",
        json!({ "x": x, "y": y, "button": button.as_str(), "count": count }),
      )
    }
    InputCommand::Drag {
      x,
      y,
      to_x,
      to_y,
      button,
    } => (
      "input.drag",
      json!({
        "x": x,
        "y": y,
        "toX": to_x,
        "toY": to_y,
        "button": button.as_str(),
      }),
    ),
    InputCommand::Scroll { x, y, dx, dy } => (
      "input.scroll",
      json!({ "x": x, "y": y, "dx": dx, "dy": dy }),
    ),
    InputCommand::Key { keys } => ("input.key", json!({ "keys": keys })),
    InputCommand::Type(input) => ("input.type", json!({ "text": text_input(input, "text")? })),
  })
}

fn dom_request(command: DomCommand, frame: DomFrameArg) -> Result<(&'static str, Value), CliError> {
  let (method, mut params) = match command {
    DomCommand::Query {
      selector,
      limit,
      all,
    } => {
      let mut params = json!({ "includeHidden": all });
      if let Some(selector) = selector {
        params["selector"] = Value::String(selector);
      }
      if let Some(limit) = limit {
        if limit == 0 || limit > 1000 {
          return Err("--limit must be between 1 and 1000.".into());
        }
        params["limit"] = json!(limit);
      }
      ("dom.query", params)
    }
    DomCommand::Get { reference } => ("dom.get", json!({ "ref": reference })),
    DomCommand::Focus { reference } => ("dom.focus", json!({ "ref": reference })),
    DomCommand::Click { reference } => ("dom.click", json!({ "ref": reference })),
    DomCommand::Type { reference, input } => (
      "dom.type",
      json!({ "ref": reference, "text": text_input(input, "text")? }),
    ),
    DomCommand::Ax => ("dom.ax", json!({})),
  };
  params["frame"] = Value::String(frame.as_str().into());
  Ok((method, params))
}

fn screenshot_request(args: ScreenshotArgs) -> Result<(&'static str, Value), CliError> {
  let mut params = json!({ "clipboard": args.clipboard });
  if let Some(output) = args.output {
    params["output"] = json!(absolute_path(&expand_home(&output))?.to_string_lossy());
  }
  match args.target.unwrap_or(ScreenshotTarget::Screen) {
    ScreenshotTarget::Screen => {
      params["target"] = Value::String("screen".into());
    }
    ScreenshotTarget::App => {
      params["target"] = Value::String("app".into());
    }
    ScreenshotTarget::Element {
      reference,
      selector,
      frame,
    } => {
      if reference.is_none() && selector.is_none() {
        return Err("Element screenshots need a REF or --selector.".into());
      }
      params["target"] = Value::String("element".into());
      params["frame"] = Value::String(frame.as_str().into());
      if let Some(reference) = reference {
        params["ref"] = Value::String(reference);
      }
      if let Some(selector) = selector {
        params["selector"] = Value::String(selector);
      }
    }
    ScreenshotTarget::Rect {
      x,
      y,
      width,
      height,
    } => {
      if !(x.is_finite() && y.is_finite()) || !(width.is_finite() && height.is_finite()) {
        return Err("Screenshot coordinates must be finite numbers.".into());
      }
      if width <= 0.0 || height <= 0.0 {
        return Err("Screenshot width and height must be positive.".into());
      }
      params["target"] = Value::String("rect".into());
      params["x"] = json!(x);
      params["y"] = json!(y);
      params["width"] = json!(width);
      params["height"] = json!(height);
    }
  }
  Ok(("screenshot", params))
}

fn browser_request(command: BrowserCommand) -> Result<(&'static str, Value), CliError> {
  Ok(match command {
    BrowserCommand::Navigate { target } => ("browser.navigate", json!({ "target": target })),
    BrowserCommand::Back => ("browser.back", json!({})),
    BrowserCommand::Forward => ("browser.forward", json!({})),
    BrowserCommand::Reload => ("browser.reload", json!({})),
    BrowserCommand::Stop => ("browser.stop", json!({})),
    BrowserCommand::Zoom { action } => ("browser.zoom", json!({ "action": action.as_str() })),
    BrowserCommand::Window { url } => ("browser.window", json!({ "url": url })),
    BrowserCommand::Quote { text, site } => (
      "browser.quote",
      json!({ "site": site.as_str(), "text": text }),
    ),
    BrowserCommand::Search { text } => ("browser.search", json!({ "text": text })),
  })
}

fn selection_request(command: Option<SelectionCommand>) -> Result<(&'static str, Value), CliError> {
  Ok(match command {
    None | Some(SelectionCommand::Get) => ("selection.get", json!({})),
    Some(SelectionCommand::Copy { kind }) => ("selection.copy", json!({ "kind": kind.as_str() })),
    Some(SelectionCommand::Set { text }) => ("selection.set", json!({ "text": text })),
    Some(SelectionCommand::Clear) => ("selection.clear", json!({})),
  })
}

fn text_input(input: TextInputArgs, label: &str) -> Result<String, CliError> {
  let sources = [input.text.is_some(), input.file.is_some(), input.stdin]
    .into_iter()
    .filter(|value| *value)
    .count();
  if sources != 1 {
    return Err(format!("Provide {label} as TEXT, --file, or --stdin (exactly one).").into());
  }
  if let Some(text) = input.text {
    return Ok(text);
  }
  if let Some(file) = input.file {
    return std::fs::read_to_string(&file).map_err(|error| {
      CliError::new(
        "io-error",
        format!("Could not read {}: {error}", file.display()),
      )
    });
  }
  read_stdin(label)
}

fn read_stdin(label: &str) -> Result<String, CliError> {
  let mut value = String::new();
  std::io::stdin()
    .read_to_string(&mut value)
    .map_err(|error| {
      CliError::new(
        "io-error",
        format!("Could not read {label} from stdin: {error}"),
      )
    })?;
  Ok(value)
}

fn tab_list_value(state: &Value) -> Value {
  let tabs = state
    .get("tabs")
    .cloned()
    .unwrap_or_else(|| Value::Array(Vec::new()));
  json!({ "tabs": tabs })
}

fn socket_override(socket: &Path) -> Result<PathBuf, CliError> {
  if socket.as_os_str().is_empty() {
    return Err(CliError::new("bad-params", "`--socket` must not be empty."));
  }
  std::path::absolute(socket).map_err(|error| {
    CliError::new(
      "bad-params",
      format!(
        "Could not resolve socket path {}: {error}",
        socket.display()
      ),
    )
  })
}

fn request(method: &str, params: Value, wait: Duration) -> Result<Value, CliError> {
  let timeout = Duration::from_millis(REQUEST_TIMEOUT_MS.load(Ordering::Relaxed));
  request_with_timeout(method, params, wait, timeout)
}

fn request_with_timeout(
  method: &str,
  params: Value,
  wait: Duration,
  timeout: Duration,
) -> Result<Value, CliError> {
  control::request_with_timeout(method, params, wait, timeout).map_err(CliError::from)
}

/// Wait for the socket, then keep polling until the host UI reports ready.
fn ping(wait: Duration) -> Result<Value, CliError> {
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
      return Err(
        format!(
          "Papyri is running but its control bridge was not ready after {:.1} seconds.",
          wait.as_secs_f64()
        )
        .into(),
      );
    }
    thread::sleep(Duration::from_millis(50));
    value = request("ping", json!({}), Duration::ZERO)?;
  }
}

fn open_document(args: OpenArgs, wait: Duration) -> Result<Value, CliError> {
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
    return Err(
      format!(
        "Papyri is not running (no control socket at {}).",
        control::socket_path().display()
      )
      .into(),
    );
  }
  launch(&path)?;
  let timeout = args
    .launch_timeout
    .map(seconds)
    .unwrap_or(Duration::from_secs(30))
    .max(wait);
  request("open", params, timeout)
}

fn forward_path(path: &Path) -> Result<(), CliError> {
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
  let path = absolute_path(path)?;
  std::env::set_var("PAPYRI_INITIAL_PATH", &path);
  logging::spawn_detached(&program_path()?, &LogTarget::File(logging::default_file()))?;
  Ok(())
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

fn expand_home(path: &Path) -> PathBuf {
  let mut components = path.components();
  if matches!(components.next(), Some(std::path::Component::Normal(part)) if part == "~") {
    if let Some(home) = std::env::var_os("HOME") {
      let rest = components.as_path();
      return Path::new(&home).join(rest);
    }
  }
  path.to_path_buf()
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

fn run_watch(args: WatchArgs, wait: Duration) -> Result<(), CliError> {
  let mut stream =
    control::connect(wait).map_err(|message| CliError::new("unavailable", message))?;
  stream
    .set_read_timeout(None)
    .map_err(|error| CliError::new("io-error", error.to_string()))?;
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
      timeout_ms: None,
    },
  )
  .map_err(|message| CliError::new("io-error", message))?;
  let mut reader = BufReader::new(stream);
  let mut line = String::new();
  reader.read_line(&mut line).map_err(|error| {
    CliError::new(
      "io-error",
      format!("Could not read the subscription response: {error}"),
    )
  })?;
  let response: Value = serde_json::from_str(line.trim()).map_err(|error| {
    CliError::new(
      "protocol-error",
      format!("Invalid subscription response: {error}"),
    )
  })?;
  if let Some(error) = response.get("error") {
    let code = error.get("code").and_then(Value::as_str).unwrap_or("error");
    let message = error
      .get("message")
      .and_then(Value::as_str)
      .unwrap_or("The window rejected the subscription.");
    return Err(CliError::new(code, message));
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
      Err(error) => return Err(format!("Control stream failed: {error}").into()),
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
    assert!(!cli.decorationless);
    assert!(cli.log.is_none());
    assert!(cli.command.is_none());
  }

  #[test]
  fn parses_log_targets() {
    let cli = Cli::try_parse_from(["papyri", "--log", "terminal", "notes.md"]).unwrap();
    assert_eq!(cli.log.as_deref(), Some("terminal"));
    assert_eq!(cli.path, Some(PathBuf::from("notes.md")));

    let cli = Cli::try_parse_from(["papyri", "-l", "cmd:wl-copy", "notes.md"]).unwrap();
    assert_eq!(cli.log.as_deref(), Some("cmd:wl-copy"));
    assert_eq!(cli.path, Some(PathBuf::from("notes.md")));

    let cli = Cli::try_parse_from(["papyri", "notes.md", "--log", "-"]).unwrap();
    assert_eq!(cli.log.as_deref(), Some("-"));
    assert_eq!(cli.path, Some(PathBuf::from("notes.md")));

    let cli = Cli::try_parse_from(["papyri", "--log", "terminal", "ctl", "state"]).unwrap();
    assert!(validate_launch_flags(&cli).is_err());
  }

  #[test]
  fn parses_decorationless_launches() {
    for args in [
      vec!["papyri", "--decorationless", "notes.md"],
      vec!["papyri", "-d", "notes.md"],
      vec!["papyri", "notes.md", "--decorationless"],
    ] {
      let cli = Cli::try_parse_from(args).unwrap();
      assert!(cli.decorationless);
      assert_eq!(cli.path, Some(PathBuf::from("notes.md")));
      assert!(cli.command.is_none());
    }
    let cli = Cli::try_parse_from(["papyri", "--decorationless"]).unwrap();
    assert!(cli.decorationless);
    assert_eq!(cli.path, None);
    assert!(cli.command.is_none());

    let cli = Cli::try_parse_from(["papyri", "--decorationless", "ctl", "state"]).unwrap();
    assert!(validate_launch_flags(&cli).is_err());
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
    let cli = Cli::try_parse_from(["papyri", "ctl", "decorationless"]).unwrap();
    assert!(matches!(
      cli.command,
      Some(TopCommand::Ctl(CtlArgs {
        command: CtlCommand::Decorationless { action: None },
        ..
      }))
    ));
    let cli = Cli::try_parse_from(["papyri", "ctl", "decorationless", "off"]).unwrap();
    assert!(matches!(
      cli.command,
      Some(TopCommand::Ctl(CtlArgs {
        command: CtlCommand::Decorationless {
          action: Some(ToggleAction::Off)
        },
        ..
      }))
    ));
    let cli = Cli::try_parse_from(["papyri", "ctl", "decoration-less"]).unwrap();
    assert!(matches!(
      cli.command,
      Some(TopCommand::Ctl(CtlArgs {
        command: CtlCommand::Decorationless { action: None },
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

  #[test]
  fn preserves_protocol_error_codes_for_cli_output() {
    let error = CliError::from(ProtocolError {
      code: "timeout".into(),
      message: "The request timed out.".into(),
    });
    assert_eq!(error.code, "timeout");
    assert_eq!(error.message, "The request timed out.");
  }

  #[test]
  fn parses_socket_override_and_completions() {
    let cli =
      Cli::try_parse_from(["papyri", "ctl", "state", "--socket", "/tmp/papyri.sock"]).unwrap();
    let Some(TopCommand::Ctl(CtlArgs { socket, .. })) = cli.command else {
      panic!("expected ctl");
    };
    assert_eq!(socket, Some(PathBuf::from("/tmp/papyri.sock")));

    let cli = Cli::try_parse_from(["papyri", "completions", "bash"]).unwrap();
    assert!(matches!(
      cli.command,
      Some(TopCommand::Completions(CompletionsArgs {
        shell: clap_complete::Shell::Bash
      }))
    ));

    let cli = Cli::try_parse_from(["papyri", "ctl", "socket"]).unwrap();
    assert!(matches!(
      cli.command,
      Some(TopCommand::Ctl(CtlArgs {
        command: CtlCommand::Socket,
        ..
      }))
    ));
  }

  #[test]
  fn parses_extended_control_commands() {
    let cli =
      Cli::try_parse_from(["papyri", "ctl", "editor", "reveal", "12", "--column", "3"]).unwrap();
    let Some(TopCommand::Ctl(CtlArgs {
      command:
        CtlCommand::Editor(EditorArgs {
          command: EditorCommand::Reveal { line, column },
        }),
      ..
    })) = cli.command
    else {
      panic!("expected editor reveal");
    };
    let (method, params) = editor_request(EditorCommand::Reveal { line, column }).unwrap();
    assert_eq!(method, "editor.reveal");
    assert_eq!(params, json!({ "line": 11, "character": 2 }));

    let (method, params) = editor_request(EditorCommand::Set(TextInputArgs {
      text: Some("\\section{Hi}".into()),
      file: None,
      stdin: false,
    }))
    .unwrap();
    assert_eq!(method, "editor.set");
    assert_eq!(params, json!({ "text": "\\section{Hi}" }));

    let cli = Cli::try_parse_from([
      "papyri",
      "ctl",
      "explorer",
      "create",
      "/tmp/notes",
      "--kind",
      "latex",
    ])
    .unwrap();
    let Some(TopCommand::Ctl(CtlArgs {
      command: CtlCommand::Explorer(ExplorerArgs { command }),
      ..
    })) = cli.command
    else {
      panic!("expected explorer create");
    };
    let (method, params) = explorer_request(command).unwrap();
    assert_eq!(method, "explorer.create");
    assert_eq!(params["directory"], "/tmp");
    assert_eq!(params["name"], "notes.tex");
    assert_eq!(params["kind"], "latex");

    let gone = explorer_request(ExplorerCommand::Delete {
      path: PathBuf::from("/tmp/notes.tex"),
      yes: false,
    });
    assert!(gone.is_err());
    let (method, params) = explorer_request(ExplorerCommand::Delete {
      path: PathBuf::from("/tmp/notes.tex"),
      yes: true,
    })
    .unwrap();
    assert_eq!(method, "explorer.delete");
    assert_eq!(params["force"], true);

    let cli = Cli::try_parse_from(["papyri", "ctl", "search", "--next"]).unwrap();
    assert!(matches!(
      cli.command,
      Some(TopCommand::Ctl(CtlArgs {
        command: CtlCommand::Search(SearchArgs {
          query: None,
          next: true,
          previous: false,
        }),
        ..
      }))
    ));

    let cli = Cli::try_parse_from([
      "papyri",
      "ctl",
      "menu",
      "open",
      "file",
      "/tmp/notes.md",
      "--x",
      "12",
      "--y",
      "34",
    ])
    .unwrap();
    let Some(TopCommand::Ctl(CtlArgs {
      command: CtlCommand::Menu(MenuArgs { command }),
      ..
    })) = cli.command
    else {
      panic!("expected menu open");
    };
    let (method, params) = menu_request(command).unwrap();
    assert_eq!(method, "menu.open");
    assert_eq!(params["kind"], "file");
    assert_eq!(params["x"], 12.0);
    assert_eq!(params["y"], 34.0);
    assert!(menu_request(MenuCommand::Open {
      kind: MenuTargetArg::Tab,
      path: None,
      x: None,
      y: None,
      directory: false,
      document: false,
    })
    .is_err());
    let (method, params) = menu_request(MenuCommand::Activate { index: 3 }).unwrap();
    assert_eq!(method, "menu.activate");
    assert_eq!(params, json!({ "index": 3 }));

    let cli = Cli::try_parse_from([
      "papyri",
      "ctl",
      "screenshot",
      "app",
      "--output",
      "/tmp/app.png",
    ])
    .unwrap();
    let Some(TopCommand::Ctl(CtlArgs {
      command: CtlCommand::Screenshot(screenshot),
      ..
    })) = cli.command
    else {
      panic!("expected screenshot");
    };
    let (method, params) = screenshot_request(screenshot).unwrap();
    assert_eq!(method, "screenshot");
    assert_eq!(params["target"], "app");
    assert_eq!(params["output"], "/tmp/app.png");
    assert_eq!(params["clipboard"], false);

    let cli = Cli::try_parse_from(["papyri", "ctl", "dom", "type", "dom-1", "hello"]).unwrap();
    let Some(TopCommand::Ctl(CtlArgs {
      command: CtlCommand::Dom(DomArgs { command, .. }),
      ..
    })) = cli.command
    else {
      panic!("expected dom type");
    };
    let (method, params) = dom_request(command, DomFrameArg::Main).unwrap();
    assert_eq!(method, "dom.type");
    assert_eq!(params["ref"], "dom-1");
    assert_eq!(params["text"], "hello");

    let cli = Cli::try_parse_from([
      "papyri", "ctl", "input", "click", "10", "20", "--button", "right", "--count", "2",
    ])
    .unwrap();
    let Some(TopCommand::Ctl(CtlArgs {
      command: CtlCommand::Input(InputArgs { command }),
      ..
    })) = cli.command
    else {
      panic!("expected input click");
    };
    let (method, params) = input_request(command).unwrap();
    assert_eq!(method, "input.click");
    assert_eq!(params["x"], 10);
    assert_eq!(params["button"], "right");

    let cli =
      Cli::try_parse_from(["papyri", "ctl", "dom", "--frame", "preview", "query", "h1"]).unwrap();
    let Some(TopCommand::Ctl(CtlArgs {
      command: CtlCommand::Dom(DomArgs { command, frame }),
      ..
    })) = cli.command
    else {
      panic!("expected dom query");
    };
    let (_, params) = dom_request(command, frame).unwrap();
    assert_eq!(params["frame"], "preview");

    let cli = Cli::try_parse_from(["papyri", "ctl", "wait", "state", "busy", "false"]).unwrap();
    let Some(TopCommand::Ctl(CtlArgs {
      command: CtlCommand::Wait(WaitArgs { command }),
      ..
    })) = cli.command
    else {
      panic!("expected wait state");
    };
    let (method, params) = wait_request(command).unwrap();
    assert_eq!(method, "wait.state");
    assert_eq!(params["equals"], false);

    let cli = Cli::try_parse_from([
      "papyri",
      "ctl",
      "record",
      "--output-dir",
      "/tmp/frames",
      "--count",
      "2",
    ])
    .unwrap();
    assert!(matches!(
      cli.command,
      Some(TopCommand::Ctl(CtlArgs {
        command: CtlCommand::Record(RecordArgs { count: 2, .. }),
        ..
      }))
    ));

    let cli = Cli::try_parse_from([
      "papyri",
      "ctl",
      "clipboard",
      "get-image",
      "--output",
      "/tmp/clip.png",
    ])
    .unwrap();
    assert!(matches!(
      cli.command,
      Some(TopCommand::Ctl(CtlArgs {
        command: CtlCommand::Clipboard(ClipboardArgs {
          command: ClipboardCommand::GetImage { output: Some(_) }
        }),
        ..
      }))
    ));

    let cli =
      Cli::try_parse_from(["papyri", "ctl", "window", "capture", "abc", "--clipboard"]).unwrap();
    assert!(matches!(
      cli.command,
      Some(TopCommand::Ctl(CtlArgs {
        command: CtlCommand::Window(WindowArgs {
          command: WindowCommand::Capture {
            clipboard: true,
            ..
          }
        }),
        ..
      }))
    ));

    let cli = Cli::try_parse_from(["papyri", "ctl", "window", "list"]).unwrap();
    assert!(matches!(
      cli.command,
      Some(TopCommand::Ctl(CtlArgs {
        command: CtlCommand::Window(WindowArgs {
          command: WindowCommand::List
        }),
        ..
      }))
    ));

    let cli = Cli::try_parse_from(["papyri", "ctl", "pdf", "password", "--stdin"]).unwrap();
    assert!(matches!(
      cli.command,
      Some(TopCommand::Ctl(CtlArgs {
        command: CtlCommand::Pdf(PdfArgs {
          command: PdfCommand::Password {
            password: None,
            stdin: true
          }
        }),
        ..
      }))
    ));

    let cli =
      Cli::try_parse_from(["papyri", "ctl", "tools", "install", "tinymist", "typst"]).unwrap();
    let Some(TopCommand::Ctl(CtlArgs {
      command:
        CtlCommand::Tools(ToolsArgs {
          command: ToolsCommand::Install { names },
        }),
      ..
    })) = cli.command
    else {
      panic!("expected tools install");
    };
    assert_eq!(
      names.iter().map(|name| name.as_str()).collect::<Vec<_>>(),
      ["tinymist", "typst"]
    );

    let cli =
      Cli::try_parse_from(["papyri", "ctl", "settings", "compilers", "--timeout", "900"]).unwrap();
    let Some(TopCommand::Ctl(CtlArgs { timeout, .. })) = cli.command else {
      panic!("expected ctl");
    };
    assert_eq!(timeout, Some(900.0));
  }

  #[test]
  fn clap_definition_is_valid() {
    Cli::command().debug_assert();
  }

  #[test]
  fn builds_a_focused_tab_list() {
    let state = json!({
      "active": "/notes.md",
      "tabs": [{ "path": "/notes.md", "kind": "markdown" }],
      "view": { "sidebar": true }
    });
    assert_eq!(
      tab_list_value(&state),
      json!({ "tabs": [{ "path": "/notes.md", "kind": "markdown" }] })
    );
    assert_eq!(tab_list_value(&json!({})), json!({ "tabs": [] }));
  }

  #[test]
  fn resolves_relative_socket_paths() {
    let resolved = socket_override(Path::new("control.sock")).unwrap();
    assert!(resolved.is_absolute());
    assert!(resolved.ends_with("control.sock"));
    assert!(socket_override(Path::new("")).is_err());
  }

  #[test]
  fn parses_aliases_and_theme_names() {
    let cli = Cli::try_parse_from(["papyri", "ctl", "status"]).unwrap();
    assert!(matches!(
      cli.command,
      Some(TopCommand::Ctl(CtlArgs {
        command: CtlCommand::State,
        ..
      }))
    ));

    let cli = Cli::try_parse_from(["papyri", "ctl", "tabs", "list"]).unwrap();
    assert!(matches!(
      cli.command,
      Some(TopCommand::Ctl(CtlArgs {
        command: CtlCommand::Tab(TabArgs {
          command: TabCommand::List
        }),
        ..
      }))
    ));

    let cli = Cli::try_parse_from(["papyri", "ctl", "fit", "on"]).unwrap();
    assert!(matches!(
      cli.command,
      Some(TopCommand::Ctl(CtlArgs {
        command: CtlCommand::FitWidth {
          action: Some(ToggleAction::On)
        },
        ..
      }))
    ));

    let cli = Cli::try_parse_from(["papyri", "ctl", "prefs", "get"]).unwrap();
    assert!(matches!(
      cli.command,
      Some(TopCommand::Ctl(CtlArgs {
        command: CtlCommand::Preferences(PreferencesArgs {
          command: PreferenceCommand::Get
        }),
        ..
      }))
    ));

    for name in ["latte", "light"] {
      let cli = Cli::try_parse_from(["papyri", "ctl", "theme", name]).unwrap();
      let Some(TopCommand::Ctl(CtlArgs {
        command: CtlCommand::Theme(ThemeArgs { theme }),
        ..
      })) = cli.command
      else {
        panic!("expected theme");
      };
      assert!(matches!(theme, ThemeArg::Light));
    }
  }
}

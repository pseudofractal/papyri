//! Per-user control socket used by the `papyri ctl` CLI and editor integrations.
//!
//! The socket carries newline-delimited JSON. Requests are forwarded to the
//! top-level host webview, which owns document and view state; a few methods
//! that only need the native window are handled here. Events are pushed to
//! subscribed connections as `{"event": "...", "data": ...}` lines.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
  collections::HashMap,
  fs,
  io::{BufRead, BufReader, Write},
  os::unix::{
    fs::{MetadataExt, PermissionsExt},
    net::{UnixListener, UnixStream},
  },
  path::{Path, PathBuf},
  sync::{
    atomic::{AtomicU64, Ordering},
    mpsc, Condvar, Mutex,
  },
  thread,
  time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};

/// Keep in sync with `CONTROL_PROTOCOL` in `src/lib/control.ts`.
pub const PROTOCOL_VERSION: u64 = 1;
pub const REQUEST_EVENT: &str = "papyri-control-request";
const MAX_REQUEST_BYTES: usize = 256 * 1024;
const MAX_EVENT_BYTES: usize = 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const RESPONSE_GRACE: Duration = Duration::from_secs(5);
const READY_TIMEOUT: Duration = Duration::from_secs(20);
const SUBSCRIBER_QUEUE: usize = 256;

#[derive(Debug, Deserialize, Serialize)]
pub struct Request {
  #[serde(default)]
  pub id: Value,
  pub method: String,
  #[serde(default)]
  pub params: Value,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Response {
  pub id: Value,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub result: Option<Value>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub error: Option<ProtocolError>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ProtocolError {
  pub code: String,
  pub message: String,
}

impl ProtocolError {
  fn new(code: &str, message: impl Into<String>) -> Self {
    Self {
      code: code.into(),
      message: message.into(),
    }
  }
}

impl std::fmt::Display for ProtocolError {
  fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    write!(formatter, "{}", self.message)
  }
}

impl std::error::Error for ProtocolError {}

#[derive(Debug)]
struct Reply {
  result: Option<Value>,
  error: Option<ProtocolError>,
}

impl Reply {
  fn success(result: Value) -> Self {
    Self {
      result: Some(result),
      error: None,
    }
  }

  fn failure(code: &str, message: impl Into<String>) -> Self {
    Self {
      result: None,
      error: Some(ProtocolError::new(code, message)),
    }
  }
}

struct Subscriber {
  connection: u64,
  events: Option<Vec<String>>,
  sender: mpsc::SyncSender<String>,
}

pub struct ControlState {
  pending: Mutex<HashMap<u64, mpsc::SyncSender<Reply>>>,
  subscribers: Mutex<Vec<Subscriber>>,
  next_request: AtomicU64,
  next_connection: AtomicU64,
  ready: Mutex<bool>,
  ready_signal: Condvar,
}

impl Default for ControlState {
  fn default() -> Self {
    Self {
      pending: Mutex::new(HashMap::new()),
      subscribers: Mutex::new(Vec::new()),
      next_request: AtomicU64::new(1),
      next_connection: AtomicU64::new(1),
      ready: Mutex::new(false),
      ready_signal: Condvar::new(),
    }
  }
}

impl ControlState {
  pub fn mark_ready(&self) {
    *self.ready.lock().unwrap() = true;
    self.ready_signal.notify_all();
  }

  fn is_ready(&self) -> bool {
    *self.ready.lock().unwrap()
  }

  fn wait_ready(&self, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    let mut ready = self.ready.lock().unwrap();
    while !*ready {
      let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
        return false;
      };
      let (guard, result) = self.ready_signal.wait_timeout(ready, remaining).unwrap();
      ready = guard;
      if result.timed_out() && !*ready {
        return false;
      }
    }
    true
  }

  fn take_reply(&self, id: u64) -> Option<mpsc::SyncSender<Reply>> {
    self.pending.lock().unwrap().remove(&id)
  }

  fn broadcast(&self, event: &str, line: String) -> usize {
    let mut subscribers = self.subscribers.lock().unwrap();
    // A subscriber that cannot keep up is dropped from the event stream rather
    // than blocking other clients or the app. It can reconnect and resubscribe.
    subscribers.retain(|subscriber| {
      if !event_matches(&subscriber.events, event) {
        return true;
      }
      subscriber.sender.try_send(line.clone()).is_ok()
    });
    subscribers.len()
  }
}

fn event_matches(filter: &Option<Vec<String>>, event: &str) -> bool {
  filter
    .as_ref()
    .is_none_or(|events| events.iter().any(|name| name == event))
}

pub fn socket_path() -> PathBuf {
  if let Some(value) = std::env::var_os("PAPYRI_CONTROL_SOCKET") {
    if !value.is_empty() {
      return PathBuf::from(value);
    }
  }
  if let Some(base) = std::env::var_os("XDG_RUNTIME_DIR")
    .filter(|value| !value.is_empty())
    .map(PathBuf::from)
  {
    return base.join("papyri").join("control.sock");
  }
  if let Some(base) = std::env::var_os("XDG_CACHE_HOME")
    .filter(|value| !value.is_empty())
    .map(PathBuf::from)
  {
    return base.join("papyri").join("control.sock");
  }
  if let Some(home) = std::env::var_os("HOME").filter(|value| !value.is_empty()) {
    return PathBuf::from(home)
      .join(".cache")
      .join("papyri")
      .join("control.sock");
  }
  // Last resort for stripped-down sessions. Include the uid so users cannot
  // collide in the shared temporary directory.
  let uid = fs::metadata("/proc/self")
    .map(|metadata| metadata.uid())
    .unwrap_or(0);
  std::env::temp_dir()
    .join(format!("papyri-{uid}"))
    .join("control.sock")
}

fn prepare_socket_path(path: &Path) -> Result<(), String> {
  let parent = path
    .parent()
    .ok_or_else(|| format!("Invalid control socket path: {}", path.display()))?;
  let existed = parent.exists();
  fs::create_dir_all(parent)
    .map_err(|error| format!("Could not create {}: {error}", parent.display()))?;
  if !existed {
    fs::set_permissions(parent, fs::Permissions::from_mode(0o700))
      .map_err(|error| format!("Could not secure {}: {error}", parent.display()))?;
  }
  Ok(())
}

/// Start the control socket. A stale socket from a crashed process is replaced.
pub fn start(app: AppHandle) -> Result<PathBuf, String> {
  let path = socket_path();
  prepare_socket_path(&path)?;
  if path.exists() {
    match UnixStream::connect(&path) {
      Ok(_) => return Err(format!("Another Papyri instance owns {}", path.display())),
      Err(error)
        if matches!(
          error.kind(),
          std::io::ErrorKind::NotFound | std::io::ErrorKind::ConnectionRefused
        ) =>
      {
        let _ = fs::remove_file(&path);
      }
      Err(error) => {
        return Err(format!(
          "Could not inspect the existing control socket at {}: {error}",
          path.display()
        ));
      }
    }
  }
  let listener = UnixListener::bind(&path)
    .map_err(|error| format!("Could not listen on {}: {error}", path.display()))?;
  fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
    .map_err(|error| format!("Could not secure {}: {error}", path.display()))?;
  let thread_app = app.clone();
  thread::Builder::new()
    .name("papyri-control".into())
    .spawn(move || {
      for stream in listener.incoming() {
        let Ok(stream) = stream else { break };
        let connection_app = thread_app.clone();
        let _ = thread::Builder::new()
          .name("papyri-control-client".into())
          .spawn(move || handle_connection(connection_app, stream));
      }
    })
    .map_err(|error| format!("Could not start the control listener: {error}"))?;
  Ok(path)
}

pub fn is_running() -> bool {
  UnixStream::connect(socket_path()).is_ok()
}

pub fn connect(wait: Duration) -> Result<UnixStream, String> {
  let path = socket_path();
  let deadline = Instant::now() + wait;
  loop {
    match UnixStream::connect(&path) {
      Ok(stream) => return Ok(stream),
      Err(error) if Instant::now() < deadline => {
        if error.kind() == std::io::ErrorKind::NotFound
          || error.kind() == std::io::ErrorKind::ConnectionRefused
        {
          thread::sleep(Duration::from_millis(50));
        } else {
          return Err(format!(
            "Could not connect to Papyri at {}: {error}",
            path.display()
          ));
        }
      }
      Err(error) => {
        return Err(format!(
          "Papyri is not running (no control socket at {}): {error}",
          path.display()
        ));
      }
    }
  }
}

pub fn send_request(stream: &mut UnixStream, request: &Request) -> Result<(), String> {
  let line = serde_json::to_string(request).map_err(|error| error.to_string())?;
  if line.len() > MAX_REQUEST_BYTES {
    return Err("Control request is too large.".into());
  }
  writeln!(stream, "{line}")
    .and_then(|()| stream.flush())
    .map_err(|error| format!("Could not write the control request: {error}"))
}

/// Send one request and wait for its response. Handles `ping` and `state`.
pub fn request(method: &str, params: Value, wait: Duration) -> Result<Value, ProtocolError> {
  let mut stream = connect(wait).map_err(|message| ProtocolError::new("unavailable", message))?;
  stream
    .set_read_timeout(Some(REQUEST_TIMEOUT + RESPONSE_GRACE))
    .map_err(|error| ProtocolError::new("io-error", error.to_string()))?;
  send_request(
    &mut stream,
    &Request {
      id: json!(1),
      method: method.to_string(),
      params,
    },
  )
  .map_err(|message| ProtocolError::new("io-error", message))?;
  let mut reader = BufReader::new(stream);
  let mut line = String::new();
  reader.read_line(&mut line).map_err(|error| {
    ProtocolError::new(
      "io-error",
      format!("Could not read the control response: {error}"),
    )
  })?;
  let response: Response = serde_json::from_str(line.trim()).map_err(|error| {
    ProtocolError::new(
      "protocol-error",
      format!("Invalid control response: {error}"),
    )
  })?;
  if let Some(error) = response.error {
    return Err(error);
  }
  Ok(response.result.unwrap_or(Value::Null))
}

fn handle_connection(app: AppHandle, stream: UnixStream) {
  let connection = app
    .state::<ControlState>()
    .next_connection
    .fetch_add(1, Ordering::Relaxed);
  // Responses use blocking sends so a full event queue cannot drop them.
  // Broadcast events use try_send instead, disconnecting slow subscribers.
  let (sender, receiver) = mpsc::sync_channel::<String>(SUBSCRIBER_QUEUE);
  let writer_stream = match stream.try_clone() {
    Ok(stream) => stream,
    Err(_) => return,
  };
  let writer = thread::Builder::new()
    .name("papyri-control-writer".into())
    .spawn(move || {
      let mut writer = writer_stream;
      for line in receiver {
        if writeln!(writer, "{line}")
          .and_then(|()| writer.flush())
          .is_err()
        {
          break;
        }
      }
    });
  let mut reader = BufReader::new(stream);
  let mut line = String::new();
  loop {
    line.clear();
    match reader.read_line(&mut line) {
      Ok(0) | Err(_) => break,
      Ok(_) => {}
    }
    if line.len() > MAX_REQUEST_BYTES {
      let _ = sender.send(response_line(
        Value::Null,
        Reply::failure(
          "request-too-large",
          format!("Control request exceeds {} KiB.", MAX_REQUEST_BYTES / 1024),
        ),
      ));
      break;
    }
    let request: Request = match serde_json::from_str(line.trim()) {
      Ok(request) => request,
      Err(error) => {
        let _ = sender.send(response_line(
          Value::Null,
          Reply::failure("bad-request", format!("Invalid JSON request: {error}")),
        ));
        continue;
      }
    };
    if request.id.is_null() {
      // Keep JSON-RPC-style clients working while still returning an id.
      let _ = sender.send(response_line(
        Value::Null,
        Reply::failure("bad-request", "Requests need an id."),
      ));
      continue;
    }
    match request.method.as_str() {
      "ping" => {
        let state = app.state::<ControlState>();
        let result = json!({
          "app": "papyri",
          "version": env!("CARGO_PKG_VERSION"),
          "protocol": PROTOCOL_VERSION,
          "pid": std::process::id(),
          "socket": socket_path().to_string_lossy(),
          "ready": state.is_ready(),
        });
        let _ = sender.send(response_line(request.id, Reply::success(result)));
      }
      "subscribe" => match parse_subscription(&request.params) {
        Ok(events) => {
          let reply = dispatch(&app, "state", json!({}));
          if let Some(error) = reply.error {
            let _ = sender.send(response_line(
              request.id,
              Reply {
                result: None,
                error: Some(error),
              },
            ));
            continue;
          }
          // Queue the response before registering so the first line a client
          // reads is always the subscription reply, not a concurrent event.
          let _ = sender.send(response_line(
            request.id,
            Reply::success(json!({
              "subscribed": true,
              "state": reply.result.unwrap_or(Value::Null),
            })),
          ));
          let state = app.state::<ControlState>();
          {
            let mut subscribers = state.subscribers.lock().unwrap();
            // Re-subscribing replaces the connection's filter instead of
            // delivering every matching event once per subscription.
            subscribers.retain(|subscriber| subscriber.connection != connection);
            subscribers.push(Subscriber {
              connection,
              events,
              sender: sender.clone(),
            });
          }
        }
        Err(error) => {
          let _ = sender.send(response_line(
            request.id,
            Reply {
              result: None,
              error: Some(error),
            },
          ));
        }
      },
      "unsubscribe" => {
        if let Ok(mut subscribers) = app.state::<ControlState>().subscribers.lock() {
          subscribers.retain(|subscriber| subscriber.connection != connection);
        }
        let _ = sender.send(response_line(
          request.id,
          Reply::success(json!({ "subscribed": false })),
        ));
      }
      "raise" => {
        let result = match app.get_webview_window("main") {
          Some(window) => {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
            Ok(json!({ "raised": true }))
          }
          None => Err("The main window is unavailable.".to_string()),
        };
        let reply = match result {
          Ok(value) => Reply::success(value),
          Err(message) => Reply::failure("window-unavailable", message),
        };
        let _ = sender.send(response_line(request.id, reply));
      }
      "quit" => {
        let readiness = dispatch(&app, "prepare-quit", json!({}));
        if readiness.error.is_some() {
          let _ = sender.send(response_line(request.id, readiness));
          continue;
        }
        let _ = sender.send(response_line(
          request.id,
          Reply::success(json!({ "quitting": true })),
        ));
        let app = app.clone();
        thread::spawn(move || {
          thread::sleep(Duration::from_millis(50));
          app.exit(0);
        });
        break;
      }
      _ => {
        let reply = dispatch(&app, &request.method, request.params);
        let _ = sender.send(response_line(request.id, reply));
      }
    }
  }
  if let Ok(mut subscribers) = app.state::<ControlState>().subscribers.lock() {
    subscribers.retain(|subscriber| subscriber.connection != connection);
  }
  drop(sender);
  if let Ok(writer) = writer {
    let _ = writer.join();
  }
}

fn parse_subscription(params: &Value) -> Result<Option<Vec<String>>, ProtocolError> {
  let Some(events) = params.get("events") else {
    return Ok(None);
  };
  if events.is_null() {
    return Ok(None);
  }
  let Value::Array(items) = events else {
    return Err(ProtocolError::new(
      "bad-params",
      "`events` must be an array of event names.",
    ));
  };
  if items.len() > 32 {
    return Err(ProtocolError::new(
      "bad-params",
      "At most 32 event names can be subscribed.",
    ));
  }
  let mut events = Vec::with_capacity(items.len());
  for item in items {
    let Some(name) = item.as_str() else {
      return Err(ProtocolError::new(
        "bad-params",
        "Event names must be strings.",
      ));
    };
    if name.is_empty() || name.len() > 64 {
      return Err(ProtocolError::new(
        "bad-params",
        "Event names must be 1-64 characters.",
      ));
    }
    events.push(name.to_string());
  }
  Ok(Some(events))
}

fn response_line(id: Value, reply: Reply) -> String {
  serde_json::to_string(&Response {
    id,
    result: reply.result,
    error: reply.error,
  })
  .unwrap_or_else(|_| {
    r#"{"id":null,"error":{"code":"serialization","message":"Could not encode the response."}}"#
      .into()
  })
}

fn unix_millis() -> u64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map_or(0, |duration| duration.as_millis() as u64)
}

fn dispatch(app: &AppHandle, method: &str, params: Value) -> Reply {
  if method.is_empty() || method.len() > 64 {
    return Reply::failure("bad-method", "Method names must be 1-64 characters.");
  }
  let state = app.state::<ControlState>();
  if !state.wait_ready(READY_TIMEOUT) {
    return Reply::failure(
      "not-ready",
      "The Papyri window is still starting or is unresponsive.",
    );
  }
  let request = state.next_request.fetch_add(1, Ordering::Relaxed);
  let (sender, receiver) = mpsc::sync_channel(1);
  state.pending.lock().unwrap().insert(request, sender);
  let deadline = unix_millis().saturating_add(REQUEST_TIMEOUT.as_millis() as u64);
  let event = json!({
    "id": request,
    "method": method,
    "params": params,
    "deadline": deadline,
  });
  if let Err(error) = app.emit_to("main", REQUEST_EVENT, event) {
    let _ = state.take_reply(request);
    return Reply::failure("window-unavailable", error.to_string());
  }
  match receiver.recv_timeout(REQUEST_TIMEOUT) {
    Ok(reply) => reply,
    Err(_) => {
      let _ = state.take_reply(request);
      Reply::failure(
        "timeout",
        format!(
          "Papyri did not respond to `{method}` within {} seconds.",
          REQUEST_TIMEOUT.as_secs()
        ),
      )
    }
  }
}

pub fn request_window_close(app: AppHandle) {
  thread::spawn(move || {
    let reply = dispatch(&app, "prepare-window-close", json!({}));
    if reply.error.is_none() {
      app.exit(0);
    }
  });
}

#[tauri::command]
pub fn control_ready(state: tauri::State<ControlState>) {
  state.mark_ready();
}

#[tauri::command]
pub fn control_respond(
  state: tauri::State<ControlState>,
  id: u64,
  ok: bool,
  result: Value,
  error: Option<String>,
) -> bool {
  let reply = if ok {
    Reply::success(result)
  } else {
    Reply::failure(
      "app-error",
      error.unwrap_or_else(|| "The Papyri window rejected the request.".into()),
    )
  };
  state
    .take_reply(id)
    .is_some_and(|sender| sender.send(reply).is_ok())
}

#[tauri::command]
pub fn control_emit(
  state: tauri::State<ControlState>,
  event: String,
  data: Value,
) -> Result<usize, String> {
  if event.is_empty()
    || event.len() > 64
    || !event
      .bytes()
      .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
  {
    return Err("Invalid control event name.".into());
  }
  let line = serde_json::to_string(&json!({ "event": event, "data": data }))
    .map_err(|error| error.to_string())?;
  if line.len() > MAX_EVENT_BYTES {
    return Err(format!(
      "Control event exceeds {} MiB.",
      MAX_EVENT_BYTES / (1024 * 1024)
    ));
  }
  Ok(state.broadcast(&event, line))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn matches_event_filters() {
    assert!(event_matches(&None, "state"));
    assert!(event_matches(
      &Some(vec!["state".to_string(), "headings".to_string()]),
      "headings"
    ));
    assert!(!event_matches(&Some(vec!["state".to_string()]), "headings"));
  }

  #[test]
  fn parses_subscription_filters() {
    let events = parse_subscription(&json!({ "events": ["state", "headings"] })).unwrap();
    assert_eq!(
      events,
      Some(vec!["state".to_string(), "headings".to_string()])
    );
    assert!(parse_subscription(&json!({})).unwrap().is_none());
    assert!(parse_subscription(&json!({ "events": "state" })).is_err());
    assert!(parse_subscription(&json!({ "events": [""] })).is_err());
    assert!(parse_subscription(&json!({ "events": vec!["x"; 33] })).is_err());
  }

  #[test]
  fn round_trips_requests_and_responses() {
    let request: Request = serde_json::from_str(r#"{"id":7,"method":"ping","params":{}}"#).unwrap();
    assert_eq!(request.method, "ping");
    assert_eq!(request.id, json!(7));
    let line = response_line(json!(7), Reply::success(json!({ "ok": true })));
    let response: Response = serde_json::from_str(&line).unwrap();
    assert_eq!(response.id, json!(7));
    assert_eq!(response.result, Some(json!({ "ok": true })));
    assert!(response.error.is_none());
  }

  #[test]
  fn reports_protocol_errors() {
    let line = response_line(
      json!("abc"),
      Reply::failure("app-error", "No document is open."),
    );
    let response: Response = serde_json::from_str(&line).unwrap();
    assert_eq!(response.id, json!("abc"));
    let error = response.error.unwrap();
    assert_eq!(error.code, "app-error");
    assert_eq!(error.message, "No document is open.");
  }
}

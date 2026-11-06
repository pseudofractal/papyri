//! Managed local language servers. Only the host may start or communicate with them.
use crate::lsp_protocol;
use serde::Serialize;
use std::{
  collections::HashMap,
  io::BufReader,
  path::Path,
  process::{Child, ChildStdin, Command, Stdio},
  sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex,
  },
  thread,
};
use tauri::ipc::Channel;

const MAX_SERVERS: usize = 8;

#[derive(Clone, Serialize)]
#[serde(tag = "type", content = "value", rename_all = "lowercase")]
pub enum ServerEvent {
  Message(String),
  Closed(String),
}

struct Server {
  child: Child,
  stdin: Arc<Mutex<ChildStdin>>,
}

impl Drop for Server {
  fn drop(&mut self) {
    let _ = self.child.kill();
    let _ = self.child.wait();
  }
}

#[derive(Default)]
pub struct ServerState {
  next_id: AtomicU64,
  servers: Mutex<HashMap<u64, Server>>,
}

fn server_command(language: &str) -> Result<(&'static str, &'static [&'static str]), String> {
  match language {
    "markdown" => Ok(("marksman", &["server"])),
    "typst" => Ok(("tinymist", &[])),
    "latex" => Ok(("texlab", &[])),
    _ => Err("Unsupported language server".into()),
  }
}

#[tauri::command]
pub fn lsp_start(
  state: tauri::State<'_, ServerState>,
  language: String,
  directory: String,
  events: Channel<ServerEvent>,
) -> Result<u64, String> {
  let (program, args) = server_command(&language)?;
  let directory = Path::new(&directory)
    .canonicalize()
    .map_err(|error| format!("Language server directory: {error}"))?;
  if !directory.is_dir() {
    return Err("Language server directory is not a directory".into());
  }
  let mut servers = state
    .servers
    .lock()
    .map_err(|_| "Language server state is unavailable")?;
  if servers.len() >= MAX_SERVERS {
    return Err("Too many language servers are running".into());
  }
  let mut child = Command::new(program)
    .args(args)
    .current_dir(directory)
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::null())
    .spawn()
    .map_err(|error| format!("Could not start {program}: {error}"))?;
  let stdin = child
    .stdin
    .take()
    .ok_or("Language server input is unavailable")?;
  let stdout = child
    .stdout
    .take()
    .ok_or("Language server output is unavailable")?;
  let id = state.next_id.fetch_add(1, Ordering::Relaxed) + 1;
  servers.insert(
    id,
    Server {
      child,
      stdin: Arc::new(Mutex::new(stdin)),
    },
  );
  thread::spawn(move || {
    let mut reader = BufReader::new(stdout);
    let reason = loop {
      match lsp_protocol::read_message(&mut reader) {
        Ok(Some(message)) => {
          if events.send(ServerEvent::Message(message)).is_err() {
            break "Editor disconnected".to_string();
          }
        }
        Ok(None) => break "Language server exited".to_string(),
        Err(error) => break format!("Language server output: {error}"),
      }
    };
    let _ = events.send(ServerEvent::Closed(reason));
  });
  Ok(id)
}

#[tauri::command]
pub async fn lsp_send(
  state: tauri::State<'_, ServerState>,
  id: u64,
  message: String,
) -> Result<(), String> {
  let stdin = {
    let servers = state
      .servers
      .lock()
      .map_err(|_| "Language server state is unavailable")?;
    Arc::clone(
      &servers
        .get(&id)
        .ok_or("Language server is not running")?
        .stdin,
    )
  };
  tauri::async_runtime::spawn_blocking(move || {
    let mut stdin = stdin
      .lock()
      .map_err(|_| "Language server input is unavailable")?;
    lsp_protocol::write_message(&mut *stdin, &message)
      .map_err(|error| format!("Could not send language server message: {error}"))
  })
  .await
  .map_err(|error| format!("Language server input task failed: {error}"))?
}

#[tauri::command]
pub fn lsp_stop(state: tauri::State<'_, ServerState>, id: u64) -> Result<(), String> {
  let server = state
    .servers
    .lock()
    .map_err(|_| "Language server state is unavailable")?
    .remove(&id);
  drop(server);
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn only_supported_servers_can_be_started() {
    assert_eq!(
      server_command("markdown").unwrap(),
      ("marksman", &["server"][..])
    );
    assert_eq!(server_command("typst").unwrap().0, "tinymist");
    assert_eq!(server_command("latex").unwrap().0, "texlab");
    assert!(server_command("../../bin/sh").is_err());
  }
}

//! Local control transport.
//!
//! Unix platforms use a per-user Unix stream socket. Windows has no Unix
//! domain sockets in the standard library, so the same newline-delimited JSON
//! protocol runs over a loopback TCP listener. The endpoint file carries both
//! the port and a per-process token; every request must present the token.

use std::{
  io,
  time::{Duration, Instant},
};

#[cfg(unix)]
mod imp {
  use super::*;
  use std::{
    fs,
    os::unix::{
      fs::{MetadataExt, PermissionsExt},
      net::{UnixListener, UnixStream},
    },
    path::{Path, PathBuf},
    thread,
  };

  pub type Connection = UnixStream;

  pub struct Listener(UnixListener);

  impl Listener {
    pub fn accept(&self) -> io::Result<Connection> {
      self.0.accept().map(|(stream, _)| stream)
    }
  }

  pub fn endpoint_path() -> PathBuf {
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
    if let Some(base) = crate::platform::cache_dir() {
      return base.join("papyri").join("control.sock");
    }
    // Last resort for stripped-down sessions. Include the uid so users cannot
    // collide in the shared temporary directory.
    let uid = fs::metadata("/proc/self")
      .map(|metadata| metadata.uid())
      .unwrap_or_else(|_| unsafe { libc::geteuid() });
    std::env::temp_dir()
      .join(format!("papyri-{uid}"))
      .join("control.sock")
  }

  pub fn prepare_endpoint(path: &Path) -> Result<(), String> {
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

  pub fn bind(path: &Path) -> Result<Listener, String> {
    let listener = UnixListener::bind(path)
      .map_err(|error| format!("Could not listen on {}: {error}", path.display()))?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
      .map_err(|error| format!("Could not secure {}: {error}", path.display()))?;
    Ok(Listener(listener))
  }

  pub fn connect(path: &Path, wait: Duration) -> Result<Connection, String> {
    let deadline = Instant::now() + wait;
    loop {
      match UnixStream::connect(path) {
        Ok(stream) => return Ok(stream),
        Err(error) if Instant::now() < deadline => {
          if error.kind() == io::ErrorKind::NotFound
            || error.kind() == io::ErrorKind::ConnectionRefused
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

  pub fn is_running(path: &Path) -> bool {
    UnixStream::connect(path).is_ok()
  }

  pub fn authorize(_token: Option<&str>) -> bool {
    true
  }

  pub fn request_token() -> Option<String> {
    None
  }
}

#[cfg(windows)]
mod imp {
  use super::*;
  use serde::{Deserialize, Serialize};
  use std::{
    fs,
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::OnceLock,
    thread,
  };

  pub type Connection = TcpStream;

  pub struct Listener(TcpListener);

  impl Listener {
    pub fn accept(&self) -> io::Result<Connection> {
      self.0.accept().map(|(stream, _)| stream)
    }
  }

  #[derive(Deserialize, Serialize)]
  struct Endpoint {
    port: u16,
    token: String,
  }

  static TOKEN: OnceLock<String> = OnceLock::new();

  pub fn endpoint_path() -> PathBuf {
    if let Some(value) = std::env::var_os("PAPYRI_CONTROL_SOCKET") {
      if !value.is_empty() {
        return PathBuf::from(value);
      }
    }
    crate::platform::cache_dir()
      .unwrap_or_else(std::env::temp_dir)
      .join("papyri")
      .join("control.json")
  }

  pub fn prepare_endpoint(path: &Path) -> Result<(), String> {
    let parent = path
      .parent()
      .ok_or_else(|| format!("Invalid control endpoint path: {}", path.display()))?;
    crate::platform::create_private_dir(parent)
      .map_err(|error| format!("Could not create {}: {error}", parent.display()))
  }

  fn random_token() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes)
      .map_err(|error| format!("Could not secure the control endpoint: {error}"))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
  }

  pub fn bind(path: &Path) -> Result<Listener, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
      .map_err(|error| format!("Could not listen for Papyri control requests: {error}"))?;
    let port = listener
      .local_addr()
      .map_err(|error| format!("Could not inspect the control listener: {error}"))?
      .port();
    let token = random_token()?;
    let endpoint = serde_json::to_vec(&Endpoint {
      port,
      token: token.clone(),
    })
    .map_err(|error| error.to_string())?;
    fs::write(path, endpoint)
      .map_err(|error| format!("Could not write {}: {error}", path.display()))?;
    let _ = TOKEN.set(token);
    Ok(Listener(listener))
  }

  fn read_endpoint(path: &Path) -> Result<Endpoint, String> {
    let bytes = fs::read(path).map_err(|error| {
      format!(
        "Papyri is not running (no control endpoint at {}): {error}",
        path.display()
      )
    })?;
    serde_json::from_slice(&bytes)
      .map_err(|error| format!("Invalid control endpoint {}: {error}", path.display()))
  }

  pub fn connect(path: &Path, wait: Duration) -> Result<Connection, String> {
    let endpoint = read_endpoint(path)?;
    let deadline = Instant::now() + wait;
    let address = format!("127.0.0.1:{}", endpoint.port);
    loop {
      match TcpStream::connect(address.as_str()) {
        Ok(stream) => {
          let _ = stream.set_nodelay(true);
          return Ok(stream);
        }
        Err(error) if Instant::now() < deadline => {
          if error.kind() == io::ErrorKind::ConnectionRefused
            || error.kind() == io::ErrorKind::NotFound
          {
            thread::sleep(Duration::from_millis(50));
          } else {
            return Err(format!("Could not connect to Papyri at {address}: {error}"));
          }
        }
        Err(error) => {
          return Err(format!("Papyri is not running at {address}: {error}"));
        }
      }
    }
  }

  pub fn is_running(path: &Path) -> bool {
    let Ok(endpoint) = read_endpoint(path) else {
      return false;
    };
    TcpStream::connect(("127.0.0.1", endpoint.port)).is_ok()
  }

  pub fn authorize(token: Option<&str>) -> bool {
    match (TOKEN.get(), token) {
      (Some(expected), Some(provided)) => expected == provided,
      _ => false,
    }
  }

  pub fn request_token() -> Option<String> {
    read_endpoint(&endpoint_path())
      .ok()
      .map(|endpoint| endpoint.token)
  }
}

#[cfg(not(any(unix, windows)))]
mod imp {
  use super::*;
  use std::path::Path;

  pub type Connection = std::io::Cursor<Vec<u8>>;

  pub struct Listener;

  impl Listener {
    pub fn accept(&self) -> io::Result<Connection> {
      Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "The control socket is unavailable on this platform",
      ))
    }
  }

  pub fn endpoint_path() -> PathBuf {
    std::env::temp_dir().join("papyri").join("control.sock")
  }

  pub fn prepare_endpoint(_path: &Path) -> Result<(), String> {
    Ok(())
  }

  pub fn bind(_path: &Path) -> Result<Listener, String> {
    Err("The control socket is unavailable on this platform.".into())
  }

  pub fn connect(_path: &Path, _wait: Duration) -> Result<Connection, String> {
    Err("The control socket is unavailable on this platform.".into())
  }

  pub fn is_running(_path: &Path) -> bool {
    false
  }

  pub fn authorize(_token: Option<&str>) -> bool {
    false
  }

  pub fn request_token() -> Option<String> {
    None
  }
}

pub use imp::{
  authorize, bind, connect, endpoint_path, is_running, prepare_endpoint, request_token,
};

#[allow(dead_code)]
pub type Connection = imp::Connection;

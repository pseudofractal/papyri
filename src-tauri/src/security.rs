use tauri::ipc::InvokeBody;
/// Capabilities cannot reliably distinguish Linux child frames; authenticate every host call too.
pub fn authorized(body: &InvokeBody, token: &str) -> bool {
  match body {
    InvokeBody::Json(value) => value.get("hostToken").and_then(|v| v.as_str()) == Some(token),
    _ => false,
  }
}
pub fn initialization(token: &str) -> String {
  let trace = std::env::var_os("PAPYRI_STARTUP_TRACE").is_some_and(|value| value == "1");
  let prewarm_markdown = std::env::args_os().nth(1).is_some_and(|argument| {
    let path = std::path::Path::new(&argument);
    path.is_file()
      && path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
          ["md", "markdown", "mdown", "mkd"]
            .iter()
            .any(|candidate| extension.eq_ignore_ascii_case(candidate))
        })
  });
  format!(
    r#"if (window.top === window.self && (location.protocol === 'tauri:' || ['http://tauri.localhost', 'https://tauri.localhost', 'http://localhost:1420', 'http://127.0.0.1:1420'].includes(location.origin))) {{ Object.defineProperty(window, '__PAPYRI_HOST_TOKEN__', {{ value: '{token}', writable: false, configurable: false }}); Object.defineProperty(window, '__PAPYRI_STARTUP_TRACE__', {{ value: {trace}, writable: false, configurable: false }}); Object.defineProperty(window, '__PAPYRI_PREWARM_MARKDOWN__', {{ value: {prewarm_markdown}, writable: false, configurable: false }}); }}"#
  )
}
#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn document_requests_cannot_bypass_host_authentication() {
    assert!(!authorized(
      &InvokeBody::Json(serde_json::json!({"path":"/secret.md"})),
      "session"
    ));
    assert!(!authorized(
      &InvokeBody::Json(serde_json::json!({"hostToken":"forged"})),
      "session"
    ));
    assert!(authorized(
      &InvokeBody::Json(serde_json::json!({"hostToken":"session"})),
      "session"
    ));
    assert!(!authorized(&InvokeBody::Raw(vec![]), "session"));
  }
}

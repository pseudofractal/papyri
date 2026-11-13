//! Shared log for the most recent LaTeX or Typst compilation.
use serde::Serialize;
use std::{
  collections::VecDeque,
  sync::{
    atomic::{AtomicU64, Ordering},
    Mutex, MutexGuard,
  },
  time::{Duration, Instant},
};

const MAX_LOG_LINES: usize = 400;
const MAX_LOG_LINE_CHARS: usize = 16 * 1024;
const MAX_ERROR_CHARS: usize = 32 * 1024;
// TeX page markers are sequential; allow a small jump when markers are skipped.
const MAX_PAGE_JUMP: u64 = 64;
// Reject implausible first markers such as bracketed dates or option values.
const MAX_INITIAL_PAGE: u64 = 1000;

/// Final state of a compilation.
pub enum CompileOutcome {
  Success,
  Failed(String),
  Cancelled,
}

/// Serializable view of the most recent compile log.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompileLogSnapshot {
  pub id: u64,
  pub path: String,
  pub engine: String,
  pub phase: String,
  pub detail: String,
  pub elapsed_seconds: f64,
  pub page: u64,
  pub total_pages: Option<u64>,
  pub log: Vec<String>,
  pub active: bool,
  pub success: bool,
  pub cancelled: bool,
  pub error: String,
}

struct State {
  id: u64,
  path: String,
  engine: String,
  phase: String,
  detail: String,
  started: Instant,
  elapsed: Duration,
  page: u64,
  total_pages: Option<u64>,
  log: VecDeque<String>,
  active: bool,
  success: bool,
  cancelled: bool,
  error: String,
}

static STATE: Mutex<Option<State>> = Mutex::new(None);
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

fn lock_state() -> MutexGuard<'static, Option<State>> {
  STATE
    .lock()
    .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Start a new compile log, replacing the previous one.
pub fn begin(path: String, engine: String) -> u64 {
  let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
  *lock_state() = Some(State {
    id,
    path,
    engine,
    phase: "Preparing".into(),
    detail: "Starting compile".into(),
    started: Instant::now(),
    elapsed: Duration::ZERO,
    page: 0,
    total_pages: None,
    log: VecDeque::new(),
    active: true,
    success: false,
    cancelled: false,
    error: String::new(),
  });
  id
}

/// Update the phase shown for compile `id`; superseded compiles are ignored.
pub fn phase(id: u64, phase: &str, detail: impl Into<String>) {
  let mut guard = lock_state();
  if let Some(state) = guard.as_mut().filter(|state| state.id == id) {
    state.phase = phase.into();
    state.detail = detail.into();
  }
}

/// Reset page progress when a new TeX pass starts.
pub fn reset_page(id: u64) {
  let mut guard = lock_state();
  if let Some(state) = guard.as_mut().filter(|state| state.id == id) {
    state.page = 0;
  }
}

fn advances_page(current: u64, marker: u64) -> bool {
  if current == 0 {
    return marker > 0 && marker <= MAX_INITIAL_PAGE;
  }
  marker > current && marker <= current.saturating_add(MAX_PAGE_JUMP)
}

/// Apply a TeX page marker when it advances the current pass without jumping backwards.
pub fn page_marker(id: u64, marker: u64) {
  let mut guard = lock_state();
  if let Some(state) = guard.as_mut().filter(|state| state.id == id) {
    if advances_page(state.page, marker) {
      state.page = marker;
    }
  }
}

/// Record the final page count for compile `id`.
pub fn total_pages(id: u64, total: u64) {
  let mut guard = lock_state();
  if let Some(state) = guard.as_mut().filter(|state| state.id == id) {
    state.total_pages = Some(total);
  }
}

/// Append a compiler output line, retaining only the newest lines.
pub fn line(id: u64, line: &str) {
  let line = line.trim_end_matches('\n').trim_end_matches('\r');
  if line.trim().is_empty() {
    return;
  }
  let line = if line.chars().count() > MAX_LOG_LINE_CHARS {
    let mut truncated: String = line.chars().take(MAX_LOG_LINE_CHARS).collect();
    truncated.push('…');
    truncated
  } else {
    line.to_string()
  };
  let mut guard = lock_state();
  if let Some(state) = guard.as_mut().filter(|state| state.id == id) {
    if !state.active {
      return;
    }
    state.log.push_back(line);
    while state.log.len() > MAX_LOG_LINES {
      state.log.pop_front();
    }
  }
}

/// Mark compile `id` finished and retain a bounded error message.
pub fn finish(id: u64, outcome: CompileOutcome) {
  let mut guard = lock_state();
  if let Some(state) = guard.as_mut().filter(|state| state.id == id) {
    state.active = false;
    state.elapsed = state.started.elapsed();
    let (success, cancelled, error, phase, detail) = match outcome {
      CompileOutcome::Success => (
        true,
        false,
        String::new(),
        "Complete",
        "Compilation finished",
      ),
      CompileOutcome::Failed(error) => (
        false,
        false,
        error.chars().take(MAX_ERROR_CHARS).collect(),
        "Failed",
        "Compilation failed",
      ),
      CompileOutcome::Cancelled => (
        false,
        true,
        String::new(),
        "Cancelled",
        "Compilation cancelled",
      ),
    };
    state.success = success;
    state.cancelled = cancelled;
    state.error = error;
    state.phase = phase.into();
    state.detail = detail.into();
  }
}

/// Return the most recent compile log, active or finished.
pub fn snapshot() -> Option<CompileLogSnapshot> {
  let state = lock_state();
  state.as_ref().map(|state| CompileLogSnapshot {
    id: state.id,
    path: state.path.clone(),
    engine: state.engine.clone(),
    phase: state.phase.clone(),
    detail: state.detail.clone(),
    elapsed_seconds: if state.active {
      state.started.elapsed().as_secs_f64()
    } else {
      state.elapsed.as_secs_f64()
    },
    page: state.page,
    total_pages: state.total_pages,
    log: state.log.iter().cloned().collect(),
    active: state.active,
    success: state.success,
    cancelled: state.cancelled,
    error: state.error.clone(),
  })
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn keeps_only_the_most_recent_compilation() {
    let stale = begin("/stale.tex".into(), "lualatex".into());
    line(stale, "stale output");
    let current = begin("/current.typ".into(), "typst".into());
    line(stale, "ignored output");
    line(current, "error: unknown variable: heading\n");
    line(current, "   ");
    page_marker(current, 2);
    page_marker(current, 100);
    total_pages(current, 2);
    finish(stale, CompileOutcome::Failed("stale failure".into()));
    finish(
      current,
      CompileOutcome::Failed("error: unknown variable: heading".into()),
    );

    let current_snapshot = snapshot().expect("compile log");
    assert_eq!(current_snapshot.id, current);
    assert_eq!(current_snapshot.path, "/current.typ");
    assert_eq!(current_snapshot.log, ["error: unknown variable: heading"]);
    assert_eq!(current_snapshot.page, 2);
    assert_eq!(current_snapshot.total_pages, Some(2));
    assert!(!current_snapshot.active);
    assert!(!current_snapshot.success);
    assert!(!current_snapshot.cancelled);
    assert_eq!(current_snapshot.phase, "Failed");
    assert_eq!(current_snapshot.error, "error: unknown variable: heading");

    let capped = begin("/long.tex".into(), "lualatex".into());
    for index in 0..MAX_LOG_LINES + 2 {
      line(capped, &format!("line {index}"));
    }
    let capped_snapshot = snapshot().expect("compile log");
    assert_eq!(capped_snapshot.log.len(), MAX_LOG_LINES);
    assert_eq!(
      capped_snapshot.log.first().map(String::as_str),
      Some("line 2")
    );

    let long = begin("/long-line.tex".into(), "lualatex".into());
    line(long, &"x".repeat(MAX_LOG_LINE_CHARS + 10));
    let long_snapshot = snapshot().expect("compile log");
    assert_eq!(long_snapshot.log[0].chars().count(), MAX_LOG_LINE_CHARS + 1);
    assert!(long_snapshot.log[0].ends_with('…'));

    let cancelled = begin("/cancelled.tex".into(), "lualatex".into());
    line(cancelled, "partial output");
    finish(cancelled, CompileOutcome::Cancelled);
    let cancelled_snapshot = snapshot().expect("compile log");
    assert!(!cancelled_snapshot.active);
    assert!(!cancelled_snapshot.success);
    assert!(cancelled_snapshot.cancelled);
    assert_eq!(cancelled_snapshot.phase, "Cancelled");
    assert!(cancelled_snapshot.error.is_empty());
  }

  #[test]
  fn page_markers_advance_without_jumping_backwards() {
    assert!(advances_page(0, 1));
    assert!(advances_page(0, 5));
    assert!(!advances_page(0, MAX_INITIAL_PAGE + 1));
    assert!(advances_page(3, 4));
    assert!(!advances_page(3, 3));
    assert!(!advances_page(3, 2));
    assert!(!advances_page(3, 1));
    assert!(!advances_page(3, 3 + MAX_PAGE_JUMP + 1));
  }
}

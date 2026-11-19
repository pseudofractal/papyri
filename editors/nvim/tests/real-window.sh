#!/usr/bin/env bash
# Opt-in smoke test for the real control API. Run it inside the Nix devshell:
#
#   PAPYRI_BINARY=$(nix build --print-out-paths .#papyri)/bin/papyri \
#     editors/nvim/tests/real-window.sh
#
# It starts Papyri under Xvfb, attaches a document, updates it, reveals a line,
# detaches, and quits. It never touches the user's control socket.
set -euo pipefail

if [[ -z "${DISPLAY:-}" && -z "${PAPYRI_SMOKE_XVFB:-}" ]]; then
  if command -v xvfb-run >/dev/null 2>&1; then
    exec env PAPYRI_SMOKE_XVFB=1 xvfb-run -a -s "-screen 0 1280x900x24" "$0" "$@"
  fi
  echo "real-window.sh: no DISPLAY and xvfb-run is unavailable" >&2
  exit 1
fi

binary=${PAPYRI_BINARY:-}
if [[ -z "$binary" ]]; then
  binary=$(command -v papyri || true)
fi
if [[ -z "$binary" || ! -x "$binary" ]]; then
  echo "real-window.sh: set PAPYRI_BINARY to a Papyri executable" >&2
  exit 1
fi

workdir=$(mktemp -d)
export PAPYRI_CONTROL_SOCKET="$workdir/control.sock"
export XDG_CONFIG_HOME="$workdir/config"
export XDG_DATA_HOME="$workdir/data"
export XDG_CACHE_HOME="$workdir/cache"
export XDG_STATE_HOME="$workdir/state"
export GDK_BACKEND=x11
export WEBKIT_DISABLE_COMPOSITING_MODE=1
export WEBKIT_DISABLE_DMABUF_RENDERER=1

pid=""
cleanup() {
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
  rm -rf "$workdir"
}
trap cleanup EXIT

cat >"$workdir/notes.md" <<'EOF'
# Title

First paragraph.

Second paragraph.
EOF

"$binary" --decorationless "$workdir/notes.md" >"$workdir/app.log" 2>&1 &
pid=$!

for _ in $(seq 1 150); do
  [[ -S "$PAPYRI_CONTROL_SOCKET" ]] && break
  sleep 0.1
done
if [[ ! -S "$PAPYRI_CONTROL_SOCKET" ]]; then
  echo "real-window.sh: Papyri did not create its control socket" >&2
  tail -40 "$workdir/app.log" >&2 || true
  exit 1
fi

ctl() { "$binary" ctl --socket "$PAPYRI_CONTROL_SOCKET" "$@"; }
attachment_active() {
  ctl state --json |
    python3 -c 'import json,sys; print(str(json.load(sys.stdin).get("attachment",{}).get("active",False)).lower())'
}

ctl ping --wait 10 >/dev/null
path="$workdir/notes.md"

ctl raw preview.attach "$(printf '{"owner":"smoke","path":"%s","documents":[{"path":"%s","text":"# Live draft\\n\\nAttached."}]}' "$path" "$path")" >/dev/null
state=$(ctl state --json)
if [[ "$(attachment_active)" != "true" ]]; then
  echo "real-window.sh: attachment was not reported" >&2
  echo "$state" >&2
  exit 1
fi

rendered=""
for _ in $(seq 1 50); do
  rendered=$(ctl dom query 'h1' --frame preview --json 2>/dev/null || true)
  grep -q 'Live draft' <<<"$rendered" && break
  sleep 0.2
done
if ! grep -q 'Live draft' <<<"$rendered"; then
  echo "real-window.sh: overlay heading did not render" >&2
  echo "$rendered" >&2
  exit 1
fi

ctl raw preview.update "$(printf '{"owner":"smoke","revision":1,"documents":[{"path":"%s","text":"# Live draft\\n\\nEdited."}]}' "$path")" >/dev/null
rendered=""
for _ in $(seq 1 50); do
  rendered=$(ctl dom query 'p' --frame preview --json 2>/dev/null || true)
  grep -q 'Edited.' <<<"$rendered" && break
  sleep 0.2
done
if ! grep -q 'Edited.' <<<"$rendered"; then
  echo "real-window.sh: overlay update did not render" >&2
  echo "$rendered" >&2
  exit 1
fi

ctl raw preview.reveal "$(printf '{"owner":"smoke","path":"%s","line":4,"align":"center"}' "$path")" >/dev/null

# The CLI does not send heartbeats; the lease must release the overlay.
released=""
for _ in $(seq 1 25); do
  state=$(ctl state --json)
  if [[ "$(attachment_active)" == "false" ]]; then
    released=1
    break
  fi
  sleep 1
done
if [[ -z "$released" ]]; then
  echo "real-window.sh: attachment lease did not expire" >&2
  echo "$state" >&2
  exit 1
fi

ctl raw preview.attach "$(printf '{"owner":"smoke","path":"%s","documents":[{"path":"%s","text":"# Live draft\\n\\nAttached again."}]}' "$path" "$path")" >/dev/null
ctl raw preview.detach '{"owner":"smoke"}' >/dev/null
state=$(ctl state --json)
if [[ "$(attachment_active)" != "false" ]]; then
  echo "real-window.sh: attachment was not released" >&2
  echo "$state" >&2
  exit 1
fi

ctl quit >/dev/null || true
echo "real-window.sh: preview attachment smoke passed"

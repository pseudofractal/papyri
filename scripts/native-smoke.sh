#!/usr/bin/env bash
# Run the native WebKit smoke test on a deterministic 96-DPI virtual display.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"

for tool in tauri-driver WebKitWebDriver xvfb-run python3; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "native-smoke: $tool is missing. Run this from 'nix develop'." >&2
    exit 1
  fi
done

export GDK_BACKEND=x11
export XDG_SESSION_TYPE=x11
export WAYLAND_DISPLAY=
export WEBKIT_DISABLE_COMPOSITING_MODE=1

exec xvfb-run -a -s "-screen 0 1600x1200x24 -dpi 96" python3 scripts/native-smoke.py "$@"

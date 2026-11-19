#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
exec nvim --headless -u NONE -l tests/run.lua

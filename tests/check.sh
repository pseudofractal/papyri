#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
stylua --check lua tests
luacheck lua tests
nvim --headless -u NONE -l tests/unit.lua
nvim --headless -u NONE -l tests/run.lua

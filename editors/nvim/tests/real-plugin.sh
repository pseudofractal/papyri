#!/usr/bin/env bash
# Opt-in end-to-end test: run the real Neovim plugin against a real Papyri
# window under Xvfb. Requires the plugin test dependencies from the devshell.
#
#   PAPYRI_BINARY=$(nix build --print-out-paths .#papyri)/bin/papyri \
#     editors/nvim/tests/real-plugin.sh
set -euo pipefail

if [[ -z "${DISPLAY:-}" && -z "${PAPYRI_SMOKE_XVFB:-}" ]]; then
  if command -v xvfb-run >/dev/null 2>&1; then
    exec env PAPYRI_SMOKE_XVFB=1 xvfb-run -a -s "-screen 0 1280x900x24" "$0" "$@"
  fi
  echo "real-plugin.sh: no DISPLAY and xvfb-run is unavailable" >&2
  exit 1
fi

binary=${PAPYRI_BINARY:-}
if [[ -z "$binary" ]]; then
  binary=$(command -v papyri || true)
fi
if [[ -z "$binary" || ! -x "$binary" ]]; then
  echo "real-plugin.sh: set PAPYRI_BINARY to a Papyri executable" >&2
  exit 1
fi

plugin_root=$(cd "$(dirname "$0")/.." && pwd)
workdir=$(mktemp -d)
export PAPYRI_CONTROL_SOCKET="$workdir/control.sock"
export XDG_CONFIG_HOME="$workdir/config"
export XDG_DATA_HOME="$workdir/data"
export XDG_CACHE_HOME="$workdir/cache"
export XDG_STATE_HOME="$workdir/state"
export PAPYRI_PLUGIN_ROOT="$plugin_root"
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
# Original title

First paragraph.
EOF

cat >"$workdir/main.typ" <<'EOF'
#let title = [Main]

#include "chapter.typ"
EOF

cat >"$workdir/chapter.typ" <<'EOF'
= Chapter

Original chapter text.
EOF

"$binary" --decorationless "$workdir/notes.md" >"$workdir/app.log" 2>&1 &
pid=$!

for _ in $(seq 1 150); do
  [[ -S "$PAPYRI_CONTROL_SOCKET" ]] && break
  sleep 0.1
done
if [[ ! -S "$PAPYRI_CONTROL_SOCKET" ]]; then
  echo "real-plugin.sh: Papyri did not create its control socket" >&2
  tail -40 "$workdir/app.log" >&2 || true
  exit 1
fi
"$binary" ctl --socket "$PAPYRI_CONTROL_SOCKET" ping --wait 10 >/dev/null

cat >"$workdir/test.lua" <<'EOF'
local root = vim.env.PAPYRI_PLUGIN_ROOT
package.path = root .. '/lua/?.lua;' .. root .. '/lua/?/init.lua;' .. package.path

local papyri = require('papyri')
local attach = require('papyri.attach')
local path = vim.env.PAPYRI_TEST_FILE
local messages = {}
vim.notify = function(message) table.insert(messages, message) end

papyri.setup({
  socket = vim.env.PAPYRI_CONTROL_SOCKET,
  auto_attach = false,
  launch = false,
  notify = false,
  debounce_ms = 0,
  takeover = 'always',
})

vim.cmd('edit ' .. vim.fn.fnameescape(path))
local bufnr = vim.api.nvim_get_current_buf()
vim.bo[bufnr].filetype = 'markdown'
vim.api.nvim_exec_autocmds('FileType', { buffer = bufnr })

attach.attach(bufnr, { quiet = true })
if not vim.wait(5000, function() return attach.status().attached end, 10) then
  error('plugin did not attach: ' .. table.concat(messages, '; '))
end

vim.api.nvim_buf_set_lines(bufnr, 0, -1, false, { '# Plugin hello', '', 'Live text.' })
attach.update_now()

local found = false
for _ = 1, 25 do
  local reply
  papyri.client:request('dom.query', { selector = 'h1', frame = 'preview' }, function(err, value)
    reply = { err = err, value = value }
  end)
  vim.wait(1000, function() return reply ~= nil end, 10)
  if reply and not reply.err and vim.inspect(reply.value):find('Plugin hello', 1, true) then
    found = true
    break
  end
  vim.wait(100)
end
if not found then error('the plugin overlay did not render in the preview') end

local revealed
papyri.client:request(
  'preview.reveal',
  { owner = attach.status().owner, path = path, line = 2, align = 'center' },
  function(err, value) revealed = { err = err, value = value } end
)
if not vim.wait(3000, function() return revealed ~= nil end, 10) then
  error('preview.reveal did not answer')
end
if revealed.err then error('preview.reveal failed: ' .. revealed.err) end

vim.api.nvim_win_set_cursor(0, { 1, 0 })
local paragraph
papyri.client:request('dom.query', { selector = 'p', frame = 'preview' }, function(err, value)
  paragraph = { err = err, value = value }
end)
if not vim.wait(3000, function() return paragraph ~= nil end, 10) then
  error('preview DOM query did not answer')
end
if paragraph.err or not paragraph.value or not paragraph.value.nodes or #paragraph.value.nodes == 0 then
  error('no preview paragraph to click')
end
local clicked
papyri.client:request('dom.click', { ref = paragraph.value.nodes[1].ref, frame = 'preview' }, function(err)
  clicked = { err = err }
end)
if not vim.wait(3000, function() return clicked ~= nil end, 10) then
  error('preview click did not answer')
end
if clicked.err then error('preview click failed: ' .. clicked.err) end
if not vim.wait(3000, function() return vim.api.nvim_win_get_cursor(0)[1] == 3 end, 10) then
  error('preview click did not move the cursor: ' .. vim.inspect(vim.api.nvim_win_get_cursor(0)))
end

local long_lines = { '# Live draft', '', 'Edited.', '' }
for index = 1, 100 do
  table.insert(long_lines, 'Paragraph ' .. index .. '.')
  table.insert(long_lines, '')
end
local long_text = table.concat(long_lines, '\n') .. '\n'
local updated
papyri.client:request('preview.update', {
  owner = attach.status().owner,
  revision = 2,
  documents = { { path = path, text = long_text } },
}, function(err) updated = { err = err } end)
if not vim.wait(5000, function() return updated ~= nil end, 10) then
  error('long preview update did not answer')
end
if updated.err then error('long preview update failed: ' .. updated.err) end

local long_visible = false
for _ = 1, 25 do
  local reply
  papyri.client:request('dom.query', { selector = 'p', frame = 'preview' }, function(err, value)
    reply = { err = err, value = value }
  end)
  vim.wait(1000, function() return reply ~= nil end, 10)
  if reply and not reply.err and vim.inspect(reply.value):find('Paragraph 30', 1, true) then
    long_visible = true
    break
  end
  vim.wait(100)
end
if not long_visible then error('long Markdown overlay did not render') end

local before_view = vim.fn.winsaveview().topline
attach.suppress_viewport_until = 0
local scrolled
papyri.client:request('scroll.to', { y = 600 }, function(err, value)
  scrolled = { err = err, value = value }
end)
if not vim.wait(5000, function() return scrolled ~= nil end, 10) then
  error('preview scroll did not answer')
end
if scrolled.err then error('preview scroll failed: ' .. scrolled.err) end
if not scrolled.value or scrolled.value.y == 0 then
  error('preview scroll returned y=0: ' .. vim.inspect(scrolled.value))
end
if not vim.wait(5000, function() return vim.fn.winsaveview().topline > before_view end, 10) then
  error('preview scroll did not move the Neovim viewport: topline ' .. vim.fn.winsaveview().topline)
end

local before_state
papyri.client:request('state', vim.empty_dict(), function(err, value) before_state = { err = err, value = value } end)
if not vim.wait(3000, function() return before_state ~= nil end, 10) then
  error('state query did not answer')
end
if before_state.err then error('state query failed: ' .. before_state.err) end
local before_y = 0
for _, tab in ipairs(before_state.value.tabs or {}) do
  if tab.path == path then before_y = tab.scroll end
end
vim.fn.winrestview({ topline = 20 })
attach.last_topline = nil
attach.suppress_scroll_sync_until = 0
attach.sync_viewport()
local moved = false
for _ = 1, 25 do
  local reply
  papyri.client:request('state', vim.empty_dict(), function(err, value) reply = { err = err, value = value } end)
  vim.wait(1000, function() return reply ~= nil end, 10)
  if reply and not reply.err then
    for _, tab in ipairs(reply.value.tabs or {}) do
      if tab.path == path and tab.scroll ~= before_y then moved = true end
    end
  end
  if moved then break end
  vim.wait(100)
end
if not moved then error('Neovim viewport scroll did not move the preview') end

attach.detach(false)
if not vim.wait(3000, function() return not attach.status().attached end, 10) then
  error('plugin did not detach')
end

vim.cmd('qa!')
EOF

PAPYRI_TEST_FILE="$workdir/notes.md" \
  PAPYRI_CONTROL_SOCKET="$PAPYRI_CONTROL_SOCKET" \
  PAPYRI_PLUGIN_ROOT="$plugin_root" \
  nvim --headless -u NONE -l "$workdir/test.lua"

cat >"$workdir/test-typst.lua" <<'EOF'
local root = vim.env.PAPYRI_PLUGIN_ROOT
package.path = root .. '/lua/?.lua;' .. root .. '/lua/?/init.lua;' .. package.path

local papyri = require('papyri')
local attach = require('papyri.attach')
local main = vim.env.PAPYRI_TEST_MAIN
local chapter = vim.env.PAPYRI_TEST_CHAPTER
local messages = {}
vim.notify = function(message) table.insert(messages, message) end

papyri.setup({
  socket = vim.env.PAPYRI_CONTROL_SOCKET,
  auto_attach = false,
  launch = false,
  notify = false,
  debounce_ms = 0,
  takeover = 'always',
})

vim.cmd('edit ' .. vim.fn.fnameescape(chapter))
local bufnr = vim.api.nvim_get_current_buf()
vim.bo[bufnr].filetype = 'typst'
vim.api.nvim_exec_autocmds('FileType', { buffer = bufnr })

attach.attach(bufnr, { quiet = true })
if not vim.wait(8000, function() return attach.status().attached end, 10) then
  error('typst attach failed: ' .. table.concat(messages, '; '))
end
local status = attach.status()
if status.kind ~= 'typst' then error('expected a Typst attachment') end
if status.root ~= main then error('typst root was ' .. tostring(status.root)) end
if not vim.tbl_contains(status.paths, chapter) then error('chapter path was not attached') end

vim.api.nvim_buf_set_lines(bufnr, 2, 3, false, { 'Live chapter text.' })
attach.update_now()

local mounted = false
for _ = 1, 25 do
  local reply
  papyri.client:request('dom.query', { selector = '.typst-live-preview iframe' }, function(err, value)
    reply = { err = err, value = value }
  end)
  vim.wait(1000, function() return reply ~= nil end, 10)
  if reply and not reply.err and reply.value and (reply.value.count or 0) > 0 then
    mounted = true
    break
  end
  vim.wait(100)
end
if not mounted then error('the Typst live pane did not start Tinymist') end

local revealed
papyri.client:request(
  'preview.reveal',
  { owner = attach.status().owner, path = chapter, line = 2, character = 0, align = 'center' },
  function(err, value) revealed = { err = err, value = value } end
)
if not vim.wait(5000, function() return revealed ~= nil end, 10) then
  error('typst preview.reveal did not answer')
end
if revealed.err then error('typst preview.reveal failed: ' .. revealed.err) end

attach.detach(false)
if not vim.wait(3000, function() return not attach.status().attached end, 10) then
  error('typst plugin did not detach')
end

vim.cmd('qa!')
EOF

PAPYRI_TEST_MAIN="$workdir/main.typ" \
  PAPYRI_TEST_CHAPTER="$workdir/chapter.typ" \
  PAPYRI_CONTROL_SOCKET="$PAPYRI_CONTROL_SOCKET" \
  PAPYRI_PLUGIN_ROOT="$plugin_root" \
  nvim --headless -u NONE -l "$workdir/test-typst.lua"

state=$("$binary" ctl --socket "$PAPYRI_CONTROL_SOCKET" state --json)
active=$(python3 -c 'import json,sys; print(str(json.load(sys.stdin).get("attachment",{}).get("active",False)).lower())' <<<"$state")
if [[ "$active" != "false" ]]; then
  echo "real-plugin.sh: plugin left an active attachment behind" >&2
  echo "$state" >&2
  exit 1
fi

"$binary" ctl --socket "$PAPYRI_CONTROL_SOCKET" quit >/dev/null || true
echo "real-plugin.sh: Neovim plugin smoke passed"

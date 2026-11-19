--- Plugin defaults and validation. Arrays are replaced, not index-merged.
local M = {}

M.defaults = {
  auto_attach = true,
  follow = true,
  follow_insert = false,
  debounce_ms = 120,
  launch = true,
  decorationless = true,
  takeover = 'prompt',
  papyri = 'papyri',
  socket = nil,
  root_markers = { '.git', 'typst.toml', 'package.json', 'Makefile' },
  ignore_globs = { '**/node_modules/**', '**/.git/**' },
  filetypes = { 'markdown', 'typst' },
  typst_main = 'main.typ',
  typst_root = nil,
  focus_command = nil,
  scroll_sync = true,
  scroll_debounce_ms = 80,
  max_bytes = 8 * 1024 * 1024,
  -- Keep in sync with MAX_ATTACHMENT_REQUEST_BYTES and MAX_REQUEST_BYTES.
  max_request_bytes = 31 * 1024 * 1024,
  notify = true,
}

local takeover_modes = { prompt = true, always = true, never = true }
local optional_options = { socket = true, typst_root = true, focus_command = true }

local function fail(message)
  error('papyri.nvim: ' .. message)
end

local function list(value, key)
  if type(value) ~= 'table' then
    fail('`' .. key .. '` must be a list')
  end
  for index, item in ipairs(value) do
    if type(item) ~= 'string' or item == '' then
      fail('`' .. key .. '[' .. index .. ']` must be a non-empty string')
    end
  end
end

function M.merge(opts)
  opts = opts or {}
  if type(opts) ~= 'table' then
    fail('setup() expects a table')
  end
  local config = vim.deepcopy(M.defaults)
  for key, value in pairs(opts) do
    if config[key] == nil and not optional_options[key] then
      fail('unknown option `' .. key .. '`')
    end
    config[key] = value
  end
  if type(config.auto_attach) ~= 'boolean' then
    fail('`auto_attach` must be a boolean')
  end
  if type(config.follow) ~= 'boolean' then
    fail('`follow` must be a boolean')
  end
  if type(config.follow_insert) ~= 'boolean' then
    fail('`follow_insert` must be a boolean')
  end
  if type(config.scroll_sync) ~= 'boolean' then
    fail('`scroll_sync` must be a boolean')
  end
  if type(config.launch) ~= 'boolean' then
    fail('`launch` must be a boolean')
  end
  if type(config.decorationless) ~= 'boolean' then
    fail('`decorationless` must be a boolean')
  end
  if type(config.notify) ~= 'boolean' then
    fail('`notify` must be a boolean')
  end
  if
    type(config.debounce_ms) ~= 'number'
    or config.debounce_ms < 0
    or config.debounce_ms > 5000
  then
    fail('`debounce_ms` must be between 0 and 5000')
  end
  if
    type(config.scroll_debounce_ms) ~= 'number'
    or config.scroll_debounce_ms < 0
    or config.scroll_debounce_ms > 5000
  then
    fail('`scroll_debounce_ms` must be between 0 and 5000')
  end
  if type(config.max_bytes) ~= 'number' or config.max_bytes < 1 then
    fail('`max_bytes` must be a positive number')
  end
  if type(config.max_request_bytes) ~= 'number' or config.max_request_bytes < 1024 then
    fail('`max_request_bytes` must be at least 1024')
  end
  if type(config.papyri) ~= 'string' or config.papyri == '' then
    fail('`papyri` must be the executable name or path')
  end
  if type(config.typst_main) ~= 'string' or config.typst_main == '' then
    fail('`typst_main` must be a file name')
  end
  if config.typst_root ~= nil and type(config.typst_root) ~= 'function' then
    fail('`typst_root` must be a function returning a path')
  end
  if
    config.focus_command ~= nil
    and type(config.focus_command) ~= 'string'
    and type(config.focus_command) ~= 'function'
  then
    fail('`focus_command` must be a shell command or a function')
  end
  if
    config.socket ~= nil
    and type(config.socket) ~= 'string'
    and type(config.socket) ~= 'function'
  then
    fail('`socket` must be a path or a function returning a path')
  end
  if not takeover_modes[config.takeover] then
    fail('`takeover` must be one of: prompt, always, never')
  end
  list(config.root_markers, 'root_markers')
  list(config.ignore_globs, 'ignore_globs')
  list(config.filetypes, 'filetypes')
  return config
end

return M

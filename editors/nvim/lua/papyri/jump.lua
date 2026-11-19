local paths = require('papyri.paths')

local M = {}

local markdown_extensions = { md = true, markdown = true, mdown = true, mkd = true }

local function is_markdown(path)
  local extension = path:lower():match('%.([^./]+)$')
  return extension ~= nil and markdown_extensions[extension] == true
end

local function byte_column(line, character)
  if character <= 0 then
    return 0
  end
  local target = math.floor(character)
  local ok, byte = pcall(vim.str_byteindex, line, 'utf-16', target, false)
  if ok and type(byte) == 'number' then
    return byte
  end
  local units, position = 0, 1
  while position <= #line do
    if units >= target then
      return position - 1
    end
    local first = line:byte(position)
    local length, width = 1, 1
    if first and first >= 0xF0 then
      length, width = 4, 2
    elseif first and first >= 0xE0 then
      length = 3
    elseif first and first >= 0xC0 then
      length = 2
    end
    if units + width > target then
      return position - 1
    end
    units = units + width
    position = position + length
  end
  return #line
end

--- Run the user's focus command, if configured.
function M.focus(command)
  if type(command) == 'function' then
    pcall(command)
    return
  end
  if type(command) == 'string' and command ~= '' then
    vim.fn.jobstart({ 'sh', '-c', command }, { detach = true })
  end
end

--- Open a preview jump target and place the cursor.
---
--- `options` supplies attachment ownership (`attached`, `owner`, `root`), the
--- configured focus command, and callbacks for suppression and attachment
--- bookkeeping. Returns the opened buffer and path, or nil when the event is
--- not valid for this attachment.
function M.open_source(data, options)
  if not options.attached or type(data) ~= 'table' then
    return nil
  end
  if data.owner ~= options.owner then
    return nil
  end
  if data.kind ~= 'markdown' and data.kind ~= 'typst' then
    return nil
  end
  if type(data.path) ~= 'string' or data.path == '' then
    return nil
  end
  if type(data.line) ~= 'number' or data.line < 0 then
    return nil
  end
  local path = paths.normalize(data.path)
  if not vim.uv.fs_stat(path) then
    return nil
  end
  if data.kind == 'typst' and not paths.typst_allowed(options.root, path) then
    return nil
  end
  if data.kind == 'markdown' and (path ~= options.root or not is_markdown(path)) then
    return nil
  end
  local bufnr = vim.fn.bufadd(path)
  if bufnr <= 0 then
    return nil
  end
  vim.fn.bufload(bufnr)
  if not vim.api.nvim_buf_is_valid(bufnr) then
    return nil
  end
  if options.on_before_open then
    options.on_before_open()
  end
  if vim.api.nvim_get_current_buf() ~= bufnr then
    vim.api.nvim_set_current_buf(bufnr)
  end
  if vim.bo[bufnr].filetype == '' then
    vim.bo[bufnr].filetype = data.kind
  end
  local line = math.min(math.max(0, math.floor(data.line)), vim.api.nvim_buf_line_count(bufnr) - 1)
  local body = vim.api.nvim_buf_get_lines(bufnr, line, line + 1, false)[1] or ''
  local column = 0
  if data.kind == 'typst' and type(data.character) == 'number' then
    column = byte_column(body, data.character)
  end
  vim.api.nvim_win_set_cursor(0, { line + 1, math.min(column, #body) })
  pcall(vim.cmd, 'normal! zz')
  if options.on_open then
    options.on_open(bufnr, path)
  end
  M.focus(options.focus_command)
  return bufnr, path
end

return M

local M = {}

--- Return the buffer's text and its byte length, preserving a final newline.
function M.buffer(bufnr)
  local lines = vim.api.nvim_buf_get_lines(bufnr, 0, -1, false)
  local text = table.concat(lines, '\n')
  if vim.bo[bufnr].eol and #lines > 0 then
    text = text .. '\n'
  end
  return text, #text
end

--- Return the normalized path for a buffer, or nil for an unnamed buffer.
function M.path(bufnr)
  local name = vim.api.nvim_buf_get_name(bufnr)
  if name == '' then
    return nil
  end
  return require('papyri.paths').normalize(name)
end

--- Convert a 0-based byte column to UTF-16 code units for control events.
function M.utf16_column(line, byte)
  if byte <= 0 then
    return 0
  end
  local index = math.min(byte, #line)
  local ok, units = pcall(vim.str_utfindex, line, 'utf-16', index)
  if ok and type(units) == 'number' then
    return units
  end
  local position, count = 1, 0
  while position <= index do
    local first = line:byte(position)
    local length = 1
    if first and first >= 0xF0 then
      length = 4
    elseif first and first >= 0xE0 then
      length = 3
    elseif first and first >= 0xC0 then
      length = 2
    end
    count = count + (length == 4 and 2 or 1)
    position = position + length
  end
  return count
end

--- Render a path compactly for notifications.
function M.display(path)
  return vim.fn.fnamemodify(path, ':~:.')
end

return M

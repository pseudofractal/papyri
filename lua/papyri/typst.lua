local paths = require('papyri.paths')
local text = require('papyri.text')

local M = {}

--- Collect the main file, the current buffer, and loaded Typst buffers under it.
function M.collect_paths(root, current, max_paths)
  local result = { root }
  local seen = { [root] = true }
  local function add(path)
    if #result >= max_paths then
      return
    end
    path = paths.normalize(path)
    if seen[path] or not paths.typst_allowed(root, path) then
      return
    end
    if not vim.uv.fs_stat(path) then
      return
    end
    seen[path] = true
    table.insert(result, path)
  end
  if current then
    add(current)
  end
  for _, bufnr in ipairs(vim.api.nvim_list_bufs()) do
    if vim.api.nvim_buf_is_loaded(bufnr) and vim.bo[bufnr].filetype == 'typst' then
      local path = text.path(bufnr)
      if path then
        add(path)
      end
    end
  end
  return result
end

--- Build overlays for modified Typst buffers, warning once per oversized path.
function M.documents(attached_paths, max_bytes, on_oversized)
  local result = {}
  for _, path in ipairs(attached_paths) do
    local bufnr = vim.fn.bufnr(path)
    if bufnr > 0 and vim.api.nvim_buf_is_loaded(bufnr) and vim.bo[bufnr].modified then
      local body, size = text.buffer(bufnr)
      if size <= max_bytes then
        table.insert(result, { path = path, text = body })
      elseif on_oversized then
        on_oversized(path)
      end
    end
  end
  return result
end

--- Add a Typst buffer to the attachment set, respecting the path limit.
function M.ensure_path(state, bufnr, max_paths, on_limit)
  if state.kind ~= 'typst' or not state.root then
    return nil
  end
  local path = text.path(bufnr)
  if not path or not paths.typst_allowed(state.root, path) then
    return nil
  end
  if not vim.tbl_contains(state.paths, path) then
    if #state.paths >= max_paths then
      if on_limit then
        on_limit()
      end
      return nil
    end
    table.insert(state.paths, path)
  end
  return path
end

return M

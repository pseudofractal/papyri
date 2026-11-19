local constants = require('papyri.constants')
local timer = require('papyri.timer')

local M = {}

--- Mirror the current Neovim viewport into the Markdown preview.
function M.sync(attach)
  if not attach.attached or attach.kind ~= 'markdown' or not attach.config.scroll_sync then
    return
  end
  if vim.uv.hrtime() < (attach.suppress_scroll_sync_until or 0) then
    return
  end
  if vim.api.nvim_get_current_buf() ~= attach.buf then
    return
  end
  local view = vim.fn.winsaveview()
  local top = view.topline
  if top == attach.last_topline then
    return
  end
  attach.last_topline = top
  attach.suppress_viewport_until = vim.uv.hrtime() + constants.SUPPRESS_NS
  attach.client:request('preview.reveal', {
    owner = attach.owner,
    path = attach.root,
    line = math.max(0, top - 1),
    character = 0,
    align = 'top',
  }, function() end)
end

--- Coalesce rapid `WinScrolled` events before mirroring.
function M.schedule(attach)
  if not attach.attached or attach.kind ~= 'markdown' or not attach.config.scroll_sync then
    return
  end
  attach.scroll_timer = timer.stop(attach.scroll_timer)
  if attach.config.scroll_debounce_ms == 0 then
    M.sync(attach)
    return
  end
  attach.scroll_timer = timer.after(attach.config.scroll_debounce_ms, function()
    M.sync(attach)
  end)
end

--- Apply a preview viewport event to Neovim without moving the cursor.
function M.on_event(attach, data)
  if not attach.attached or attach.kind ~= 'markdown' or not attach.config.scroll_sync then
    return
  end
  if type(data) ~= 'table' or data.owner ~= attach.owner or data.kind ~= 'markdown' then
    return
  end
  if data.path ~= attach.root then
    return
  end
  if type(data.line) ~= 'number' or data.line < 0 then
    return
  end
  if vim.uv.hrtime() < (attach.suppress_viewport_until or 0) then
    return
  end
  local win = vim.fn.bufwinid(attach.buf)
  if win == -1 then
    return
  end
  local top = math.max(1, math.floor(data.line) + 1)
  top = math.min(top, vim.api.nvim_buf_line_count(attach.buf))
  attach.suppress_scroll_sync_until = vim.uv.hrtime() + constants.SUPPRESS_NS
  attach.last_topline = top
  vim.api.nvim_win_call(win, function()
    vim.fn.winrestview({ topline = top })
  end)
end

return M

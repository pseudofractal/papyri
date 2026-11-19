local M = {}

--- Stop and close a timer handle, tolerating an already-closed handle.
function M.stop(timer)
  if not timer then
    return nil
  end
  pcall(function()
    if not timer:is_closing() then
      timer:stop()
      timer:close()
    end
  end)
  return nil
end

--- Run a callback once after a delay, on the main loop.
function M.after(delay_ms, callback)
  local timer = vim.uv.new_timer()
  timer:start(delay_ms, 0, function()
    M.stop(timer)
    vim.schedule(callback)
  end)
  return timer
end

--- Run a callback repeatedly on the main loop.
function M.every(interval_ms, callback)
  local timer = vim.uv.new_timer()
  timer:start(interval_ms, interval_ms, function()
    vim.schedule(callback)
  end)
  return timer
end

return M

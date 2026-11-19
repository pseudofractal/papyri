--- Newline-delimited JSON control client with request ids, timeouts,
--- subscriptions, and automatic reconnects.
local timer = require('papyri.timer')

local M = {}

local MAX_LINE_BYTES = 32 * 1024 * 1024
local RECONNECT_DELAY_MS = 1000

local function safe_call(self, callback, ...)
  if type(callback) ~= 'function' then
    return
  end
  local ok, err = pcall(callback, ...)
  if not ok then
    self.notify('Papyri callback failed: ' .. tostring(err), vim.log.levels.ERROR)
  end
end

local Socket = {}
Socket.__index = Socket

--- Create a client. Callers own reconnection policy through `on_connect` and
--- `on_disconnect`.
function M.new(options)
  return setmetatable({
    path = options.path,
    notify = options.notify or function() end,
    pipe = nil,
    connected = false,
    connecting = false,
    closed = false,
    buffer = '',
    next_id = 1,
    pending = {},
    waiters = {},
    queue = {},
    handlers = {},
    subscriptions = nil,
    on_connect = nil,
    on_disconnect = nil,
    on_state = nil,
    reconnect = true,
    reconnect_timer = nil,
    request_timeout_ms = options.request_timeout_ms or 15000,
    max_request_bytes = options.max_request_bytes or 32 * 1024 * 1024,
  }, Socket)
end

function Socket:on(event, callback)
  self.handlers[event] = self.handlers[event] or {}
  table.insert(self.handlers[event], callback)
  return self
end

function Socket:connect(callback)
  callback = callback or function() end
  if self.closed then
    callback('The Papyri connection is closed.')
    return
  end
  if self.connected then
    callback(nil)
    return
  end
  table.insert(self.waiters, callback)
  if self.connecting then
    return
  end
  self.connecting = true
  local pipe = vim.uv.new_pipe(false)
  self.pipe = pipe
  local ok, err = pcall(function()
    pipe:connect(self.path, function(connect_error)
      vim.schedule(function()
        self:finish_connect(pipe, connect_error)
      end)
    end)
  end)
  if not ok then
    self.connecting = false
    self.pipe = nil
    pcall(function()
      if not pipe:is_closing() then
        pipe:close()
      end
    end)
    self:release_waiters(err)
  end
end

function Socket:finish_connect(pipe, err)
  self.connecting = false
  if self.closed or self.pipe ~= pipe then
    pcall(function()
      if not pipe:is_closing() then
        pipe:close()
      end
    end)
    self:release_waiters('The Papyri connection was closed.')
    return
  end
  if self.connected then
    return
  end
  if err then
    self.pipe = nil
    pcall(function()
      if not pipe:is_closing() then
        pipe:close()
      end
    end)
    self:release_waiters(err)
    return
  end
  self.connected = true
  self.buffer = ''
  pipe:read_start(function(read_error, chunk)
    vim.schedule(function()
      self:read(read_error, chunk)
    end)
  end)
  self:release_waiters(nil)
  if self.on_connect then
    self.on_connect()
  end
  self:flush()
end

function Socket:release_waiters(err)
  local waiters = self.waiters
  self.waiters = {}
  for _, waiter in ipairs(waiters) do
    safe_call(self, waiter, err)
  end
end

function Socket:read(err, chunk)
  if err then
    self:disconnect(err)
    return
  end
  if not chunk then
    self:disconnect('Papyri closed the control connection.')
    return
  end
  self.buffer = self.buffer .. chunk
  while true do
    local newline = self.buffer:find('\n', 1, true)
    if not newline then
      break
    end
    local line = self.buffer:sub(1, newline - 1)
    self.buffer = self.buffer:sub(newline + 1)
    if line ~= '' then
      self:handle_line(line)
    end
  end
  if #self.buffer > MAX_LINE_BYTES then
    self:disconnect('Papyri sent an oversized control message.')
  end
end

function Socket:handle_line(line)
  local ok, message = pcall(vim.json.decode, line)
  if not ok or type(message) ~= 'table' then
    self.notify('Ignoring an invalid message from Papyri.', vim.log.levels.WARN)
    return
  end
  if message.error and (message.id == nil or message.id == vim.NIL) then
    local reason = message.error.message or 'The Papyri request failed.'
    if message.error.code == 'request-too-large' then
      self:fail_pending(reason, message.error)
    else
      self.notify(reason, vim.log.levels.WARN)
    end
    return
  end
  if message.id ~= nil then
    local entry = self.pending[message.id]
    if entry then
      self.pending[message.id] = nil
      timer.stop(entry.timer)
      if message.error then
        safe_call(
          self,
          entry.callback,
          message.error.message or 'The Papyri request failed.',
          nil,
          message.error
        )
      else
        safe_call(self, entry.callback, nil, message.result)
      end
    end
    return
  end
  if type(message.event) ~= 'string' then
    return
  end
  local handlers = self.handlers[message.event]
  if handlers then
    for _, handler in ipairs(handlers) do
      safe_call(self, handler, message.data)
    end
  end
  if message.event == 'state' and self.on_state then
    safe_call(self, self.on_state, message.data)
  end
end

--- Send a method and resolve exactly one response by id. Empty parameters
--- encode as a JSON object, not an array.
function Socket:request(method, params, callback, timeout_ms)
  callback = callback or function() end
  if self.closed then
    callback('The Papyri connection is closed.')
    return
  end
  if not self.connected then
    table.insert(self.queue, { method, params, callback, timeout_ms })
    self:connect(function(err)
      if err then
        self:fail_queued(err)
      end
    end)
    return
  end
  local id = self.next_id
  self.next_id = id + 1
  local payload = params
  if payload == nil or (type(payload) == 'table' and next(payload) == nil) then
    payload = vim.empty_dict()
  end
  local ok, line = pcall(vim.json.encode, {
    id = id,
    method = method,
    params = payload,
  })
  if not ok then
    callback('Could not encode the Papyri request.')
    return
  end
  if #line > self.max_request_bytes then
    callback('The Papyri request exceeds the control transport limit.')
    return
  end
  local timeout
  timeout = timer.after(timeout_ms or self.request_timeout_ms, function()
    if not self.pending[id] then
      return
    end
    self.pending[id] = nil
    callback('Papyri did not respond to `' .. method .. '` in time.')
  end)
  self.pending[id] = { callback = callback, timer = timeout, method = method }
  local written, write_error = self.pipe:write(line .. '\n')
  if not written then
    self.pending[id] = nil
    timer.stop(timeout)
    callback('Could not write to Papyri: ' .. tostring(write_error))
  end
end

function Socket:flush()
  if not self.connected then
    return
  end
  local queued = self.queue
  self.queue = {}
  for _, item in ipairs(queued) do
    self:request(item[1], item[2], item[3], item[4])
  end
end

function Socket:fail_queued(reason, info)
  local queued = self.queue
  self.queue = {}
  for _, item in ipairs(queued) do
    safe_call(self, item[3], reason, nil, info)
  end
end

function Socket:fail_pending(reason, info)
  local pending = self.pending
  self.pending = {}
  for _, entry in pairs(pending) do
    timer.stop(entry.timer)
    safe_call(self, entry.callback, reason, nil, info)
  end
  self:fail_queued(reason, info)
end

--- Subscribe to event names and receive the initial state in the callback.
function Socket:subscribe(events, callback)
  self.subscriptions = events
  self:request('subscribe', { events = events }, function(err, result)
    if not err and result and self.on_state then
      self.on_state(result.state)
    end
    if callback then
      callback(err, result)
    end
  end)
end

function Socket:disconnect(reason)
  if not self.connected then
    return
  end
  self.connected = false
  self.buffer = ''
  local pipe = self.pipe
  self.pipe = nil
  if pipe then
    pcall(function()
      if not pipe:is_closing() then
        pipe:close()
      end
    end)
  end
  self:fail_pending(reason or 'Papyri disconnected.')
  if self.on_disconnect then
    self.on_disconnect(reason)
  end
  if self.reconnect and not self.closed then
    self:schedule_reconnect()
  end
end

function Socket:schedule_reconnect()
  if self.reconnect_timer or self.closed then
    return
  end
  self.reconnect_timer = timer.after(RECONNECT_DELAY_MS, function()
    self.reconnect_timer = nil
    self:connect(function(err)
      if err and self.reconnect and not self.closed then
        self:schedule_reconnect()
      end
    end)
  end)
end

function Socket:close()
  self.closed = true
  self.reconnect = false
  timer.stop(self.reconnect_timer)
  self.reconnect_timer = nil
  self.connected = false
  self.connecting = false
  self.buffer = ''
  local pipe = self.pipe
  self.pipe = nil
  if pipe then
    pcall(function()
      if not pipe:is_closing() then
        pipe:close()
      end
    end)
  end
  self:fail_pending('The Papyri connection was closed.')
  self:fail_queued('The Papyri connection was closed.')
  self:release_waiters('The Papyri connection was closed.')
end

return M

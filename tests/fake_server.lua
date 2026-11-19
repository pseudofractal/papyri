local M = {}

M.no_reply = {}

local Server = {}
Server.__index = Server

local inactive = {
  active = false,
  owner = nil,
  kind = nil,
  root = nil,
  paths = {},
  revision = 0,
}

local function copy(value)
  return vim.deepcopy(value)
end

function M.new(handlers, path)
  path = path or (vim.fn.tempname() .. '.sock')
  return setmetatable({
    path = path,
    handlers = handlers or {},
    requests = {},
    clients = {},
    state = {
      protocol = 1,
      features = { 'preview.attach', 'preview.detach', 'preview.update', 'preview.reveal' },
      active = nil,
      attachment = copy(inactive),
    },
    pipe = vim.uv.new_pipe(false),
  }, Server)
end

function Server:start()
  self.pipe:bind(self.path)
  self.pipe:listen(16, function(err)
    if err then
      self.error = err
      return
    end
    local pipe = vim.uv.new_pipe(false)
    self.pipe:accept(pipe)
    local connection = { pipe = pipe, buffer = '', subscribed = false }
    self.clients[connection] = true
    pipe:read_start(function(read_error, chunk)
      if read_error or not chunk then
        self.clients[connection] = nil
        pcall(function()
          if not pipe:is_closing() then
            pipe:close()
          end
        end)
        return
      end
      connection.buffer = connection.buffer .. chunk
      while true do
        local newline = connection.buffer:find('\n', 1, true)
        if not newline then
          break
        end
        local line = connection.buffer:sub(1, newline - 1)
        connection.buffer = connection.buffer:sub(newline + 1)
        if line ~= '' then
          self:handle(connection, line)
        end
      end
    end)
  end)
  return self
end

function Server.respond(_, connection, id, result)
  connection.pipe:write(vim.json.encode({ id = id, result = result }) .. '\n')
end

function Server.fail(_, connection, id, message)
  connection.pipe:write(
    vim.json.encode({ id = id, error = { code = 'app-error', message = message } }) .. '\n'
  )
end

function Server:handle(connection, line)
  local ok, message = pcall(vim.json.decode, line)
  if not ok or type(message) ~= 'table' then
    return
  end
  message.raw = line
  table.insert(self.requests, message)
  local handler = self.handlers[message.method]
  if handler then
    local result, err = handler(message.params or {}, message, self)
    if result == M.no_reply and not err then
      return
    end
    if err then
      self:fail(connection, message.id, err)
    else
      self:respond(connection, message.id, result)
    end
    return
  end
  if message.method == 'subscribe' then
    connection.subscribed = true
    self:respond(connection, message.id, { subscribed = true, state = copy(self.state) })
    return
  end
  if message.method == 'state' then
    self:respond(connection, message.id, copy(self.state))
    return
  end
  if message.method == 'preview.attach' then
    local params = message.params or {}
    if
      self.state.attachment.active
      and self.state.attachment.owner ~= params.owner
      and not params.takeover
    then
      self:fail(
        connection,
        message.id,
        'The preview is attached to '
          .. tostring(self.state.attachment.owner)
          .. '. Take it over to replace it.'
      )
      return
    end
    self.state.active = params.path
    self.state.attachment = {
      active = true,
      owner = params.owner,
      kind = params.kind or 'markdown',
      root = params.path,
      paths = params.paths or { params.path },
      revision = 0,
    }
    self:respond(connection, message.id, copy(self.state))
    return
  end
  if message.method == 'preview.update' then
    local params = message.params or {}
    if not self.state.attachment.active or self.state.attachment.owner ~= params.owner then
      self:fail(connection, message.id, 'No matching preview attachment.')
      return
    end
    for _, document in ipairs(params.documents or {}) do
      if not vim.tbl_contains(self.state.attachment.paths, document.path) then
        table.insert(self.state.attachment.paths, document.path)
      end
    end
    self.state.attachment.revision = params.revision
    self:respond(connection, message.id, copy(self.state))
    return
  end
  if message.method == 'preview.detach' then
    self.state.attachment = copy(inactive)
    self:respond(connection, message.id, copy(self.state))
    return
  end
  if message.method == 'preview.reveal' then
    local params = message.params or {}
    if not vim.tbl_contains(self.state.attachment.paths or {}, params.path) then
      self:fail(connection, message.id, 'Not attached: ' .. tostring(params.path))
      return
    end
    self:respond(connection, message.id, {
      path = params.path,
      line = params.line,
      character = params.character,
      align = params.align,
      y = 42,
      skipped = false,
    })
    return
  end
  self:respond(connection, message.id, { ok = true })
end

function Server:emit(event, data)
  local line = vim.json.encode({ event = event, data = data }) .. '\n'
  for connection in pairs(self.clients) do
    if connection.subscribed then
      connection.pipe:write(line)
    end
  end
end

function Server:methods()
  local methods = {}
  for _, request in ipairs(self.requests) do
    table.insert(methods, request.method)
  end
  return methods
end

function Server:find(method, start_index)
  start_index = start_index or 1
  for index = start_index, #self.requests do
    if self.requests[index].method == method then
      return self.requests[index], index
    end
  end
  return nil, nil
end

function Server:stop()
  for connection in pairs(self.clients) do
    pcall(function()
      if not connection.pipe:is_closing() then
        connection.pipe:close()
      end
    end)
  end
  self.clients = {}
  pcall(function()
    if not self.pipe:is_closing() then
      self.pipe:close()
    end
  end)
  pcall(vim.uv.fs_unlink, self.path)
end

return M

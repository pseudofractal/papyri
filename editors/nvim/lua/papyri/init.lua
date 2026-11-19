local config_module = require('papyri.config')
local paths = require('papyri.paths')
local socket = require('papyri.socket')
local attach = require('papyri.attach')

--- User-facing commands, Lua API, and control connection lifecycle.
local M = {}

local function notify(message, level, force)
  level = level or vim.log.levels.INFO
  if M.config and not M.config.notify and not force and level < vim.log.levels.WARN then
    return
  end
  vim.notify(message, level, { title = 'papyri.nvim' })
end

local function parse_toggle(value, name)
  if value == nil or value == '' or value == 'toggle' then
    return nil
  end
  if value == 'on' or value == 'true' then
    return true
  end
  if value == 'off' or value == 'false' then
    return false
  end
  error('papyri.nvim: ' .. name .. ' expects on, off, or toggle')
end

local function visual_selection()
  local start = vim.fn.getpos("'<")
  local finish = vim.fn.getpos("'>")
  if start[2] == 0 or finish[2] == 0 then
    return ''
  end
  local lines = vim.fn.getline(start[2], finish[2])
  if type(lines) == 'string' then
    lines = { lines }
  end
  if #lines == 0 then
    return ''
  end
  lines[1] = lines[1]:sub(start[3])
  lines[#lines] = lines[#lines]:sub(1, finish[3])
  return table.concat(lines, '\n')
end

function M.ensure_connection(callback, path, allow_launch)
  callback = callback or function() end
  if allow_launch == nil then
    allow_launch = true
  end
  if M.client.connected then
    callback(nil)
    return
  end
  M.client:connect(function(err)
    if not err then
      M.disconnect_notified = false
      callback(nil)
      return
    end
    if not allow_launch or not M.config.launch then
      callback(err)
      return
    end
    M.launch(path, callback)
  end)
end

function M.launch(path, callback)
  if M.launching then
    table.insert(M.launch_waiters, callback)
    return
  end
  if vim.fn.executable(M.config.papyri) == 0 then
    callback('`' .. M.config.papyri .. '` was not found on PATH')
    return
  end
  local function finish(err)
    M.launching = false
    local waiters = M.launch_waiters
    M.launch_waiters = {}
    if not err then
      M.disconnect_notified = false
    end
    callback(err)
    for _, waiter in ipairs(waiters) do
      waiter(err)
    end
  end
  M.launching = true
  local command = { M.config.papyri }
  if M.config.decorationless then
    table.insert(command, '--decorationless')
  end
  if path and path ~= '' then
    table.insert(command, path)
  end
  local job = vim.fn.jobstart(command, {
    detach = true,
    env = { PAPYRI_CONTROL_SOCKET = M.client.path },
  })
  if job <= 0 then
    finish('Could not launch Papyri.')
    return
  end
  local started = vim.wait(7000, function()
    return vim.uv.fs_stat(M.client.path) ~= nil
  end, 50)
  if not started then
    finish('Papyri did not create its control socket in time.')
    return
  end
  M.client:connect(finish)
end

--- Send one control method, connecting or launching Papyri when allowed.
function M.request(method, params, callback, allow_launch)
  params = params or {}
  M.ensure_connection(function(err)
    if err then
      notify('Papyri is unavailable: ' .. err, vim.log.levels.ERROR)
      return
    end
    M.client:request(method, params, function(request_error, result)
      if request_error then
        notify('Papyri `' .. method .. '` failed: ' .. request_error, vim.log.levels.ERROR)
        return
      end
      if callback then
        callback(result)
      end
    end)
  end, params.path, allow_launch)
end

function M.open(path)
  path = paths.normalize(path or vim.api.nvim_buf_get_name(0))
  if path == '' then
    notify('Save the buffer before opening it in Papyri.', vim.log.levels.WARN)
    return
  end
  local bufnr = vim.api.nvim_get_current_buf()
  local attach_path = paths.attachable_path(bufnr, M.config)
  if attach_path == path then
    attach.attach(bufnr, { quiet = false, reveal = true })
    return
  end
  M.request('open', { path = path })
end

--- Preview the current Typst buffer as its own root instead of main.typ.
function M.root()
  local bufnr = vim.api.nvim_get_current_buf()
  if vim.bo[bufnr].filetype ~= 'typst' then
    notify(':Papyri root needs a Typst buffer.', vim.log.levels.WARN)
    return
  end
  local path = paths.attachable_path(bufnr, M.config)
  if not path then
    notify('Save the buffer inside a project before using :Papyri root.', vim.log.levels.WARN)
    return
  end
  attach.attach(bufnr, { quiet = false, reveal = true, force = true, root = path })
end

function M.close()
  local status = attach.status()
  if status.attached and (status.root or status.path) then
    local path = status.root or status.path
    attach.detach(false)
    M.request('close', { path = path }, nil, false)
    return
  end
  M.request('close', {}, nil, false)
end

function M.toggle()
  if attach.status().attached then
    M.close()
  else
    M.open()
  end
end

function M.detach()
  attach.detach(false)
end

function M.reveal()
  attach.reveal(true)
end

function M.follow(value)
  attach.toggle_follow(parse_toggle(value, 'follow'))
end

function M.status()
  local state = attach.status()
  local connection = M.client and M.client.connected and 'connected' or 'disconnected'
  local parts = { 'papyri: ' .. connection }
  if state.attached and state.path then
    table.insert(parts, 'kind=' .. state.kind)
    table.insert(parts, 'root=' .. (state.root or state.path))
    if state.kind == 'typst' and state.path ~= state.root then
      table.insert(parts, 'buffer=' .. state.path)
    end
  else
    table.insert(parts, 'attached=no')
  end
  table.insert(parts, 'follow=' .. (state.follow and 'on' or 'off'))
  table.insert(parts, 'scroll=' .. (state.scroll and 'on' or 'off'))
  if state.owner then
    table.insert(parts, 'owner=' .. state.owner)
  end
  return table.concat(parts, ' ')
end

function M.raw(method, json)
  if type(method) ~= 'string' or method == '' then
    notify('Papyri needs a method name.', vim.log.levels.ERROR)
    return
  end
  local params = {}
  if json and json ~= '' then
    local ok, decoded = pcall(vim.json.decode, json)
    if not ok or type(decoded) ~= 'table' or vim.islist(decoded) then
      notify('Papyri raw parameters must be a JSON object.', vim.log.levels.ERROR)
      return
    end
    params = decoded
  end
  M.request(method, params, function(result)
    notify('Papyri `' .. method .. '`: ' .. vim.inspect(result), vim.log.levels.INFO, true)
  end)
end

function M.shutdown()
  if M.client then
    attach.shutdown()
    M.client:close()
  end
end

function M.start()
  M.ensure_connection(function(err)
    if err then
      notify('Papyri is unavailable: ' .. err, vim.log.levels.ERROR)
      return
    end
    notify('Papyri is connected.', vim.log.levels.INFO, true)
  end)
end

function M.scroll_sync(value)
  attach.toggle_scroll_sync(parse_toggle(value, 'scroll sync'))
end

function M.takeover()
  local bufnr = vim.api.nvim_get_current_buf()
  if not paths.attachable_path(bufnr, M.config) then
    notify('This buffer is not attachable.', vim.log.levels.WARN)
    return
  end
  attach.attach(bufnr, { quiet = false, takeover = true, force = true })
end

function M.tabs()
  M.request('state', {}, function(state)
    local tabs = state and state.tabs or {}
    if #tabs == 0 then
      notify('Papyri has no open tabs.', vim.log.levels.WARN)
      return
    end
    local items = {}
    for _, tab in ipairs(tabs) do
      table.insert(items, {
        path = tab.path,
        label = (tab.active and '* ' or '  ') .. vim.fn.fnamemodify(tab.path, ':~:.'),
      })
    end
    vim.ui.select(items, {
      prompt = 'Papyri tabs',
      format_item = function(item)
        return item.label
      end,
    }, function(choice)
      if choice then
        M.request('tab.activate', { path = choice.path })
      end
    end)
  end)
end

function M.outline()
  M.request('headings', {}, function(result)
    local headings = result and result.headings or {}
    if #headings == 0 then
      notify('The active document has no headings yet.', vim.log.levels.WARN)
      return
    end
    local items = {}
    for _, heading in ipairs(headings) do
      table.insert(items, {
        id = heading.id,
        label = string.rep('  ', math.max(0, (heading.level or 1) - 1)) .. heading.text,
      })
    end
    vim.ui.select(items, {
      prompt = 'Papyri outline',
      format_item = function(item)
        return item.label
      end,
    }, function(choice)
      if choice then
        M.request('heading', { id = choice.id })
      end
    end)
  end)
end

function M.search(value)
  value = value or ''
  if value == '' then
    local selected = visual_selection()
    if selected ~= '' then
      value = selected
    else
      value = vim.fn.input('Papyri search: ')
    end
  end
  if value == '' then
    return
  end
  M.request('search', { query = value })
end

function M.zoom(value)
  value = value or ''
  local params = { target = 'document' }
  if value == 'in' or value == 'out' or value == 'reset' then
    params.action = value
  elseif value:match('^%d+$') then
    params.value = tonumber(value)
  else
    notify('Usage: :Papyri zoom [in|out|reset|PERCENT]', vim.log.levels.WARN)
    return
  end
  M.request('zoom', params)
end

function M.theme(value)
  value = (value == nil or value == '') and 'toggle' or value
  if not vim.tbl_contains({ 'latte', 'mocha', 'toggle' }, value) then
    notify('Usage: :Papyri theme [latte|mocha|toggle]', vim.log.levels.WARN)
    return
  end
  M.request('theme', { theme = value })
end

function M.decorationless(value)
  M.request('decorationless', { enabled = parse_toggle(value, 'decorationless') })
end

function M.live(value)
  M.request('live-preview', { enabled = parse_toggle(value, 'live preview') })
end

local function command(name, callback, options)
  options = options or {}
  options.force = true
  vim.api.nvim_create_user_command(name, callback, options)
end

--- Install commands and autocommands. Setup is required before use.
function M.setup(options)
  if M.client then
    attach.shutdown()
    M.client:close()
  end
  M.config = config_module.merge(options)
  M.launching = false
  M.launch_waiters = {}
  M.disconnect_notified = false
  M.client = socket.new({
    path = paths.socket_path(M.config),
    notify = notify,
    max_request_bytes = M.config.max_request_bytes,
  })
  M.client.on_connect = function()
    M.disconnect_notified = false
    M.client:subscribe({ 'state', 'preview.jump', 'preview.viewport' }, function(err, result)
      if err then
        notify('Papyri subscription failed: ' .. err, vim.log.levels.WARN)
        return
      end
      if result and result.state then
        local features = result.state.features
        local supported = false
        if type(features) == 'table' then
          for _, feature in ipairs(features) do
            if feature == 'preview.attach' then
              supported = true
              break
            end
          end
        end
        if not supported then
          notify(
            'This Papyri build does not support preview attachments; update Papyri.',
            vim.log.levels.WARN
          )
        end
      end
      if M.config.decorationless then
        M.request('decorationless', { enabled = true }, nil, false)
      end
      attach.on_connect()
    end)
  end
  M.client.on_disconnect = function(reason)
    attach.on_disconnect()
    if M.disconnect_notified then
      return
    end
    M.disconnect_notified = true
    notify('Papyri connection lost; reconnecting. ' .. tostring(reason or ''), vim.log.levels.WARN)
  end
  M.client.on_state = function(state)
    attach.on_state(state)
  end
  M.client:on('preview.jump', function(data)
    attach.on_jump(data)
  end)
  M.client:on('preview.viewport', function(data)
    attach.on_viewport(data)
  end)
  attach.setup(M.config, M.client, notify, M.ensure_connection)

  local group = vim.api.nvim_create_augroup('Papyri', { clear = true })
  vim.api.nvim_create_autocmd({ 'BufEnter', 'FileType' }, {
    group = group,
    callback = function(args)
      vim.schedule(function()
        attach.on_buf_enter(args.buf)
      end)
    end,
  })
  vim.api.nvim_create_autocmd({ 'TextChanged', 'TextChangedI', 'BufReadPost' }, {
    group = group,
    callback = function(args)
      attach.on_text_changed(args.buf)
    end,
  })
  vim.api.nvim_create_autocmd('BufWritePost', {
    group = group,
    callback = function(args)
      attach.on_write(args.buf)
    end,
  })
  vim.api.nvim_create_autocmd({ 'BufDelete', 'BufWipeout' }, {
    group = group,
    callback = function(args)
      attach.on_delete(args.buf)
    end,
  })
  vim.api.nvim_create_autocmd('CursorMoved', {
    group = group,
    callback = function()
      attach.reveal(false)
    end,
  })
  vim.api.nvim_create_autocmd('CursorMovedI', {
    group = group,
    callback = function()
      if M.config.follow_insert then
        attach.reveal(false)
      end
    end,
  })
  vim.api.nvim_create_autocmd('InsertLeave', {
    group = group,
    callback = function()
      attach.reveal(false)
    end,
  })
  vim.api.nvim_create_autocmd('WinScrolled', {
    group = group,
    callback = function()
      attach.schedule_viewport_sync()
    end,
  })
  vim.api.nvim_create_autocmd('VimLeavePre', {
    group = group,
    callback = function()
      M.shutdown()
    end,
  })

  local subcommands = {
    'open',
    'root',
    'toggle',
    'close',
    'detach',
    'reveal',
    'follow',
    'scroll-sync',
    'tabs',
    'outline',
    'search',
    'zoom',
    'theme',
    'decorationless',
    'live',
    'takeover',
    'start',
    'refresh',
    'status',
    'focus',
    'quit',
    'raw',
    'help',
  }
  local function usage()
    notify('Usage: :Papyri {' .. table.concat(subcommands, '|') .. '}', vim.log.levels.WARN)
  end
  local function complete_subcommands(lead)
    local matches = {}
    for _, name in ipairs(subcommands) do
      if name:sub(1, #lead) == lead then
        table.insert(matches, name)
      end
    end
    return matches
  end
  local handlers = {
    open = function(value)
      M.open(value ~= '' and value or nil)
    end,
    root = function()
      M.root()
    end,
    toggle = function()
      M.toggle()
    end,
    close = function()
      M.close()
    end,
    detach = function()
      M.detach()
    end,
    reveal = function()
      M.reveal()
    end,
    follow = function(value)
      M.follow(value)
    end,
    ['scroll-sync'] = function(value)
      M.scroll_sync(value)
    end,
    tabs = function()
      M.tabs()
    end,
    outline = function()
      M.outline()
    end,
    search = function(value)
      M.search(value)
    end,
    zoom = function(value)
      M.zoom(value)
    end,
    theme = function(value)
      M.theme(value)
    end,
    decorationless = function(value)
      M.decorationless(value)
    end,
    live = function(value)
      M.live(value)
    end,
    takeover = function()
      M.takeover()
    end,
    start = function()
      M.start()
    end,
    refresh = function()
      M.request('refresh', {}, nil, false)
    end,
    status = function()
      notify(M.status(), vim.log.levels.INFO, true)
    end,
    focus = function()
      M.request('raise', {}, nil, false)
    end,
    quit = function()
      M.request('quit', {}, nil, false)
    end,
    raw = function(value)
      local method, json = value:match('^(%S+)%s*(.*)$')
      if not method then
        notify('Usage: :Papyri raw METHOD [json]', vim.log.levels.WARN)
        return
      end
      M.raw(method, json)
    end,
    help = usage,
  }
  command('Papyri', function(args)
    local name, value = args.args:match('^(%S+)%s*(.*)$')
    if not name then
      usage()
      return
    end
    local handler = handlers[name]
    if handler then
      handler(value)
      return
    end
    M.raw(name, value)
  end, {
    nargs = '*',
    complete = function(lead)
      return complete_subcommands(lead)
    end,
  })
end

return M

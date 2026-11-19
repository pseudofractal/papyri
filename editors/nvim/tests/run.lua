local source = vim.fn.fnamemodify(debug.getinfo(1, 'S').source:sub(2), ':p')
local tests_dir = vim.fn.fnamemodify(source, ':h')
local plugin_root = vim.fn.fnamemodify(tests_dir, ':h')
package.path = plugin_root
  .. '/lua/?.lua;'
  .. plugin_root
  .. '/lua/?/init.lua;'
  .. tests_dir
  .. '/?.lua;'
  .. package.path

local fake = require('fake_server')
local support = require('support')
local config = require('papyri.config')
local paths = require('papyri.paths')
local socket = require('papyri.socket')
local attach = require('papyri.attach')
local papyri = require('papyri')

local equal = support.equal
local truthy = support.truthy
local wait_until = support.wait_until
local root = support.root
local write = support.write
local edit = support.edit
local edit_typst = support.edit_typst

local tests = {}
local messages = {}
local saved_notify = vim.notify

vim.notify = function(message, level)
  table.insert(messages, { message = message, level = level or vim.log.levels.INFO })
end

local function test(name, callback)
  table.insert(tests, { name = name, callback = callback })
end

local function count(server, method)
  local total = 0
  for _, request in ipairs(server.requests) do
    if request.method == method then
      total = total + 1
    end
  end
  return total
end

local function latest(server, method)
  local found
  for _, request in ipairs(server.requests) do
    if request.method == method then
      found = request
    end
  end
  return found
end

local function reset()
  pcall(papyri.shutdown)
  vim.cmd('silent! %bwipeout!')
  messages = {}
  vim.notify = function(message, level)
    table.insert(messages, { message = message, level = level or vim.log.levels.INFO })
  end
end

test('socket path honors the environment', function()
  local saved_override = vim.env.PAPYRI_CONTROL_SOCKET
  local saved_runtime = vim.env.XDG_RUNTIME_DIR
  vim.env.PAPYRI_CONTROL_SOCKET = '/tmp/papyri-test.sock'
  equal(paths.socket_path(config.merge({})), '/tmp/papyri-test.sock')
  vim.env.PAPYRI_CONTROL_SOCKET = ''
  vim.env.XDG_RUNTIME_DIR = '/run/user/1000'
  equal(paths.socket_path(config.merge({})), '/run/user/1000/papyri/control.sock')
  vim.env.PAPYRI_CONTROL_SOCKET = saved_override
  vim.env.XDG_RUNTIME_DIR = saved_runtime
end)

test('requests resolve by id and events dispatch', function()
  local server = fake
    .new({
      ping = function()
        return { pong = true }
      end,
    })
    :start()
  local client = socket.new({ path = server.path, notify = function() end })
  local connected = false
  client:connect(function(err)
    truthy(not err, 'connect error')
    connected = true
  end)
  wait_until(function()
    return connected
  end, 'connection')
  local response
  client:request('ping', {}, function(err, result)
    truthy(not err, 'ping error')
    response = result
  end)
  wait_until(function()
    return response ~= nil
  end, 'ping response')
  equal(response.pong, true)

  local event
  client:on('custom', function(data)
    event = data
  end)
  local subscribed = false
  client:subscribe({ 'state' }, function(err)
    subscribed = not err
  end)
  wait_until(function()
    return subscribed
  end, 'subscription')
  server:emit('custom', { value = 7 })
  wait_until(function()
    return event ~= nil
  end, 'custom event')
  equal(event.value, 7)

  client:close()
  server:stop()
end)

test('attach sends text and update becomes the next revision', function()
  local server = fake.new():start()
  local directory = root()
  local notes = directory .. '/notes.md'
  write(notes)
  vim.cmd('cd ' .. vim.fn.fnameescape(directory))
  papyri.setup({
    socket = server.path,
    auto_attach = false,
    launch = false,
    notify = false,
    debounce_ms = 0,
    takeover = 'never',
  })
  local bufnr = edit(notes)
  attach.attach(bufnr, { quiet = true })
  wait_until(function()
    return latest(server, 'preview.attach') ~= nil
  end, 'attach request')
  local request = latest(server, 'preview.attach')
  equal(request.params.path, notes)
  equal(request.params.documents[1].path, notes)
  equal(request.params.documents[1].text, '# Title\n\nBody\n')
  wait_until(function()
    return attach.status().attached
  end, 'local attachment')

  vim.api.nvim_buf_set_lines(bufnr, 0, -1, false, { '# Changed', '', 'Body' })
  attach.update_now()
  wait_until(function()
    return latest(server, 'preview.update') ~= nil
  end, 'update request')
  request = latest(server, 'preview.update')
  equal(request.params.revision, 1)
  equal(request.params.documents[1].text, '# Changed\n\nBody\n')

  attach.detach(true)
  wait_until(function()
    return latest(server, 'preview.detach') ~= nil
  end, 'detach request')
  truthy(not attach.status().attached, 'detached state')
  server:stop()
end)

test('auto-attach respects the project root and ignore globs', function()
  local server = fake.new():start()
  local directory = root()
  local notes = directory .. '/notes.md'
  local second = directory .. '/second.md'
  local ignored = directory .. '/node_modules/ignored.md'
  local outside_dir = '/var/tmp/papyri-nvim-' .. vim.fn.getpid() .. '-' .. tostring(vim.uv.hrtime())
  local outside = outside_dir .. '/outside.md'
  write(notes)
  write(second)
  write(ignored)
  write(outside)
  vim.cmd('cd ' .. vim.fn.fnameescape(directory))
  papyri.setup({
    socket = server.path,
    auto_attach = true,
    launch = false,
    notify = false,
    debounce_ms = 0,
    takeover = 'never',
  })
  edit(notes)
  wait_until(function()
    return count(server, 'preview.attach') == 1
  end, 'initial attach')
  edit(ignored)
  vim.wait(150)
  equal(count(server, 'preview.attach'), 1, 'ignored buffer does not attach')
  edit(outside)
  vim.wait(150)
  equal(count(server, 'preview.attach'), 1, 'outside buffer does not attach')
  edit(second)
  wait_until(function()
    return count(server, 'preview.attach') == 2
  end, 'second attach')
  equal(latest(server, 'preview.attach').params.path, second)
  server:stop()
end)

test('follow reveals the cursor line and can be disabled', function()
  local server = fake.new():start()
  local directory = root()
  local notes = directory .. '/notes.md'
  write(notes, { '# Title', '', 'one', 'two', 'three', 'four', 'five' })
  vim.cmd('cd ' .. vim.fn.fnameescape(directory))
  papyri.setup({
    socket = server.path,
    auto_attach = false,
    launch = false,
    notify = false,
    debounce_ms = 0,
    takeover = 'never',
  })
  local bufnr = edit(notes)
  attach.attach(bufnr, { quiet = true })
  wait_until(function()
    return attach.status().attached
  end, 'attachment')
  vim.api.nvim_win_set_cursor(0, { 6, 2 })
  attach.reveal(true)
  wait_until(function()
    return latest(server, 'preview.reveal') ~= nil
  end, 'reveal request')
  local request = latest(server, 'preview.reveal')
  equal(request.params.line, 5)
  equal(request.params.character, 2)
  equal(request.params.align, 'center')

  attach.toggle_follow(false)
  local before = count(server, 'preview.reveal')
  vim.api.nvim_win_set_cursor(0, { 3, 0 })
  attach.reveal(false)
  vim.wait(150)
  equal(count(server, 'preview.reveal'), before, 'follow disabled')
  attach.toggle_follow(true)
  server:stop()
end)

test('takeover retries explicitly, refusal never attaches', function()
  local server = fake.new():start()
  server.state.attachment = {
    active = true,
    owner = 'other',
    kind = 'markdown',
    root = '/tmp/other.md',
    paths = { '/tmp/other.md' },
    revision = 0,
  }
  local directory = root()
  local notes = directory .. '/notes.md'
  write(notes)
  vim.cmd('cd ' .. vim.fn.fnameescape(directory))
  papyri.setup({
    socket = server.path,
    auto_attach = false,
    launch = false,
    notify = false,
    debounce_ms = 0,
    takeover = 'always',
  })
  local bufnr = edit(notes)
  attach.attach(bufnr, { quiet = true })
  wait_until(function()
    return count(server, 'preview.attach') == 2
  end, 'takeover retry')
  local requests = {}
  for _, request in ipairs(server.requests) do
    if request.method == 'preview.attach' then
      table.insert(requests, request)
    end
  end
  truthy(not requests[1].params.takeover, 'first request was not a takeover')
  equal(requests[2].params.takeover, true)
  wait_until(function()
    return attach.status().attached
  end, 'takeover attachment')

  reset()
  server.state.attachment = {
    active = true,
    owner = 'other',
    kind = 'markdown',
    root = '/tmp/other.md',
    paths = { '/tmp/other.md' },
    revision = 0,
  }
  papyri.setup({
    socket = server.path,
    auto_attach = false,
    launch = false,
    notify = false,
    debounce_ms = 0,
    takeover = 'never',
  })
  bufnr = edit(notes)
  attach.attach(bufnr, { quiet = true })
  wait_until(function()
    return #messages > 0 and messages[#messages].message:find('another editor', 1, true) ~= nil
  end, 'takeover refusal')
  truthy(not attach.status().attached, 'refused attachment')
  server:stop()
end)

test('a state event from another owner detaches locally', function()
  local server = fake.new():start()
  local directory = root()
  local notes = directory .. '/notes.md'
  write(notes)
  vim.cmd('cd ' .. vim.fn.fnameescape(directory))
  papyri.setup({
    socket = server.path,
    auto_attach = false,
    launch = false,
    notify = true,
    debounce_ms = 0,
    takeover = 'never',
  })
  local bufnr = edit(notes)
  attach.attach(bufnr, { quiet = true })
  wait_until(function()
    return attach.status().attached
  end, 'attachment')
  server.state.attachment.owner = 'other'
  server:emit('state', server.state)
  wait_until(function()
    return not attach.status().attached
  end, 'local detach')
  truthy(messages[#messages].message:find('Another editor', 1, true) ~= nil, 'takeover notice')
  local before = count(server, 'preview.attach')
  attach.on_buf_enter(bufnr)
  vim.wait(100)
  equal(count(server, 'preview.attach'), before, 'suppressed reattach')
  server:stop()
end)

test('deleting the attached buffer detaches and closes its tab', function()
  local server = fake.new():start()
  local directory = root()
  local notes = directory .. '/notes.md'
  write(notes)
  vim.cmd('cd ' .. vim.fn.fnameescape(directory))
  papyri.setup({
    socket = server.path,
    auto_attach = false,
    launch = false,
    notify = false,
    debounce_ms = 0,
    takeover = 'never',
  })
  local bufnr = edit(notes)
  attach.attach(bufnr, { quiet = true })
  wait_until(function()
    return attach.status().attached
  end, 'attachment')
  vim.cmd('bwipeout! ' .. bufnr)
  wait_until(function()
    return latest(server, 'preview.detach') ~= nil
  end, 'detach request')
  wait_until(function()
    return latest(server, 'close') ~= nil
  end, 'close request')
  equal(latest(server, 'close').params.path, notes)
  truthy(not attach.status().attached, 'detached state')
  server:stop()
end)

test('Typst root resolution uses a sibling main or typst.toml entrypoint', function()
  local directory = root()
  local main = directory .. '/main.typ'
  local chapter = directory .. '/chapter.typ'
  write(main, { '#let title = [Main]' })
  write(chapter, { '#include "main.typ"' })
  vim.cmd('cd ' .. vim.fn.fnameescape(directory))
  local bufnr = edit_typst(chapter)
  equal(paths.typst_root(bufnr, config.merge({})), main)

  vim.cmd('silent! %bwipeout!')
  local project = vim.fn.tempname()
  vim.fn.mkdir(project, 'p')
  write(project .. '/typst.toml', { '[package]', 'entrypoint = "book.typ"' })
  local book = project .. '/book.typ'
  local part = project .. '/part.typ'
  write(book, { '#let title = [Book]' })
  write(part, { '#include "book.typ"' })
  vim.cmd('cd ' .. vim.fn.fnameescape(project))
  bufnr = edit_typst(part)
  equal(paths.typst_root(bufnr, config.merge({})), book)
end)

test('Typst attach streams chapters and reveals the active chapter', function()
  local server = fake.new():start()
  local directory = root()
  local main = directory .. '/main.typ'
  local chapter = directory .. '/chapter.typ'
  write(main, { '#let title = [Main]', '', '#include "chapter.typ"' })
  write(chapter, { '= Chapter', '', 'Original chapter text.' })
  vim.cmd('cd ' .. vim.fn.fnameescape(directory))
  papyri.setup({
    socket = server.path,
    auto_attach = false,
    launch = false,
    notify = false,
    debounce_ms = 0,
    takeover = 'never',
  })
  local bufnr = edit_typst(chapter)
  vim.api.nvim_buf_set_lines(bufnr, 2, 3, false, { 'Live chapter text.' })
  attach.attach(bufnr, { quiet = true })
  wait_until(function()
    return latest(server, 'preview.attach') ~= nil
  end, 'typst attach')
  local request = latest(server, 'preview.attach')
  equal(request.params.kind, 'typst')
  equal(request.params.path, main)
  truthy(vim.tbl_contains(request.params.paths, main), 'main path')
  truthy(vim.tbl_contains(request.params.paths, chapter), 'chapter path')
  equal(#request.params.documents, 1)
  equal(request.params.documents[1].path, chapter)
  equal(request.params.documents[1].text, '= Chapter\n\nLive chapter text.\n')
  wait_until(function()
    return attach.status().attached
  end, 'typst attachment')
  equal(attach.status().root, main)
  equal(attach.status().path, chapter)

  vim.api.nvim_buf_set_lines(bufnr, 2, 3, false, { 'é Updated chapter text.' })
  attach.update_now()
  wait_until(function()
    return latest(server, 'preview.update') ~= nil
  end, 'typst update')
  request = latest(server, 'preview.update')
  equal(request.params.revision, 1)
  equal(request.params.documents[1].path, chapter)
  equal(request.params.documents[1].text, '= Chapter\n\né Updated chapter text.\n')

  vim.api.nvim_win_set_cursor(0, { 3, 3 })
  local before = count(server, 'preview.reveal')
  attach.reveal(true)
  wait_until(function()
    return count(server, 'preview.reveal') > before
  end, 'typst reveal')
  request = latest(server, 'preview.reveal')
  equal(request.params.path, chapter)
  equal(request.params.line, 2)
  equal(request.params.character, 2)
  attach.detach(true)
  server:stop()
end)

test('preview jumps open the source and call the focus command', function()
  local server = fake.new():start()
  local directory = root()
  local main = directory .. '/main.typ'
  local chapter = directory .. '/chapter.typ'
  write(main, { '#let title = [Main]' })
  write(chapter, { '= Chapter', 'Jump target.' })
  vim.cmd('cd ' .. vim.fn.fnameescape(directory))
  local focused = false
  papyri.setup({
    socket = server.path,
    auto_attach = false,
    launch = false,
    notify = false,
    debounce_ms = 0,
    takeover = 'never',
    focus_command = function()
      focused = true
    end,
  })
  local bufnr = edit_typst(main)
  attach.attach(bufnr, { quiet = true })
  wait_until(function()
    return attach.status().attached
  end, 'typst attachment')
  server:emit('preview.jump', {
    owner = attach.status().owner,
    kind = 'typst',
    path = chapter,
    line = 1,
    character = 0,
  })
  wait_until(function()
    return vim.api.nvim_buf_get_name(0) == chapter and focused
  end, 'preview jump')
  equal(vim.api.nvim_win_get_cursor(0)[1], 2)
  equal(vim.api.nvim_win_get_cursor(0)[2], 0)
  attach.detach(true)
  server:stop()
end)

test('auto-attach opens the Typst root for a chapter buffer', function()
  local server = fake.new():start()
  local directory = root()
  local main = directory .. '/main.typ'
  local chapter = directory .. '/chapter.typ'
  write(main, { '#let title = [Main]' })
  write(chapter, { '#include "main.typ"' })
  vim.cmd('cd ' .. vim.fn.fnameescape(directory))
  papyri.setup({
    socket = server.path,
    auto_attach = true,
    launch = false,
    notify = false,
    debounce_ms = 0,
    takeover = 'never',
  })
  edit_typst(chapter)
  wait_until(function()
    return count(server, 'preview.attach') == 1
  end, 'typst auto-attach')
  equal(latest(server, 'preview.attach').params.path, main)
  equal(latest(server, 'preview.attach').params.kind, 'typst')
  edit_typst(main)
  vim.wait(150)
  equal(count(server, 'preview.attach'), 1, 'root switch reattached')
  equal(attach.status().path, main)
  edit_typst(chapter)
  vim.wait(150)
  equal(count(server, 'preview.attach'), 1, 'chapter switch reattached')
  equal(attach.status().path, chapter)
  attach.detach(true)
  local before = count(server, 'preview.attach')
  edit_typst(main)
  edit_typst(chapter)
  vim.wait(150)
  equal(count(server, 'preview.attach'), before, 'detached Typst project reattached')
  server:stop()
end)

test('Markdown scroll sync follows viewports both ways and suppresses echoes', function()
  local server = fake.new():start()
  local directory = root()
  local notes = directory .. '/notes.md'
  local lines = { '# Title', '' }
  for index = 1, 12 do
    table.insert(lines, 'Paragraph ' .. index .. '.')
  end
  write(notes, lines)
  vim.cmd('cd ' .. vim.fn.fnameescape(directory))
  papyri.setup({
    socket = server.path,
    auto_attach = false,
    launch = false,
    notify = false,
    debounce_ms = 0,
    scroll_debounce_ms = 0,
    scroll_sync = true,
    takeover = 'never',
  })
  local bufnr = edit(notes)
  attach.attach(bufnr, { quiet = true })
  wait_until(function()
    return attach.status().attached
  end, 'attachment')

  attach.suppress_viewport_until = 0
  attach.suppress_scroll_sync_until = 0
  server:emit('preview.viewport', {
    owner = attach.status().owner,
    kind = 'markdown',
    path = notes,
    line = 4,
    offset = 0,
  })
  wait_until(function()
    return vim.fn.winsaveview().topline == 5
  end, 'preview to editor viewport')

  attach.suppress_scroll_sync_until = 0
  attach.suppress_viewport_until = 0
  local before = count(server, 'preview.reveal')
  vim.fn.winrestview({ topline = 3 })
  attach.sync_viewport()
  wait_until(function()
    return count(server, 'preview.reveal') > before
  end, 'editor to preview scroll')
  local request = latest(server, 'preview.reveal')
  equal(request.params.line, 2)
  equal(request.params.align, 'top')

  attach.suppress_viewport_until = vim.uv.hrtime() + 1e9
  local current = vim.fn.winsaveview().topline
  server:emit('preview.viewport', {
    owner = attach.status().owner,
    kind = 'markdown',
    path = notes,
    line = 8,
    offset = 0,
  })
  vim.wait(120)
  equal(vim.fn.winsaveview().topline, current, 'suppressed viewport')

  attach.toggle_scroll_sync(false)
  equal(attach.status().scroll, false)
  attach.detach(true)
  server:stop()
end)

test('first-class commands forward app controls', function()
  local server = fake.new():start()
  local directory = root()
  local notes = directory .. '/notes.md'
  write(notes)
  vim.cmd('cd ' .. vim.fn.fnameescape(directory))
  papyri.setup({
    socket = server.path,
    auto_attach = false,
    launch = false,
    notify = false,
    debounce_ms = 0,
    takeover = 'never',
  })
  vim.cmd('Papyri start')
  wait_until(function()
    return papyri.client.connected
  end, 'start command')

  vim.cmd('Papyri zoom in')
  wait_until(function()
    return latest(server, 'zoom') ~= nil
  end, 'zoom command')
  equal(latest(server, 'zoom').params.action, 'in')
  vim.cmd('Papyri theme mocha')
  wait_until(function()
    return latest(server, 'theme') ~= nil
  end, 'theme command')
  equal(latest(server, 'theme').params.theme, 'mocha')
  vim.cmd('Papyri decorationless on')
  wait_until(function()
    return latest(server, 'decorationless') ~= nil
  end, 'decorationless command')
  equal(latest(server, 'decorationless').params.enabled, true)
  vim.cmd('Papyri live off')
  wait_until(function()
    return latest(server, 'live-preview') ~= nil
  end, 'live command')
  equal(latest(server, 'live-preview').params.enabled, false)
  vim.cmd('Papyri scroll-sync off')
  equal(attach.status().scroll, false)
  vim.cmd('Papyri scroll-sync on')
  equal(attach.status().scroll, true)
  server:stop()
end)

test('takeover prompt accepts an explicit choice', function()
  local server = fake.new():start()
  server.state.attachment = {
    active = true,
    owner = 'other',
    kind = 'markdown',
    root = '/tmp/other.md',
    paths = { '/tmp/other.md' },
    revision = 0,
  }
  local directory = root()
  local notes = directory .. '/notes.md'
  write(notes)
  vim.cmd('cd ' .. vim.fn.fnameescape(directory))
  papyri.setup({
    socket = server.path,
    auto_attach = false,
    launch = false,
    notify = false,
    debounce_ms = 0,
    takeover = 'prompt',
  })
  local saved_select = vim.ui.select
  vim.ui.select = function(_, _, callback)
    callback('Take over')
  end
  local bufnr = edit(notes)
  attach.attach(bufnr, { quiet = true })
  wait_until(function()
    return count(server, 'preview.attach') == 2
  end, 'prompted takeover')
  local requests = {}
  for _, request in ipairs(server.requests) do
    if request.method == 'preview.attach' then
      table.insert(requests, request)
    end
  end
  equal(requests[2].params.takeover, true)
  wait_until(function()
    return attach.status().attached
  end, 'prompted attachment')
  vim.ui.select = saved_select
  server:stop()
end)

test('forced takeover works even when prompt takeover is disabled', function()
  local server = fake.new():start()
  server.state.attachment = {
    active = true,
    owner = 'other',
    kind = 'markdown',
    root = '/tmp/other.md',
    paths = { '/tmp/other.md' },
    revision = 0,
  }
  local directory = root()
  local notes = directory .. '/notes.md'
  write(notes)
  vim.cmd('cd ' .. vim.fn.fnameescape(directory))
  papyri.setup({
    socket = server.path,
    auto_attach = false,
    launch = false,
    notify = false,
    debounce_ms = 0,
    takeover = 'never',
  })
  local bufnr = edit(notes)
  attach.attach(bufnr, { quiet = true })
  vim.wait(200)
  truthy(not attach.status().attached, 'initial attach was refused')
  vim.cmd('Papyri takeover')
  wait_until(function()
    return attach.status().attached
  end, 'forced takeover')
  equal(latest(server, 'preview.attach').params.takeover, true)
  server:stop()
end)

test('oversized Markdown attaches without an overlay', function()
  local server = fake.new():start()
  local directory = root()
  local notes = directory .. '/notes.md'
  write(notes, { '# Title', string.rep('large ', 100) })
  vim.cmd('cd ' .. vim.fn.fnameescape(directory))
  papyri.setup({
    socket = server.path,
    auto_attach = false,
    launch = false,
    notify = false,
    debounce_ms = 0,
    max_bytes = 10,
    takeover = 'never',
  })
  local bufnr = edit(notes)
  attach.attach(bufnr, { quiet = true })
  wait_until(function()
    return latest(server, 'preview.attach') ~= nil
  end, 'oversized attach')
  equal(latest(server, 'preview.attach').params.documents, nil)
  wait_until(function()
    return attach.status().attached
  end, 'oversized attachment')
  attach.detach(true)
  server:stop()
end)

test('clean Typst projects attach without a documents array', function()
  local server = fake.new():start()
  local directory = root()
  local main = directory .. '/main.typ'
  local chapter = directory .. '/chapter.typ'
  write(main, { '#let title = [Main]', '', '#include "chapter.typ"' })
  write(chapter, { '= Chapter', '', 'Saved chapter text.' })
  vim.cmd('cd ' .. vim.fn.fnameescape(directory))
  papyri.setup({
    socket = server.path,
    auto_attach = false,
    launch = false,
    notify = false,
    debounce_ms = 0,
    takeover = 'never',
  })
  local bufnr = edit_typst(chapter)
  attach.attach(bufnr, { quiet = true })
  wait_until(function()
    return latest(server, 'preview.attach') ~= nil
  end, 'clean typst attach')
  local request = latest(server, 'preview.attach')
  equal(request.params.kind, 'typst')
  equal(request.params.path, main)
  equal(request.params.documents, nil)
  wait_until(function()
    return attach.status().attached
  end, 'clean typst attachment')
  attach.detach(true)
  server:stop()
end)

test('deleting a Typst chapter keeps the root, deleting the root closes it', function()
  local server = fake.new():start()
  local directory = root()
  local main = directory .. '/main.typ'
  local chapter = directory .. '/chapter.typ'
  write(main, { '#let title = [Main]', '', '#include "chapter.typ"' })
  write(chapter, { '= Chapter', '', 'Text.' })
  vim.cmd('cd ' .. vim.fn.fnameescape(directory))
  papyri.setup({
    socket = server.path,
    auto_attach = false,
    launch = false,
    notify = false,
    debounce_ms = 0,
    takeover = 'never',
  })
  local chapter_buf = edit_typst(chapter)
  attach.attach(chapter_buf, { quiet = true })
  wait_until(function()
    return attach.status().attached
  end, 'typst attachment')
  local main_buf = vim.fn.bufadd(main)
  vim.fn.bufload(main_buf)
  vim.cmd('bwipeout! ' .. chapter_buf)
  vim.wait(150)
  truthy(attach.status().attached, 'chapter deletion detached the root')
  equal(attach.status().root, main)
  vim.cmd('bwipeout! ' .. main_buf)
  wait_until(function()
    return latest(server, 'preview.detach') ~= nil
  end, 'root detach')
  wait_until(function()
    return latest(server, 'close') ~= nil
  end, 'root close')
  equal(latest(server, 'close').params.path, main)
  server:stop()
end)

test('scroll sync can be disabled and validates viewport owners', function()
  local server = fake.new():start()
  local directory = root()
  local notes = directory .. '/notes.md'
  write(notes)
  vim.cmd('cd ' .. vim.fn.fnameescape(directory))
  papyri.setup({
    socket = server.path,
    auto_attach = false,
    launch = false,
    notify = false,
    debounce_ms = 0,
    scroll_debounce_ms = 0,
    scroll_sync = false,
    takeover = 'never',
  })
  local bufnr = edit(notes)
  attach.attach(bufnr, { quiet = true })
  wait_until(function()
    return attach.status().attached
  end, 'attachment')
  attach.suppress_viewport_until = 0
  local before = vim.fn.winsaveview().topline
  server:emit('preview.viewport', {
    owner = attach.status().owner,
    kind = 'markdown',
    path = notes,
    line = 5,
    offset = 0,
  })
  vim.wait(120)
  equal(vim.fn.winsaveview().topline, before, 'disabled scroll sync')
  local reveals = count(server, 'preview.reveal')
  attach.sync_viewport()
  vim.wait(120)
  equal(count(server, 'preview.reveal'), reveals, 'disabled editor scroll sync')
  server:stop()
end)

test('preview jumps validate ownership, paths, and UTF-16 columns', function()
  local server = fake.new():start()
  local directory = root()
  local main = directory .. '/main.typ'
  local chapter = directory .. '/chapter.typ'
  local outside = '/var/tmp/papyri-nvim-jump-' .. vim.fn.getpid() .. '.typ'
  write(main, { '#let title = [Main]' })
  write(chapter, { 'héllo' })
  write(outside, { 'outside' })
  vim.cmd('cd ' .. vim.fn.fnameescape(directory))
  local focused = nil
  local saved_jobstart = vim.fn.jobstart
  vim.fn.jobstart = function(command, options)
    focused = { command = command, options = options }
    return 1
  end
  papyri.setup({
    socket = server.path,
    auto_attach = false,
    launch = false,
    notify = false,
    debounce_ms = 0,
    takeover = 'never',
    focus_command = 'focus-terminal',
  })
  local bufnr = edit_typst(main)
  attach.attach(bufnr, { quiet = true })
  wait_until(function()
    return attach.status().attached
  end, 'attachment')
  local current = vim.api.nvim_get_current_buf()
  server:emit('preview.jump', {
    owner = 'other',
    kind = 'typst',
    path = chapter,
    line = 0,
    character = 0,
  })
  vim.wait(100)
  equal(vim.api.nvim_get_current_buf(), current, 'wrong owner')
  server:emit('preview.jump', {
    owner = attach.status().owner,
    kind = 'typst',
    path = outside,
    line = 0,
    character = 0,
  })
  vim.wait(100)
  equal(vim.api.nvim_get_current_buf(), current, 'outside path')
  server:emit('preview.jump', {
    owner = attach.status().owner,
    kind = 'typst',
    path = chapter,
    line = 0,
    character = 2,
  })
  wait_until(function()
    return vim.api.nvim_buf_get_name(0) == chapter
  end, 'jump buffer')
  equal(vim.api.nvim_win_get_cursor(0)[2], 3)
  wait_until(function()
    return focused ~= nil
  end, 'focus command')
  equal(focused.command[1], 'sh')
  equal(focused.command[2], '-c')
  equal(focused.command[3], 'focus-terminal')
  equal(focused.options.detach, true)
  vim.fn.jobstart = saved_jobstart
  attach.detach(true)
  server:stop()
end)

test('tabs, outline, and search commands use pickers', function()
  local server = fake
    .new({
      headings = function()
        return { path = '/a.md', headings = { { id = 'intro', text = 'Intro', level = 1 } } }
      end,
    })
    :start()
  server.state.tabs = {
    {
      path = '/a.md',
      active = true,
      kind = 'markdown',
      secondary = false,
      scroll = 0,
      error = nil,
    },
  }
  papyri.setup({
    socket = server.path,
    auto_attach = false,
    launch = false,
    notify = false,
    debounce_ms = 0,
    takeover = 'never',
  })
  local saved_select = vim.ui.select
  local selected = {}
  vim.ui.select = function(items, _, callback)
    table.insert(selected, items)
    callback(items[1])
  end
  vim.cmd('Papyri tabs')
  wait_until(function()
    return latest(server, 'tab.activate') ~= nil
  end, 'tabs command')
  equal(latest(server, 'tab.activate').params.path, '/a.md')
  vim.cmd('Papyri outline')
  wait_until(function()
    return latest(server, 'heading') ~= nil
  end, 'outline command')
  equal(latest(server, 'heading').params.id, 'intro')
  vim.cmd('Papyri search needle')
  wait_until(function()
    return latest(server, 'search') ~= nil
  end, 'search command')
  equal(latest(server, 'search').params.query, 'needle')
  equal(#selected, 2)
  vim.ui.select = saved_select
  server:stop()
end)

test('raw command rejects malformed JSON and zoom accepts a number', function()
  local server = fake.new():start()
  papyri.setup({
    socket = server.path,
    auto_attach = false,
    launch = false,
    notify = false,
    debounce_ms = 0,
    takeover = 'never',
  })
  local before = count(server, 'zoom')
  vim.cmd('Papyri zoom 125')
  wait_until(function()
    return count(server, 'zoom') > before
  end, 'numeric zoom')
  equal(latest(server, 'zoom').params.value, 125)
  vim.cmd('Papyri theme not-a-theme')
  vim.wait(100)
  truthy(#messages > 0, 'invalid theme notified')
  vim.cmd('Papyri state not-json')
  wait_until(function()
    for _, message in ipairs(messages) do
      if message.message:find('JSON object', 1, true) then
        return true
      end
    end
    return false
  end, 'invalid raw JSON notice')
  server:stop()
end)

test('empty request parameters encode as a JSON object', function()
  local server = fake
    .new({
      state = function()
        return { ok = true }
      end,
    })
    :start()
  local client = socket.new({ path = server.path, notify = function() end })
  local connected = false
  client:connect(function(err)
    truthy(not err, 'connect error')
    connected = true
  end)
  wait_until(function()
    return connected
  end, 'connection')
  client:request('state', {}, function() end)
  wait_until(function()
    return #server.requests > 0
  end, 'state request')
  truthy(server.requests[1].raw:find('"params":{}', 1, true) ~= nil, 'params object')
  truthy(server.requests[1].raw:find('"params":[]', 1, true) == nil, 'params not an array')
  client:close()
  server:stop()
end)

test('reattaches after a transient socket disconnect', function()
  local path = vim.fn.tempname() .. '.sock'
  local first = fake.new({}, path):start()
  local directory = root()
  local notes = directory .. '/notes.md'
  write(notes)
  vim.cmd('cd ' .. vim.fn.fnameescape(directory))
  papyri.setup({
    socket = path,
    auto_attach = false,
    launch = false,
    notify = false,
    debounce_ms = 0,
    takeover = 'never',
  })
  local bufnr = edit(notes)
  attach.attach(bufnr, { quiet = true })
  wait_until(function()
    return attach.status().attached
  end, 'attachment')
  local owner = attach.status().owner
  first:stop()
  wait_until(function()
    return not papyri.client.connected
  end, 'disconnect')
  local second = fake.new({}, path)
  second.state.attachment = {
    active = true,
    owner = owner,
    kind = 'markdown',
    root = notes,
    paths = { notes },
    revision = 0,
  }
  second:start()
  wait_until(function()
    return papyri.client.connected
  end, 'socket reconnect', 8000)
  wait_until(function()
    return latest(second, 'preview.attach') ~= nil
  end, 'plugin reattach', 8000)
  equal(latest(second, 'preview.attach').params.owner, owner)
  wait_until(function()
    return attach.status().attached
  end, 'reattached state')
  attach.detach(true)
  second:stop()
end)

test('sends lease heartbeats while attached', function()
  local server = fake.new():start()
  local directory = root()
  local notes = directory .. '/notes.md'
  write(notes)
  vim.cmd('cd ' .. vim.fn.fnameescape(directory))
  papyri.setup({
    socket = server.path,
    auto_attach = false,
    launch = false,
    notify = false,
    debounce_ms = 0,
    takeover = 'never',
  })
  local bufnr = edit(notes)
  attach.attach(bufnr, { quiet = true })
  wait_until(function()
    return attach.status().attached
  end, 'attachment')
  wait_until(function()
    return latest(server, 'preview.heartbeat') ~= nil
  end, 'heartbeat', 7000)
  equal(latest(server, 'preview.heartbeat').params.owner, attach.status().owner)
  attach.detach(true)
  server:stop()
end)

test('takeover prompt cancellation leaves the preview untouched', function()
  local server = fake.new():start()
  server.state.attachment = {
    active = true,
    owner = 'other',
    kind = 'markdown',
    root = '/tmp/other.md',
    paths = { '/tmp/other.md' },
    revision = 0,
  }
  local directory = root()
  local notes = directory .. '/notes.md'
  write(notes)
  vim.cmd('cd ' .. vim.fn.fnameescape(directory))
  papyri.setup({
    socket = server.path,
    auto_attach = false,
    launch = false,
    notify = false,
    debounce_ms = 0,
    takeover = 'prompt',
  })
  local saved_select = vim.ui.select
  vim.ui.select = function(_, _, callback)
    callback(nil)
  end
  local bufnr = edit(notes)
  attach.attach(bufnr, { quiet = true })
  vim.wait(250)
  truthy(not attach.status().attached, 'cancelled attachment')
  equal(count(server, 'preview.attach'), 1)
  vim.ui.select = saved_select
  server:stop()
end)

test('close detaches and closes the root, then closes a bare tab', function()
  local server = fake.new():start()
  local directory = root()
  local notes = directory .. '/notes.md'
  write(notes)
  vim.cmd('cd ' .. vim.fn.fnameescape(directory))
  papyri.setup({
    socket = server.path,
    auto_attach = false,
    launch = false,
    notify = false,
    debounce_ms = 0,
    takeover = 'never',
  })
  local bufnr = edit(notes)
  attach.attach(bufnr, { quiet = true })
  wait_until(function()
    return attach.status().attached
  end, 'attachment')
  vim.cmd('Papyri close')
  wait_until(function()
    return latest(server, 'preview.detach') ~= nil
  end, 'close detach')
  wait_until(function()
    return latest(server, 'close') ~= nil
  end, 'close tab')
  equal(latest(server, 'close').params.path, notes)
  truthy(not attach.status().attached, 'closed attachment')
  local before = count(server, 'close')
  vim.cmd('Papyri close')
  wait_until(function()
    return count(server, 'close') > before
  end, 'bare close')
  equal(latest(server, 'close').params.path, nil)
  server:stop()
end)

test('unnamed buffers cannot open or take over a preview', function()
  local server = fake.new():start()
  papyri.setup({
    socket = server.path,
    auto_attach = false,
    launch = false,
    notify = false,
    debounce_ms = 0,
    takeover = 'never',
  })
  vim.cmd('enew')
  vim.cmd('Papyri open')
  vim.cmd('Papyri takeover')
  vim.wait(150)
  equal(count(server, 'open'), 0)
  equal(count(server, 'preview.attach'), 0)
  local found = false
  for _, message in ipairs(messages) do
    if message.message:find('Save the buffer', 1, true) then
      found = true
    end
  end
  truthy(found, 'unnamed buffer notice')
  server:stop()
end)

test('viewport events validate owner, kind, and path, and clamp lines', function()
  local server = fake.new():start()
  local directory = root()
  local notes = directory .. '/notes.md'
  local lines = { '# Title', '' }
  for index = 1, 12 do
    table.insert(lines, 'Line ' .. index .. '.')
    table.insert(lines, '')
  end
  write(notes, lines)
  vim.cmd('cd ' .. vim.fn.fnameescape(directory))
  papyri.setup({
    socket = server.path,
    auto_attach = false,
    launch = false,
    notify = false,
    debounce_ms = 0,
    scroll_debounce_ms = 0,
    scroll_sync = true,
    takeover = 'never',
  })
  local bufnr = edit(notes)
  attach.attach(bufnr, { quiet = true })
  wait_until(function()
    return attach.status().attached
  end, 'attachment')
  attach.suppress_viewport_until = 0
  attach.suppress_scroll_sync_until = 0
  local before = vim.fn.winsaveview().topline
  for _, event in ipairs({
    { owner = 'other', kind = 'markdown', path = notes, line = 5 },
    { owner = attach.status().owner, kind = 'typst', path = notes, line = 5 },
    { owner = attach.status().owner, kind = 'markdown', path = '/tmp/other.md', line = 5 },
  }) do
    event.offset = 0
    server:emit('preview.viewport', event)
  end
  vim.wait(120)
  equal(vim.fn.winsaveview().topline, before, 'rejected viewport events')
  server:emit('preview.viewport', {
    owner = attach.status().owner,
    kind = 'markdown',
    path = notes,
    line = 5,
    offset = 0,
  })
  wait_until(function()
    return vim.fn.winsaveview().topline == 6
  end, 'accepted viewport')
  server:emit('preview.viewport', {
    owner = attach.status().owner,
    kind = 'markdown',
    path = notes,
    line = 9999,
    offset = 0,
  })
  wait_until(function()
    return vim.fn.winsaveview().topline > 20
  end, 'clamped viewport')
  server:stop()
end)

test('BufWritePost pushes the saved overlay immediately', function()
  local server = fake.new():start()
  local directory = root()
  local notes = directory .. '/notes.md'
  write(notes)
  vim.cmd('cd ' .. vim.fn.fnameescape(directory))
  papyri.setup({
    socket = server.path,
    auto_attach = false,
    launch = false,
    notify = false,
    debounce_ms = 1000,
    takeover = 'never',
  })
  local bufnr = edit(notes)
  attach.attach(bufnr, { quiet = true })
  wait_until(function()
    return attach.status().attached
  end, 'attachment')
  vim.api.nvim_buf_set_lines(bufnr, 0, -1, false, { '# Saved immediately' })
  local before = count(server, 'preview.update')
  vim.cmd('silent write')
  wait_until(function()
    return count(server, 'preview.update') > before
  end, 'write update')
  equal(latest(server, 'preview.update').params.documents[1].text, '# Saved immediately\n')
  attach.detach(true)
  server:stop()
end)

test('empty tab and outline pickers notify without requests', function()
  local server = fake
    .new({
      headings = function()
        return { path = '/a.md', headings = {} }
      end,
    })
    :start()
  server.state.tabs = {}
  papyri.setup({
    socket = server.path,
    auto_attach = false,
    launch = false,
    notify = false,
    debounce_ms = 0,
    takeover = 'never',
  })
  vim.cmd('Papyri tabs')
  vim.cmd('Papyri outline')
  vim.wait(200)
  local tabs_notice, outline_notice = false, false
  for _, message in ipairs(messages) do
    if message.message:find('no open tabs', 1, true) then
      tabs_notice = true
    end
    if message.message:find('no headings', 1, true) then
      outline_notice = true
    end
  end
  truthy(tabs_notice, 'empty tabs notice')
  truthy(outline_notice, 'empty outline notice')
  equal(count(server, 'tab.activate'), 0)
  equal(count(server, 'heading'), 0)
  server:stop()
end)

test('search command uses the visual selection', function()
  local server = fake.new():start()
  local directory = root()
  local notes = directory .. '/notes.md'
  write(notes, { '# Title' })
  vim.cmd('cd ' .. vim.fn.fnameescape(directory))
  papyri.setup({
    socket = server.path,
    auto_attach = false,
    launch = false,
    notify = false,
    debounce_ms = 0,
    takeover = 'never',
  })
  edit(notes)
  vim.fn.setpos("'<", { 0, 1, 1, 0 })
  vim.fn.setpos("'>", { 0, 1, 5, 0 })
  vim.cmd('Papyri search')
  wait_until(function()
    return latest(server, 'search') ~= nil
  end, 'visual search')
  equal(latest(server, 'search').params.query, '# Tit')
  server:stop()
end)

test('toggle commands omit enabled for server-side toggling', function()
  local server = fake.new():start()
  papyri.setup({
    socket = server.path,
    auto_attach = false,
    launch = false,
    notify = false,
    debounce_ms = 0,
    takeover = 'never',
  })
  vim.cmd('Papyri live')
  wait_until(function()
    return latest(server, 'live-preview') ~= nil
  end, 'live toggle')
  equal(latest(server, 'live-preview').params.enabled, nil)
  vim.cmd('Papyri decorationless')
  wait_until(function()
    return latest(server, 'decorationless') ~= nil
  end, 'decorationless toggle')
  equal(latest(server, 'decorationless').params.enabled, nil)
  vim.cmd('Papyri theme')
  wait_until(function()
    return latest(server, 'theme') ~= nil
  end, 'theme toggle')
  equal(latest(server, 'theme').params.theme, 'toggle')
  server:stop()
end)

test('a failed update is retried for the same text', function()
  local failures = 0
  local server = fake
    .new({
      ['preview.update'] = function()
        failures = failures + 1
        if failures == 1 then
          return nil, 'transient update failure'
        end
        return { ok = true }
      end,
    })
    :start()
  local directory = root()
  local notes = directory .. '/notes.md'
  write(notes)
  vim.cmd('cd ' .. vim.fn.fnameescape(directory))
  papyri.setup({
    socket = server.path,
    auto_attach = false,
    launch = false,
    notify = false,
    debounce_ms = 0,
    takeover = 'never',
  })
  local bufnr = edit(notes)
  attach.attach(bufnr, { quiet = true })
  wait_until(function()
    return attach.status().attached
  end, 'attachment')
  attach.config.debounce_ms = 10000
  vim.api.nvim_buf_set_lines(bufnr, 0, -1, false, { '# Retry me' })
  attach.update_now()
  wait_until(function()
    return count(server, 'preview.update') == 1
  end, 'first update')
  wait_until(function()
    for _, message in ipairs(messages) do
      if message.message:find('transient update failure', 1, true) then
        return true
      end
    end
    return false
  end, 'failed update notice')
  attach.update_now()
  wait_until(function()
    return count(server, 'preview.update') == 2
  end, 'retried update')
  equal(latest(server, 'preview.update').params.documents[1].text, '# Retry me\n')
  attach.detach(true)
  server:stop()
end)

test('oversized Typst chapters warn and omit the overlay', function()
  local server = fake.new():start()
  local directory = root()
  local main = directory .. '/main.typ'
  local chapter = directory .. '/chapter.typ'
  write(main, { '#let title = [Main]' })
  write(chapter, { '= Chapter', string.rep('large ', 100) })
  vim.cmd('cd ' .. vim.fn.fnameescape(directory))
  papyri.setup({
    socket = server.path,
    auto_attach = false,
    launch = false,
    notify = false,
    debounce_ms = 0,
    max_bytes = 10,
    takeover = 'never',
  })
  local bufnr = edit_typst(chapter)
  vim.api.nvim_buf_set_lines(bufnr, 0, -1, false, { '= Chapter', string.rep('large ', 100) })
  attach.attach(bufnr, { quiet = true })
  wait_until(function()
    return latest(server, 'preview.attach') ~= nil
  end, 'oversized typst attach')
  equal(latest(server, 'preview.attach').params.documents, nil)
  local warned = false
  for _, message in ipairs(messages) do
    if message.message:find('larger than the preview limit', 1, true) then
      warned = true
    end
  end
  truthy(warned, 'oversized Typst warning')
  attach.detach(true)
  server:stop()
end)

test('opening an unmodified Typst chapter registers it for reveal', function()
  local server = fake.new():start()
  local directory = root()
  local main = directory .. '/main.typ'
  local chapter = directory .. '/chapter.typ'
  write(main, { '#let title = [Main]', '', '#include "chapter.typ"' })
  write(chapter, { '= Chapter', '', 'Saved text.' })
  vim.cmd('cd ' .. vim.fn.fnameescape(directory))
  papyri.setup({
    socket = server.path,
    auto_attach = false,
    launch = false,
    notify = false,
    debounce_ms = 0,
    takeover = 'never',
  })
  local bufnr = edit_typst(main)
  attach.attach(bufnr, { quiet = true })
  wait_until(function()
    return attach.status().attached
  end, 'typst attachment')
  equal(latest(server, 'preview.attach').params.documents, nil)
  edit_typst(chapter)
  wait_until(function()
    local request = latest(server, 'preview.update')
    return request ~= nil and request.params.documents[1].path == chapter
  end, 'chapter registration')
  equal(latest(server, 'preview.update').params.documents[1].text, '= Chapter\n\nSaved text.\n')
  vim.api.nvim_win_set_cursor(0, { 3, 0 })
  attach.reveal(true)
  wait_until(function()
    local request = latest(server, 'preview.reveal')
    return request ~= nil and request.params.path == chapter
  end, 'chapter reveal')
  equal(latest(server, 'preview.reveal').params.path, chapter)
  attach.detach(true)
  server:stop()
end)

test('requests above the transport limit warn and omit overlays', function()
  local server = fake.new():start()
  local directory = root()
  local notes = directory .. '/notes.md'
  write(notes, { string.rep('large ', 1000) })
  vim.cmd('cd ' .. vim.fn.fnameescape(directory))
  papyri.setup({
    socket = server.path,
    auto_attach = false,
    launch = false,
    notify = false,
    debounce_ms = 0,
    max_request_bytes = 2048,
    takeover = 'never',
  })
  local bufnr = edit(notes)
  attach.attach(bufnr, { quiet = true })
  wait_until(function()
    return attach.status().attached
  end, 'transport-fallback attachment')
  equal(latest(server, 'preview.attach').params.documents, nil)
  local warned = false
  for _, message in ipairs(messages) do
    if message.message:find('control transport', 1, true) then
      warned = true
    end
  end
  truthy(warned, 'transport warning')
  vim.api.nvim_buf_set_lines(bufnr, 0, -1, false, { string.rep('larger ', 1000) })
  attach.update_now()
  wait_until(function()
    return count(server, 'preview.update') == 0
  end, 'no oversized update')
  attach.detach(true)
  server:stop()
end)

test('an expired lease reattaches quietly', function()
  local server = fake.new():start()
  local directory = root()
  local notes = directory .. '/notes.md'
  write(notes)
  vim.cmd('cd ' .. vim.fn.fnameescape(directory))
  papyri.setup({
    socket = server.path,
    auto_attach = false,
    launch = false,
    notify = false,
    debounce_ms = 0,
    takeover = 'never',
  })
  local bufnr = edit(notes)
  attach.attach(bufnr, { quiet = true })
  wait_until(function()
    return attach.status().attached
  end, 'attachment')
  local before = count(server, 'preview.attach')
  server.state.attachment.active = false
  server.state.attachment.reason = 'expired'
  server:emit('state', server.state)
  wait_until(function()
    return count(server, 'preview.attach') == before + 1
  end, 'lease reattach')
  wait_until(function()
    return attach.status().attached
  end, 'reattached')
  attach.detach(true)
  server:stop()
end)

test('launch passes the resolved socket and fails every waiter', function()
  local saved_jobstart = vim.fn.jobstart
  local saved_wait = vim.wait
  local saved_executable = vim.fn.executable
  local launched_env
  local second_error
  vim.fn.executable = function()
    return 1
  end
  vim.fn.jobstart = function(_, options)
    launched_env = options.env
    return 123
  end
  vim.wait = function()
    papyri.launch('/tmp/notes.md', function(err)
      second_error = err
    end)
    return false
  end
  papyri.setup({
    socket = '/tmp/papyri-launch-missing.sock',
    auto_attach = false,
    launch = true,
    notify = false,
    papyri = 'nvim',
  })
  local first_error
  papyri.launch('/tmp/notes.md', function(err)
    first_error = err
  end)
  equal(launched_env.PAPYRI_CONTROL_SOCKET, '/tmp/papyri-launch-missing.sock')
  truthy(first_error and first_error:find('control socket', 1, true), 'launch error')
  truthy(second_error and second_error:find('control socket', 1, true), 'waiter error')
  vim.fn.jobstart = saved_jobstart
  vim.wait = saved_wait
  vim.fn.executable = saved_executable
end)

test('an oversized Markdown update clears the overlay', function()
  local server = fake.new():start()
  local directory = root()
  local notes = directory .. '/notes.md'
  write(notes, { '# Small' })
  vim.cmd('cd ' .. vim.fn.fnameescape(directory))
  papyri.setup({
    socket = server.path,
    auto_attach = false,
    launch = false,
    notify = false,
    debounce_ms = 0,
    max_bytes = 50,
    takeover = 'never',
  })
  local bufnr = edit(notes)
  attach.attach(bufnr, { quiet = true })
  wait_until(function()
    return attach.status().attached
  end, 'attachment')
  vim.api.nvim_buf_set_lines(bufnr, 0, -1, false, { string.rep('large ', 20) })
  attach.update_now()
  wait_until(function()
    return count(server, 'preview.update') == 1
  end, 'overlay clear')
  equal(latest(server, 'preview.update').params.documents, {})
  attach.detach(true)
  server:stop()
end)

test('opening an attached buffer reveals it again', function()
  local server = fake.new():start()
  local directory = root()
  local notes = directory .. '/notes.md'
  write(notes)
  vim.cmd('cd ' .. vim.fn.fnameescape(directory))
  papyri.setup({
    socket = server.path,
    auto_attach = false,
    launch = false,
    notify = false,
    debounce_ms = 0,
    takeover = 'never',
  })
  local bufnr = edit(notes)
  attach.attach(bufnr, { quiet = true })
  wait_until(function()
    return attach.status().attached
  end, 'attachment')
  local before = count(server, 'preview.reveal')
  papyri.open(notes)
  wait_until(function()
    return count(server, 'preview.reveal') > before
  end, 'repeat open reveal')
  attach.detach(true)
  server:stop()
end)

test(':Papyri root previews the active Typst chapter', function()
  local server = fake.new():start()
  local directory = root()
  local main = directory .. '/main.typ'
  local chapter = directory .. '/chapter.typ'
  write(main, { '= Main' })
  write(chapter, { '= Chapter' })
  vim.cmd('cd ' .. vim.fn.fnameescape(directory))
  papyri.setup({
    socket = server.path,
    auto_attach = false,
    launch = false,
    notify = false,
    debounce_ms = 0,
    takeover = 'never',
  })
  attach.attach(edit_typst(main), { quiet = true })
  wait_until(function()
    return attach.status().attached
  end, 'main attachment')
  edit_typst(chapter)
  papyri.root()
  wait_until(function()
    local request = latest(server, 'preview.attach')
    return request ~= nil and request.params.path == chapter and attach.status().root == chapter
  end, 'chapter root')
  equal(attach.status().root, chapter)
  attach.detach(true)
  server:stop()
end)

test(':Papyri dispatches subcommands and raw methods', function()
  local server = fake.new():start()
  local directory = root()
  local notes = directory .. '/notes.md'
  write(notes)
  vim.cmd('cd ' .. vim.fn.fnameescape(directory))
  papyri.setup({
    socket = server.path,
    auto_attach = false,
    launch = false,
    notify = false,
    debounce_ms = 0,
    takeover = 'never',
  })
  vim.cmd('Papyri start')
  wait_until(function()
    return papyri.client.connected
  end, 'start')
  vim.cmd('Papyri zoom in')
  wait_until(function()
    return latest(server, 'zoom') ~= nil
  end, 'subcommand zoom')
  equal(latest(server, 'zoom').params.action, 'in')
  vim.cmd('Papyri theme mocha')
  wait_until(function()
    return latest(server, 'theme') ~= nil
  end, 'subcommand theme')
  equal(latest(server, 'theme').params.theme, 'mocha')
  vim.cmd('Papyri state not-json')
  wait_until(function()
    for _, message in ipairs(messages) do
      if message.message:find('JSON object', 1, true) then
        return true
      end
    end
    return false
  end, 'raw fallback')
  local completions = vim.fn.getcompletion('Papyri ', 'cmdline')
  truthy(vim.tbl_contains(completions, 'open'), 'open completion')
  truthy(vim.tbl_contains(completions, 'root'), 'root completion')
  truthy(vim.tbl_contains(completions, 'scroll-sync'), 'scroll-sync completion')
  server:stop()
end)

test('decorationless is requested on connection by default', function()
  local server = fake.new():start()
  local directory = root()
  vim.cmd('cd ' .. vim.fn.fnameescape(directory))
  papyri.setup({
    socket = server.path,
    auto_attach = false,
    launch = false,
    notify = false,
    decorationless = true,
    takeover = 'never',
  })
  vim.cmd('Papyri start')
  wait_until(function()
    return latest(server, 'decorationless') ~= nil
  end, 'decorationless request')
  equal(latest(server, 'decorationless').params.enabled, true)
  server:stop()
end)

test('decorationless is not forced when disabled', function()
  local server = fake.new():start()
  local directory = root()
  vim.cmd('cd ' .. vim.fn.fnameescape(directory))
  papyri.setup({
    socket = server.path,
    auto_attach = false,
    launch = false,
    notify = false,
    decorationless = false,
    takeover = 'never',
  })
  vim.cmd('Papyri start')
  wait_until(function()
    return papyri.client.connected
  end, 'connection')
  vim.wait(150)
  equal(latest(server, 'decorationless'), nil)
  server:stop()
end)

local failures = 0
for _, case in ipairs(tests) do
  reset()
  local ok, err = pcall(case.callback)
  if ok then
    io.write('ok   ' .. case.name .. '\n')
  else
    failures = failures + 1
    io.write('FAIL ' .. case.name .. '\n     ' .. tostring(err) .. '\n')
  end
end
reset()
support.cleanup()
vim.notify = saved_notify
if failures > 0 then
  io.write(tostring(failures) .. ' test(s) failed\n')
  vim.cmd('cq')
else
  io.write(tostring(#tests) .. ' tests passed\n')
  vim.cmd('qa!')
end

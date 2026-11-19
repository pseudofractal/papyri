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

local config = require('papyri.config')
local paths = require('papyri.paths')
local socket = require('papyri.socket')
local text = require('papyri.text')
local health = require('papyri.health')
local support = require('support')
local fake = require('fake_server')

local equal = support.equal
local truthy = support.truthy
local wait_until = support.wait_until
local fail = support.fail
local root = support.root
local write = support.write
local edit_as = support.edit_as
local edit = support.edit

local tests = {}

local function test(name, callback)
  table.insert(tests, { name = name, callback = callback })
end

local function throws(callback, fragment)
  local ok, err = pcall(callback)
  if ok then
    fail('expected an error')
  end
  if fragment and not tostring(err):find(fragment, 1, true) then
    fail('error did not contain ' .. fragment .. ': ' .. tostring(err))
  end
end

local function reset()
  vim.cmd('silent! %bwipeout!')
end

test('config defaults include Typst, scroll sync, and optional hooks', function()
  local cfg = config.merge({})
  equal(cfg.typst_main, 'main.typ')
  truthy(vim.tbl_contains(cfg.filetypes, 'typst'))
  equal(cfg.scroll_sync, true)
  equal(cfg.follow_insert, false)
  equal(cfg.scroll_debounce_ms, 80)
  equal(cfg.takeover, 'prompt')
  equal(cfg.focus_command, nil)
  equal(cfg.typst_root, nil)
end)

test('config rejects unknown, invalid, and malformed options', function()
  throws(function()
    config.merge({ nope = true })
  end, 'unknown option')
  throws(function()
    config.merge({ debounce_ms = -1 })
  end, 'debounce_ms')
  throws(function()
    config.merge({ scroll_debounce_ms = 'fast' })
  end, 'scroll_debounce_ms')
  throws(function()
    config.merge({ takeover = 'sometimes' })
  end, 'takeover')
  throws(function()
    config.merge({ filetypes = { 'markdown', 3 } })
  end, 'filetypes')
  throws(function()
    config.merge({ scroll_sync = 'yes' })
  end, 'scroll_sync')
  throws(function()
    config.merge({ follow_insert = 'yes' })
  end, 'follow_insert')
  truthy(config.merge({ focus_command = function() end }).focus_command ~= nil)
  truthy(config.merge({ typst_root = function() end }).typst_root ~= nil)
end)

test('config rejects boundary violations', function()
  throws(function()
    config.merge({ root_markers = 'not-a-list' })
  end, 'root_markers')
  throws(function()
    config.merge({ socket = 3 })
  end, 'socket')
  throws(function()
    config.merge({ papyri = '' })
  end, 'papyri')
  throws(function()
    config.merge({ typst_main = '' })
  end, 'typst_main')
  throws(function()
    config.merge({ focus_command = 3 })
  end, 'focus_command')
  throws(function()
    config.merge({ max_bytes = 0 })
  end, 'max_bytes')
  throws(function()
    config.merge({ ignore_globs = { 'ok', 1 } })
  end, 'ignore_globs')
end)

test('path normalization and containment are strict', function()
  equal(paths.normalize('/tmp/example/'), '/tmp/example')
  equal(paths.normalize(''), '')
  truthy(paths.inside('/a/b', '/a/b'))
  truthy(paths.inside('/a/b', '/a/b/c.md'))
  truthy(not paths.inside('/a/b', '/a/bc'))
  truthy(paths.inside('/', '/anywhere'))
  truthy(not paths.inside('/a', '/'))
end)

test('ignored paths cover default components and custom globs', function()
  local cfg = config.merge({ ignore_globs = { '**/skip/**' } })
  truthy(paths.ignored('/home/me/node_modules/pkg/readme.md', cfg), 'node_modules')
  truthy(paths.ignored('/home/me/.git/objects/x', cfg), '.git')
  truthy(paths.ignored('/home/me/skip/notes.md', cfg), 'custom glob')
  truthy(not paths.ignored('/home/me/notes.md', cfg), 'ordinary file')
end)

test('attachable_path filters unnamed, special, wrong, missing, and ignored buffers', function()
  local directory = root()
  local notes = directory .. '/notes.md'
  write(notes)
  vim.cmd('cd ' .. vim.fn.fnameescape(directory))
  local cfg = config.merge({})
  local bufnr = edit(notes)
  local path, project_root = paths.attachable_path(bufnr, cfg)
  equal(path, notes)
  equal(project_root, directory)

  vim.cmd('enew')
  equal(paths.attachable_path(vim.api.nvim_get_current_buf(), cfg), nil)

  bufnr = edit(notes)
  vim.bo[bufnr].buftype = 'nofile'
  equal(paths.attachable_path(bufnr, cfg), nil)
  vim.bo[bufnr].buftype = ''

  vim.bo[bufnr].filetype = 'text'
  equal(paths.attachable_path(bufnr, cfg), nil)
  vim.bo[bufnr].filetype = 'markdown'

  local missing = directory .. '/missing.md'
  vim.cmd('edit ' .. vim.fn.fnameescape(missing))
  vim.bo.filetype = 'markdown'
  equal(paths.attachable_path(vim.api.nvim_get_current_buf(), cfg), nil)

  local ignored = directory .. '/node_modules/pkg/readme.md'
  write(ignored)
  bufnr = edit(ignored)
  equal(paths.attachable_path(bufnr, cfg), nil)

  local outside = '/var/tmp/papyri-nvim-unit-' .. vim.fn.getpid() .. '/outside.md'
  write(outside)
  bufnr = edit(outside)
  equal(paths.attachable_path(bufnr, cfg), nil, 'outside project root')
end)

test('socket path honors config, environment, runtime, and cache precedence', function()
  local saved = {
    override = vim.env.PAPYRI_CONTROL_SOCKET,
    runtime = vim.env.XDG_RUNTIME_DIR,
    cache = vim.env.XDG_CACHE_HOME,
  }
  vim.env.PAPYRI_CONTROL_SOCKET = '/tmp/papyri-override.sock'
  equal(paths.socket_path(config.merge({})), '/tmp/papyri-override.sock')
  equal(
    paths.socket_path(config.merge({ socket = '/tmp/papyri-config.sock' })),
    '/tmp/papyri-config.sock'
  )
  equal(
    paths.socket_path(config.merge({
      socket = function()
        return '/tmp/papyri-fn.sock'
      end,
    })),
    '/tmp/papyri-fn.sock'
  )
  vim.env.PAPYRI_CONTROL_SOCKET = ''
  vim.env.XDG_RUNTIME_DIR = '/run/user/1000'
  equal(paths.socket_path(config.merge({})), '/run/user/1000/papyri/control.sock')
  vim.env.XDG_RUNTIME_DIR = ''
  vim.env.XDG_CACHE_HOME = '/tmp/papyri-cache'
  equal(paths.socket_path(config.merge({})), '/tmp/papyri-cache/papyri/control.sock')
  vim.env.PAPYRI_CONTROL_SOCKET = saved.override
  vim.env.XDG_RUNTIME_DIR = saved.runtime
  vim.env.XDG_CACHE_HOME = saved.cache
end)

test('socket path falls back to the private temporary directory', function()
  local saved = {
    override = vim.env.PAPYRI_CONTROL_SOCKET,
    runtime = vim.env.XDG_RUNTIME_DIR,
    cache = vim.env.XDG_CACHE_HOME,
    home = vim.env.HOME,
  }
  vim.env.PAPYRI_CONTROL_SOCKET = ''
  vim.env.XDG_RUNTIME_DIR = ''
  vim.env.XDG_CACHE_HOME = ''
  vim.env.HOME = ''
  local uid = 0
  if vim.uv.getuid then
    uid = vim.uv.getuid()
  end
  local expected =
    vim.fs.normalize(vim.fs.joinpath(vim.uv.os_tmpdir(), 'papyri-' .. uid, 'control.sock'))
  equal(paths.socket_path(config.merge({})), expected)
  vim.env.PAPYRI_CONTROL_SOCKET = saved.override
  vim.env.XDG_RUNTIME_DIR = saved.runtime
  vim.env.XDG_CACHE_HOME = saved.cache
  vim.env.HOME = saved.home
end)

test('root_for uses the nearest marker or falls back to the working directory', function()
  local cfg = config.merge({})
  local directory = root()
  local nested = directory .. '/src/chapter.md'
  write(nested)
  vim.cmd('cd ' .. vim.fn.fnameescape(directory))
  local bufnr = edit(nested)
  equal(paths.root_for(bufnr, cfg), directory)

  local plain = '/var/tmp/papyri-nvim-root-' .. vim.fn.getpid()
  vim.fn.mkdir(plain, 'p')
  local file = plain .. '/notes.md'
  write(file)
  vim.cmd('cd ' .. vim.fn.fnameescape(plain))
  bufnr = edit(file)
  equal(paths.root_for(bufnr, cfg), plain)
end)

test('Typst root resolution handles a project-root main file', function()
  local directory = root()
  local main = directory .. '/main.typ'
  local chapter = directory .. '/src/chapter.typ'
  write(main)
  write(chapter)
  vim.cmd('cd ' .. vim.fn.fnameescape(directory))
  local bufnr = edit_as(chapter, 'typst')
  equal(paths.typst_root(bufnr, config.merge({})), main)
end)

test(
  'Typst root resolution handles siblings, entrypoints, overrides, and standalone files',
  function()
    local cfg = config.merge({})
    local directory = root()
    local main = directory .. '/main.typ'
    local chapter = directory .. '/chapter.typ'
    write(main)
    write(chapter)
    vim.cmd('cd ' .. vim.fn.fnameescape(directory))
    local bufnr = edit_as(chapter, 'typst')
    equal(paths.typst_root(bufnr, cfg), main)

    local project = vim.fn.tempname()
    vim.fn.mkdir(project, 'p')
    write(project .. '/typst.toml', { '[package]', 'entrypoint = "book.typ"' })
    local book = project .. '/book.typ'
    local part = project .. '/part.typ'
    write(book)
    write(part)
    bufnr = edit_as(part, 'typst')
    equal(paths.typst_root(bufnr, cfg), book)

    local override = directory .. '/override.typ'
    write(override)
    equal(
      paths.typst_root(
        bufnr,
        config.merge({
          typst_root = function()
            return override
          end,
        })
      ),
      override
    )

    local standalone = vim.fn.tempname()
    vim.fn.mkdir(standalone, 'p')
    local solo = standalone .. '/solo.typ'
    write(solo)
    bufnr = edit_as(solo, 'typst')
    equal(paths.typst_root(bufnr, cfg), solo)
  end
)

test('Typst path ownership stays under the main document', function()
  local root_path = '/home/me/paper/main.typ'
  truthy(paths.typst_allowed(root_path, root_path))
  truthy(paths.typst_allowed(root_path, '/home/me/paper/chapter.typ'))
  truthy(paths.typst_allowed(root_path, '/home/me/paper/sub/part.typ'))
  truthy(not paths.typst_allowed(root_path, '/home/me/other/part.typ'))
  truthy(not paths.typst_allowed(root_path, '/home/me/paper/notes.md'))
end)

test('socket requests surface app errors and time out', function()
  local server = fake
    .new({
      fail = function()
        return nil, 'deliberate failure'
      end,
      hang = function()
        return fake.no_reply
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

  local failure
  client:request('fail', {}, function(err)
    failure = err
  end)
  wait_until(function()
    return failure ~= nil
  end, 'error response')
  truthy(failure:find('deliberate failure', 1, true) ~= nil, 'error message')

  local timeout
  client:request('hang', {}, function(err)
    timeout = err
  end, 100)
  wait_until(function()
    return timeout ~= nil
  end, 'timeout')
  truthy(timeout:find('did not respond', 1, true) ~= nil, 'timeout message')

  local closed
  client:request('hang', {}, function(err)
    closed = err
  end)
  vim.wait(50)
  client:close()
  wait_until(function()
    return closed ~= nil
  end, 'closed request')
  truthy(closed:find('closed', 1, true) ~= nil, 'closed message')
  server:stop()
end)

test('socket reconnects after the server returns', function()
  local path = vim.fn.tempname() .. '.sock'
  local first = fake
    .new({
      ping = function()
        return { value = 1 }
      end,
    }, path)
    :start()
  local client = socket.new({ path = path, notify = function() end })
  local connected = false
  client:connect(function(err)
    truthy(not err, 'initial connect')
    connected = true
  end)
  wait_until(function()
    return connected
  end, 'initial connection')
  local response
  client:request('ping', {}, function(err, value)
    truthy(not err, 'initial ping')
    response = value
  end)
  wait_until(function()
    return response ~= nil
  end, 'initial ping response')
  equal(response.value, 1)

  first:stop()
  wait_until(function()
    return not client.connected
  end, 'disconnect')
  local second = fake
    .new({
      ping = function()
        return { value = 2 }
      end,
    }, path)
    :start()
  wait_until(function()
    return client.connected
  end, 'reconnection', 8000)
  response = nil
  client:request('ping', {}, function(err, value)
    truthy(not err, 'reconnect ping')
    response = value
  end)
  wait_until(function()
    return response ~= nil
  end, 'reconnect response')
  equal(response.value, 2)
  client:close()
  second:stop()
end)

test('socket ignores malformed messages and dispatches subscriptions', function()
  local server = fake
    .new({
      ping = function()
        return { ok = true }
      end,
    })
    :start()
  local notices = {}
  local states = {}
  local client = socket.new({
    path = server.path,
    notify = function(message)
      table.insert(notices, message)
    end,
  })
  client.on_state = function(state)
    table.insert(states, state)
  end
  local connected = false
  client:connect(function(err)
    truthy(not err, 'connect error')
    connected = true
  end)
  wait_until(function()
    return connected
  end, 'connection')
  client:handle_line('not json')
  truthy(#notices > 0, 'malformed message notice')
  local subscribed = false
  client:subscribe({ 'state' }, function(err)
    subscribed = not err
  end)
  wait_until(function()
    return subscribed
  end, 'subscription')
  server:emit('state', { value = 2 })
  wait_until(function()
    return #states >= 2 and states[#states].value == 2
  end, 'state event')
  client:close()
  server:stop()
end)

test('health check reports without raising', function()
  local calls = { ok = 0, warn = 0, error = 0 }
  local saved_health = vim.health
  local saved_executable = vim.fn.executable
  vim.health = {
    start = function() end,
    ok = function()
      calls.ok = calls.ok + 1
    end,
    warn = function()
      calls.warn = calls.warn + 1
    end,
    error = function()
      calls.error = calls.error + 1
    end,
    info = function() end,
  }
  vim.fn.executable = function()
    return 1
  end
  local ok, err = pcall(health.check)
  vim.health = saved_health
  vim.fn.executable = saved_executable
  if not ok then
    error(err)
  end
  equal(calls.error, 0)
  truthy(calls.ok > 0, 'health ok checks')
end)

test('health check reports a missing Papyri executable', function()
  local calls = { ok = 0, warn = 0, error = 0 }
  local saved_health = vim.health
  local saved_executable = vim.fn.executable
  vim.health = {
    start = function() end,
    ok = function()
      calls.ok = calls.ok + 1
    end,
    warn = function()
      calls.warn = calls.warn + 1
    end,
    error = function()
      calls.error = calls.error + 1
    end,
    info = function() end,
  }
  vim.fn.executable = function()
    return 0
  end
  local ok, err = pcall(health.check)
  vim.health = saved_health
  vim.fn.executable = saved_executable
  if not ok then
    error(err)
  end
  truthy(calls.error > 0, 'missing executable error')
end)

test('null-id transport errors fail pending requests', function()
  local client = socket.new({ path = '/nonexistent.sock', notify = function() end })
  local failed, code
  client.pending[7] = {
    callback = function(err, _, info)
      failed = err
      code = info and info.code
    end,
    timer = nil,
    method = 'preview.update',
  }
  client:handle_line(vim.json.encode({
    id = vim.NIL,
    error = { code = 'request-too-large', message = 'Control request exceeds 32 MiB.' },
  }))
  equal(failed, 'Control request exceeds 32 MiB.')
  equal(code, 'request-too-large')
  equal(next(client.pending), nil)
end)

test('utf16 column fallback works without the newer API', function()
  local saved = vim.str_utfindex
  vim.str_utfindex = function()
    error('unsupported')
  end
  equal(text.utf16_column('é Updated', 3), 2)
  equal(text.utf16_column('𝔸b', 4), 2)
  vim.str_utfindex = saved
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
if failures > 0 then
  io.write(tostring(failures) .. ' test(s) failed\n')
  vim.cmd('cq')
else
  io.write(tostring(#tests) .. ' tests passed\n')
  vim.cmd('qa!')
end

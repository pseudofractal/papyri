local constants = require('papyri.constants')
local timer = require('papyri.timer')
local paths = require('papyri.paths')
local text = require('papyri.text')
local typst = require('papyri.typst')
local jump = require('papyri.jump')
local viewport = require('papyri.viewport')

--- Attachment lifecycle for external editors: ownership, preview-only
--- overlays, cursor following, heartbeats, buffer events, and jumps.
local M = {}

local function is_transport_error(message, info)
  return (info and info.code == 'request-too-large')
    or (message and message:find('transport limit', 1, true) ~= nil)
end

local function new_owner()
  local seed = tostring(vim.uv.hrtime()) .. ':' .. tostring(vim.fn.getpid())
  return 'nvim-' .. vim.fn.getpid() .. '-' .. vim.fn.sha256(seed):sub(1, 16)
end

function M.setup(config, client, notify, ensure_connection)
  M.config = config
  M.client = client
  M.notify = notify
  M.ensure_connection = ensure_connection
  M.owner = new_owner()
  M.attached = false
  M.kind = 'markdown'
  M.root = nil
  M.buf = nil
  M.path = nil
  M.paths = {}
  M.revision = 0
  M.update_id = 0
  M.sent = {}
  M.sent_text = nil
  M.warned_size = false
  M.warned_paths = {}
  M.warned_transport = false
  M.unregistered = {}
  M.suppressed = nil
  M.update_timer = nil
  M.reveal_timer = nil
  M.attach_timer = nil
  M.attaching = false
  M.pending_buf = nil
  M.needs_reattach = false
  M.heartbeat_timer = nil
  M.scroll_timer = nil
  M.suppress_reveal_until = 0
  M.suppress_viewport_until = 0
  M.suppress_scroll_sync_until = 0
  M.last_topline = nil
end

function M.status()
  return {
    attached = M.attached,
    kind = M.kind,
    root = M.root,
    path = M.path,
    paths = vim.deepcopy(M.paths),
    owner = M.owner,
    follow = M.config and M.config.follow or false,
    scroll = M.config and M.config.scroll_sync or false,
  }
end

function M.buffer_path(bufnr)
  bufnr = bufnr or vim.api.nvim_get_current_buf()
  local path, root = paths.attachable_path(bufnr, M.config)
  return path, root
end

local function clear()
  M.attached = false
  M.kind = 'markdown'
  M.root = nil
  M.buf = nil
  M.path = nil
  M.paths = {}
  M.revision = 0
  M.update_id = 0
  M.sent = {}
  M.sent_text = nil
  M.warned_size = false
  M.warned_paths = {}
  M.warned_transport = false
  M.unregistered = {}
  M.update_timer = timer.stop(M.update_timer)
  M.reveal_timer = timer.stop(M.reveal_timer)
  M.attach_timer = timer.stop(M.attach_timer)
  M.heartbeat_timer = timer.stop(M.heartbeat_timer)
  M.scroll_timer = timer.stop(M.scroll_timer)
  M.pending_buf = nil
  M.needs_reattach = false
  M.suppress_viewport_until = 0
  M.suppress_scroll_sync_until = 0
  M.last_topline = nil
end

--- Release ownership. Auto-attach remains suppressed for this document (or
--- the Typst project root) until the user attaches explicitly.
function M.detach(quiet)
  if not M.attached then
    return
  end
  local path = M.root
  clear()
  M.suppressed = path
  M.client:request('preview.detach', { owner = M.owner }, function(err)
    if err and not quiet then
      M.notify('Papyri detach failed: ' .. err, vim.log.levels.WARN)
    end
  end)
end

local function start_heartbeat()
  M.heartbeat_timer = timer.stop(M.heartbeat_timer)
  M.heartbeat_timer = timer.every(constants.HEARTBEAT_MS, function()
    if not M.attached then
      return
    end
    M.client:request('preview.heartbeat', { owner = M.owner }, function(err, _, info)
      if not err or not M.attached then
        return
      end
      local code = info and info.code
      if code == 'attachment-replaced' then
        local root = M.root
        clear()
        M.suppressed = root
        M.notify('Another editor took over the Papyri preview.', vim.log.levels.INFO)
      elseif
        code == 'attachment-expired'
        or (not code and err:find('No matching preview attachment', 1, true))
      then
        M.needs_reattach = true
        M.on_connect()
      end
    end)
  end)
end

local function handle_takeover(callback)
  if M.config.takeover == 'always' then
    callback(true)
    return
  end
  if M.config.takeover == 'never' then
    M.notify('Papyri is attached to another editor.', vim.log.levels.WARN)
    callback(false)
    return
  end
  vim.ui.select({ 'Take over', 'Cancel' }, {
    prompt = 'Papyri: the preview is attached to another editor',
  }, function(choice)
    callback(choice == 'Take over')
  end)
end

function M.warn_oversized(path, stale)
  if M.warned_paths[path] then
    return
  end
  M.warned_paths[path] = true
  local message = 'Typst source is larger than the preview limit; '
  if stale then
    message = message .. 'Papyri keeps the last preview text: '
  else
    message = message .. 'Papyri will use the saved file: '
  end
  M.notify(message .. text.display(path), vim.log.levels.WARN)
end

function M.warn_transport()
  if M.warned_transport then
    return
  end
  M.warned_transport = true
  M.notify(
    "This change is too large for Papyri's control transport; "
      .. 'the preview may not show the latest unsaved text.',
    vim.log.levels.WARN
  )
end

function M.ensure_typst_path(bufnr)
  local path = text.path(bufnr)
  local known = path ~= nil and vim.tbl_contains(M.paths, path)
  local current = typst.ensure_path(M, bufnr, constants.MAX_TYPST_PATHS, function()
    M.notify('Papyri tracks at most 64 Typst files per project.', vim.log.levels.WARN)
  end)
  if current and not known then
    M.unregistered[current] = true
    M.schedule_update()
  end
  return current
end

--- Attach a Markdown or Typst buffer. Typst resolves the main document and
--- streams every modified source under it.
function M.attach(bufnr, options)
  options = options or {}
  bufnr = bufnr or vim.api.nvim_get_current_buf()
  local path, project_root = paths.attachable_path(bufnr, M.config)
  if not path then
    if not options.quiet then
      M.notify('This buffer is not an attachable document.', vim.log.levels.WARN)
    end
    return
  end
  local kind = vim.bo[bufnr].filetype == 'typst' and 'typst' or 'markdown'
  local attach_path = path
  local attached_paths = { path }
  local documents = {}
  local markdown_text
  if kind == 'typst' then
    attach_path = options.root or paths.typst_root(bufnr, M.config) or path
    if not paths.inside(project_root, attach_path) then
      attach_path = path
    end
    attached_paths = typst.collect_paths(attach_path, path, constants.MAX_TYPST_PATHS)
    documents = typst.documents(attached_paths, M.config.max_bytes, M.warn_oversized)
  else
    local body, size = text.buffer(bufnr)
    if size > M.config.max_bytes then
      if not M.warned_size then
        M.notify(
          'This buffer is larger than the preview limit; Papyri will show the saved file.',
          vim.log.levels.WARN
        )
        M.warned_size = true
      end
    else
      markdown_text = body
      documents = { { path = path, text = body } }
    end
  end
  if
    M.attached
    and M.kind == kind
    and M.root == attach_path
    and M.buf == bufnr
    and M.path == path
    and not options.force
  then
    if options.reveal then
      M.reveal(true)
    end
    return
  end
  if M.attaching then
    M.pending_buf = bufnr
    return
  end
  local function finish()
    M.attaching = false
    local pending = M.pending_buf
    M.pending_buf = nil
    if pending and vim.api.nvim_buf_is_valid(pending) then
      vim.schedule(function()
        M.attach(pending, { quiet = true })
      end)
    end
  end
  local function send(takeover)
    M.ensure_connection(function(err)
      if err then
        M.notify('Papyri is unavailable: ' .. err, vim.log.levels.ERROR)
        finish()
        return
      end
      local params = {
        owner = M.owner,
        kind = kind,
        path = attach_path,
        paths = attached_paths,
        takeover = takeover,
      }
      if #documents > 0 then
        params.documents = documents
      end
      M.client:request('preview.attach', params, function(request_error, result, error_info)
        if request_error then
          if is_transport_error(request_error, error_info) and #documents > 0 then
            documents = {}
            M.warn_transport()
            send(takeover)
            return
          end
          if
            not takeover
            and (
              (error_info and error_info.code == 'attachment-replaced')
              or request_error:find('attached to', 1, true)
            )
          then
            handle_takeover(function(accepted)
              if accepted then
                send(true)
              else
                finish()
              end
            end)
            return
          end
          M.notify('Papyri attach failed: ' .. request_error, vim.log.levels.ERROR)
          finish()
          return
        end
        if result and result.attachment and result.attachment.owner ~= M.owner then
          M.notify('Papyri did not confirm the attachment.', vim.log.levels.ERROR)
          finish()
          return
        end
        M.attached = true
        M.kind = kind
        M.root = attach_path
        M.buf = bufnr
        M.path = path
        M.paths = attached_paths
        M.revision = 0
        M.sent = {}
        M.unregistered = {}
        for _, document in ipairs(documents) do
          M.sent[document.path] = document.text
        end
        M.sent_text = markdown_text
        M.suppressed = nil
        M.needs_reattach = false
        M.last_topline = nil
        if not options.quiet then
          M.notify('Attached ' .. text.display(attach_path) .. ' to Papyri.')
        end
        if options.reveal then
          M.reveal(true)
        else
          M.reveal(false)
        end
        M.schedule_update()
        start_heartbeat()
        finish()
      end)
    end, path)
  end
  M.attaching = true
  send(options.takeover == true)
end

--- Push changed text as preview-only overlays. Sent state advances only after
--- the server accepts the revision, so ordinary failures are retried. A
--- transport-limit failure marks the text sent and warns because retrying the
--- same oversized payload would fail identically.
function M.update_now(callback)
  if not M.attached or not M.root or not M.buf then
    if callback then
      callback()
    end
    return
  end
  if not vim.api.nvim_buf_is_valid(M.buf) then
    if callback then
      callback()
    end
    return
  end
  if M.kind == 'typst' then
    M.ensure_typst_path(M.buf)
    local documents = {}
    local pending = {}
    for _, path in ipairs(M.paths) do
      local bufnr = vim.fn.bufnr(path)
      if bufnr > 0 and vim.api.nvim_buf_is_loaded(bufnr) then
        local modified = vim.bo[bufnr].modified
        local unregistered = M.unregistered[path]
        if modified or unregistered or M.sent[path] ~= nil then
          local body, size = text.buffer(bufnr)
          if size <= M.config.max_bytes then
            if M.sent[path] ~= body then
              table.insert(documents, { path = path, text = body })
              pending[path] = body
            end
          elseif modified then
            M.warn_oversized(path, true)
          end
        end
      end
    end
    if #documents == 0 then
      if callback then
        callback()
      end
      return
    end
    local update_id = M.update_id + 1
    M.update_id = update_id
    M.revision = M.revision + 1
    M.client:request('preview.update', {
      owner = M.owner,
      revision = M.revision,
      documents = documents,
    }, function(err, _result, error_info)
      if err then
        if is_transport_error(err, error_info) then
          for path, body in pairs(pending) do
            M.sent[path] = body
            M.unregistered[path] = nil
          end
          M.warn_transport()
        else
          M.notify('Papyri update failed: ' .. err, vim.log.levels.WARN)
        end
      elseif M.update_id == update_id then
        for path, body in pairs(pending) do
          M.sent[path] = body
          M.unregistered[path] = nil
        end
        M.warned_transport = false
      end
      if callback then
        callback()
      end
    end)
    return
  end
  local body, size = text.buffer(M.buf)
  if size > M.config.max_bytes then
    if not M.warned_size then
      M.notify(
        'This buffer is larger than the preview limit; Papyri will show the saved file.',
        vim.log.levels.WARN
      )
      M.warned_size = true
    end
    if M.sent_text == nil then
      if callback then
        callback()
      end
      return
    end
    local update_id = M.update_id + 1
    M.update_id = update_id
    M.revision = M.revision + 1
    M.client:request('preview.update', {
      owner = M.owner,
      revision = M.revision,
      documents = {},
    }, function(err)
      if err then
        M.notify('Papyri update failed: ' .. err, vim.log.levels.WARN)
      elseif M.update_id == update_id then
        M.sent_text = nil
      end
      if callback then
        callback()
      end
    end)
    return
  end
  if body == M.sent_text then
    if callback then
      callback()
    end
    return
  end
  local update_id = M.update_id + 1
  M.update_id = update_id
  M.revision = M.revision + 1
  M.client:request('preview.update', {
    owner = M.owner,
    revision = M.revision,
    documents = { { path = M.path, text = body } },
  }, function(err, _result, error_info)
    if err then
      if is_transport_error(err, error_info) then
        M.sent_text = body
        M.warn_transport()
      else
        M.notify('Papyri update failed: ' .. err, vim.log.levels.WARN)
      end
    elseif M.update_id == update_id then
      M.sent_text = body
      M.warned_transport = false
    end
    if callback then
      callback()
    end
  end)
end

function M.schedule_update()
  if not M.attached then
    return
  end
  M.update_timer = timer.stop(M.update_timer)
  if M.config.debounce_ms == 0 then
    M.update_now()
    return
  end
  M.update_timer = timer.after(M.config.debounce_ms, M.update_now)
end

--- Reveal the cursor line. Normal follow is coalesced and suppressed briefly
--- after preview-driven jumps.
function M.reveal(force)
  if not M.attached or not M.root then
    return
  end
  if not force and not M.config.follow then
    return
  end
  if vim.uv.hrtime() < (M.suppress_reveal_until or 0) then
    return
  end
  local bufnr = vim.api.nvim_get_current_buf()
  if M.kind == 'typst' then
    local path = M.ensure_typst_path(bufnr)
    if not path then
      return
    end
    M.buf = bufnr
    M.path = path
  elseif bufnr ~= M.buf then
    return
  end
  local function send()
    M.update_now(function()
      local cursor = vim.api.nvim_win_get_cursor(0)
      local line = vim.api.nvim_get_current_line()
      M.suppress_viewport_until = vim.uv.hrtime() + constants.SUPPRESS_NS
      M.suppress_scroll_sync_until = vim.uv.hrtime() + constants.SUPPRESS_NS
      M.client:request('preview.reveal', {
        owner = M.owner,
        path = M.path,
        line = math.max(0, cursor[1] - 1),
        character = text.utf16_column(line, cursor[2]),
        align = 'center',
      }, function(err, result)
        if err and force then
          M.notify('Papyri reveal failed: ' .. err, vim.log.levels.WARN)
        end
        if result and result.skipped and force then
          local reasons = {
            inactive = 'The Papyri tab is not active; reveal skipped.',
            hidden = 'The Typst live pane is hidden; reveal skipped.',
            starting = 'The Typst live pane is still starting; reveal skipped.',
          }
          M.notify(reasons[result.reason] or 'Papyri skipped the reveal.', vim.log.levels.INFO)
        end
      end)
    end)
  end
  M.reveal_timer = timer.stop(M.reveal_timer)
  if M.config.debounce_ms == 0 then
    send()
    return
  end
  M.reveal_timer = timer.after(M.config.debounce_ms, send)
end

function M.toggle_follow(enabled)
  if enabled == nil then
    M.config.follow = not M.config.follow
  else
    M.config.follow = enabled
  end
  M.notify(
    'Papyri follow is ' .. (M.config.follow and 'on' or 'off') .. '.',
    vim.log.levels.INFO,
    true
  )
end

function M.sync_viewport()
  viewport.sync(M)
end

function M.schedule_viewport_sync()
  viewport.schedule(M)
end

--- Apply a `preview.viewport` event without moving the cursor.
function M.on_viewport(data)
  viewport.on_event(M, data)
end

function M.toggle_scroll_sync(enabled)
  if enabled == nil then
    M.config.scroll_sync = not M.config.scroll_sync
  else
    M.config.scroll_sync = enabled
  end
  M.notify(
    'Papyri scroll sync is ' .. (M.config.scroll_sync and 'on' or 'off') .. '.',
    vim.log.levels.INFO,
    true
  )
end

local function is_suppressed(bufnr, path)
  if not M.suppressed then
    return false
  end
  if M.suppressed == path then
    return true
  end
  if vim.bo[bufnr].filetype == 'typst' then
    local root = paths.typst_root(bufnr, M.config) or path
    return root == M.suppressed
  end
  return false
end

local function adopt_typst_buffer(bufnr, path)
  if not (M.attached and M.kind == 'typst' and vim.bo[bufnr].filetype == 'typst') then
    return false
  end
  local root = paths.typst_root(bufnr, M.config) or path
  if root ~= M.root then
    return false
  end
  local current = M.ensure_typst_path(bufnr)
  if current then
    M.buf = bufnr
    M.path = current
    M.schedule_update()
    M.reveal(false)
  end
  return true
end

function M.on_buf_enter(bufnr)
  if not M.config.auto_attach then
    return
  end
  local path = paths.attachable_path(bufnr, M.config)
  if not path then
    return
  end
  if is_suppressed(bufnr, path) then
    return
  end
  if adopt_typst_buffer(bufnr, path) then
    return
  end
  if M.attached and M.buf == bufnr and M.path == path then
    return
  end
  -- BufEnter and FileType often fire together; coalesce them and attach the
  -- buffer that is current once the burst settles.
  M.attach_timer = timer.stop(M.attach_timer)
  M.attach_timer = timer.after(constants.ATTACH_COALESCE_MS, function()
    if not M.config.auto_attach then
      return
    end
    local current = vim.api.nvim_get_current_buf()
    local current_path = paths.attachable_path(current, M.config)
    if not current_path or is_suppressed(current, current_path) then
      return
    end
    if adopt_typst_buffer(current, current_path) then
      return
    end
    if M.attached and M.buf == current and M.path == current_path then
      return
    end
    M.attach(current, { quiet = true })
  end)
end

function M.on_text_changed(bufnr)
  if not M.attached then
    return
  end
  if M.kind == 'typst' then
    if M.ensure_typst_path(bufnr) then
      M.schedule_update()
    end
    return
  end
  if M.buf == bufnr then
    M.schedule_update()
  end
end

function M.on_write(bufnr)
  if M.attached then
    if M.kind == 'typst' then
      if M.ensure_typst_path(bufnr) then
        M.update_now()
      end
    elseif M.buf == bufnr then
      M.update_now()
    end
    return
  end
  if M.config.auto_attach then
    M.on_buf_enter(bufnr)
  end
end

function M.on_delete(bufnr)
  if not M.attached then
    return
  end
  local path = text.path(bufnr)
  if M.kind == 'typst' then
    if path == M.root then
      local root = M.root
      M.detach(true)
      M.client:request('close', { path = root }, function() end)
      return
    end
    if path then
      M.paths = vim.tbl_filter(function(value)
        return value ~= path
      end, M.paths)
      M.sent[path] = nil
      if M.buf == bufnr then
        M.buf = vim.fn.bufnr(M.root)
        M.path = M.root
      end
    end
    return
  end
  if M.buf ~= bufnr then
    return
  end
  local root = M.root
  M.detach(true)
  M.client:request('close', { path = root }, function() end)
end

function M.shutdown()
  if not M.attached then
    return
  end
  local done = false
  clear()
  if M.client.connected then
    M.client:request('preview.detach', { owner = M.owner }, function()
      done = true
    end)
    vim.wait(500, function()
      return done
    end, 10)
  end
end

function M.on_disconnect()
  M.needs_reattach = M.attached
end

function M.on_connect()
  if not M.needs_reattach or not M.attached or not M.buf then
    return
  end
  if not vim.api.nvim_buf_is_valid(M.buf) then
    clear()
    return
  end
  M.needs_reattach = false
  M.attached = false
  M.attach(M.buf, { quiet = true })
end

--- Open a preview click target, place the cursor, and run the focus command.
function M.on_jump(data)
  return jump.open_source(data, {
    attached = M.attached,
    owner = M.owner,
    root = M.root,
    focus_command = M.config.focus_command,
    on_before_open = function()
      local until_ns = vim.uv.hrtime() + constants.SUPPRESS_NS
      M.suppress_reveal_until = until_ns
      M.suppress_scroll_sync_until = until_ns
      M.suppress_viewport_until = until_ns
    end,
    on_open = function(bufnr, path)
      M.buf = bufnr
      M.path = path
      M.ensure_typst_path(bufnr)
    end,
  })
end

function M.on_state(state)
  if type(state) ~= 'table' then
    return
  end
  local current = state.attachment
  if not current or not current.active then
    if M.attached then
      if current and current.reason == 'expired' then
        M.needs_reattach = true
        M.on_connect()
        return
      end
      local root = M.root
      clear()
      M.suppressed = root
      M.notify('Papyri detached the preview.', vim.log.levels.INFO)
    end
    return
  end
  if M.attached and current.owner ~= M.owner then
    local root = M.root
    clear()
    M.suppressed = root
    M.notify('Another editor took over the Papyri preview.', vim.log.levels.INFO)
    return
  end
  if M.attached and current.owner == M.owner then
    M.revision = math.max(M.revision, current.revision or 0)
    if type(current.paths) == 'table' then
      local merged = {}
      local seen = {}
      for _, path in ipairs(current.paths) do
        if not seen[path] then
          seen[path] = true
          table.insert(merged, path)
        end
      end
      for path in pairs(M.unregistered) do
        if not seen[path] then
          seen[path] = true
          table.insert(merged, path)
        end
      end
      M.paths = merged
      for path in pairs(M.unregistered) do
        if vim.tbl_contains(current.paths, path) then
          M.unregistered[path] = nil
        end
      end
    end
  end
end

return M

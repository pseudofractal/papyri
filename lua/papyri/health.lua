--- `:checkhealth papyri` entry point.
local M = {}

local function lsp_status(name)
  if vim.fn.executable(name) == 1 then
    vim.health.ok('`' .. name .. '` found on PATH')
  else
    vim.health.warn(
      '`' .. name .. '` was not found on PATH; that filetype will not have LSP support.'
    )
  end
end

local function probe(socket_path)
  local client = require('papyri.socket').new({
    path = socket_path,
    notify = function() end,
  })
  local done, state, failure = false, nil, nil
  client:request('state', {}, function(err, result)
    done = true
    state = result
    failure = err
  end, 1000)
  vim.wait(1500, function()
    return done
  end, 10)
  client:close()
  return state, failure
end

function M.check()
  vim.health.start('papyri.nvim')
  if vim.fn.has('nvim-0.10') == 1 then
    vim.health.ok('Neovim ' .. tostring(vim.version()))
  else
    vim.health.error('Neovim 0.10 or newer is required.')
  end

  local papyri = require('papyri')
  local config = papyri.config or require('papyri.config').merge({})
  if vim.fn.executable(config.papyri) == 1 then
    vim.health.ok('`' .. config.papyri .. '` found on PATH')
  else
    vim.health.error('`' .. config.papyri .. '` was not found on PATH')
  end

  if vim.fn.has('unix') == 1 then
    vim.health.ok('Unix control socket transport')
  else
    vim.health.warn('The Papyri control socket requires a Unix platform.')
  end

  local ok, socket_path = pcall(require('papyri.paths').socket_path, config)
  if not ok then
    vim.health.error('Could not resolve the control socket: ' .. tostring(socket_path))
    return
  end
  if not vim.uv.fs_stat(socket_path) then
    vim.health.warn('No control socket at ' .. socket_path .. '; it will be created on launch.')
  else
    local state, failure = probe(socket_path)
    if state then
      local identity = state.version or 'unknown version'
      if state.build and state.build ~= 'unknown' then
        identity = identity .. '+' .. state.build
      end
      vim.health.ok('Papyri ' .. identity .. ' at ' .. socket_path)
      local features = state.features or {}
      if vim.tbl_contains(features, 'preview.attach') then
        vim.health.ok('Preview attachment feature is available')
      else
        vim.health.error('This Papyri build does not advertise `preview.attach`; update Papyri.')
      end
    else
      vim.health.error(
        'Control socket exists but Papyri did not answer: ' .. tostring(failure or 'timeout')
      )
    end
  end

  if papyri.client and papyri.client.connected then
    vim.health.ok('This Neovim session is connected')
  else
    vim.health.info('Not connected yet; the first attach connects or launches Papyri.')
  end

  lsp_status('tinymist')
  lsp_status('marksman')
end

return M

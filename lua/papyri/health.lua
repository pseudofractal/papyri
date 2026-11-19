--- `:checkhealth papyri` entry point.
local M = {}

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

  local ok, socket = pcall(require('papyri.paths').socket_path, config)
  if not ok then
    vim.health.error('Could not resolve the control socket: ' .. tostring(socket))
    return
  end
  if vim.uv.fs_stat(socket) then
    vim.health.ok('Control socket: ' .. socket)
  else
    vim.health.warn('No control socket at ' .. socket .. '; it will be created on launch.')
  end

  if papyri.client and papyri.client.connected then
    vim.health.ok('Connected to Papyri')
  else
    vim.health.info('Not connected yet; the first attach connects or launches Papyri.')
  end
end

return M

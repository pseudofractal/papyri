--- Pure path helpers, buffer eligibility, socket resolution, and Typst
--- project discovery.
local M = {}

function M.normalize(path)
  if type(path) ~= 'string' or path == '' then
    return ''
  end
  local absolute = vim.fn.fnamemodify(path, ':p')
  local normalized = vim.fs.normalize(absolute)
  if #normalized > 1 then
    normalized = normalized:gsub('/+$', '')
  end
  return normalized
end

function M.inside(root, path)
  if root == '' or path == '' then
    return false
  end
  if path == root then
    return true
  end
  if root == '/' then
    return path:sub(1, 1) == '/'
  end
  return path:sub(1, #root + 1) == root .. '/'
end

function M.root_for(bufnr, config)
  local name = vim.api.nvim_buf_get_name(bufnr)
  local root = name ~= '' and vim.fs.root(name, config.root_markers) or nil
  if not root or root == '' then
    root = vim.fn.getcwd()
  end
  return M.normalize(root)
end

local glob_cache = setmetatable({}, { __mode = 'k' })

local function glob_matchers(config)
  local cached = glob_cache[config]
  if cached then
    return cached
  end
  local matchers = { lpeg = {}, regex = {} }
  local use_lpeg = vim.glob and vim.glob.to_lpeg
  for _, glob in ipairs(config.ignore_globs) do
    if use_lpeg then
      local ok, pattern = pcall(vim.glob.to_lpeg, glob)
      if ok then
        table.insert(matchers.lpeg, pattern)
      end
    else
      local ok, regex = pcall(vim.fn.glob2regpat, glob)
      if ok then
        table.insert(matchers.regex, regex)
      end
    end
  end
  glob_cache[config] = matchers
  return matchers
end

function M.ignored(path, config)
  for component in path:gmatch('[^/]+') do
    if component == '.git' or component == 'node_modules' then
      return true
    end
  end
  local matchers = glob_matchers(config)
  for _, pattern in ipairs(matchers.lpeg) do
    if pattern:match(path) then
      return true
    end
  end
  for _, regex in ipairs(matchers.regex) do
    if vim.fn.match(path, regex) >= 0 then
      return true
    end
  end
  return false
end

--- Return the normalized path and project root when a buffer may attach.
function M.attachable_path(bufnr, config)
  if not vim.api.nvim_buf_is_valid(bufnr) then
    return nil
  end
  if vim.bo[bufnr].buftype ~= '' then
    return nil
  end
  local name = vim.api.nvim_buf_get_name(bufnr)
  if name == '' then
    return nil
  end
  local filetype = vim.bo[bufnr].filetype
  local supported = false
  for _, value in ipairs(config.filetypes) do
    if value == filetype then
      supported = true
      break
    end
  end
  if not supported then
    return nil
  end
  local path = M.normalize(name)
  local stat = vim.uv.fs_stat(path)
  if not stat or stat.type ~= 'file' then
    return nil
  end
  local root = M.root_for(bufnr, config)
  if not M.inside(root, path) then
    return nil
  end
  if M.ignored(path, config) then
    return nil
  end
  return path, root
end

function M.is_typst(path)
  return type(path) == 'string' and path:lower():sub(-4) == '.typ'
end

function M.typst_entrypoint(root)
  local toml = M.normalize(root .. '/typst.toml')
  if not vim.uv.fs_stat(toml) then
    return nil
  end
  local ok, lines = pcall(vim.fn.readfile, toml)
  if not ok then
    return nil
  end
  local in_package = false
  for _, line in ipairs(lines) do
    local section = line:match('^%s*%[([^%]]+)%]')
    if section then
      in_package = section == 'package'
    end
    if in_package then
      local entry = line:match('^%s*entrypoint%s*=%s*["\']([^"\']+)["\']')
      if entry then
        local path = M.normalize(root .. '/' .. entry)
        if vim.uv.fs_stat(path) then
          return path
        end
      end
    end
  end
  return nil
end

--- Resolve the Typst main document for a buffer: override, sibling main,
--- typst.toml entrypoint, project-root main, then the buffer itself.
function M.typst_root(bufnr, config)
  if type(config.typst_root) == 'function' then
    local value = config.typst_root(bufnr)
    if type(value) == 'string' and value ~= '' then
      value = M.normalize(value)
      if vim.uv.fs_stat(value) then
        return value
      end
    end
  end
  local name = M.normalize(vim.api.nvim_buf_get_name(bufnr))
  if name == '' then
    return nil
  end
  if vim.fs.basename(name) == config.typst_main then
    return name
  end
  local directory = vim.fs.dirname(name)
  local sibling = M.normalize(directory .. '/' .. config.typst_main)
  if vim.uv.fs_stat(sibling) then
    return sibling
  end
  local typst_project = vim.fs.root(name, { 'typst.toml' })
  if typst_project then
    local entrypoint = M.typst_entrypoint(typst_project)
    if entrypoint then
      return entrypoint
    end
    local main = M.normalize(typst_project .. '/' .. config.typst_main)
    if vim.uv.fs_stat(main) then
      return main
    end
  end
  local root = vim.fs.root(name, config.root_markers)
  if root then
    local entrypoint = M.typst_entrypoint(root)
    if entrypoint then
      return entrypoint
    end
    local main = M.normalize(root .. '/' .. config.typst_main)
    if vim.uv.fs_stat(main) then
      return main
    end
  end
  return name
end

function M.typst_allowed(root, path)
  if not M.is_typst(path) then
    return false
  end
  if path == root then
    return true
  end
  local directory = vim.fs.dirname(root)
  if directory == '/' then
    return false
  end
  return path:sub(1, #directory + 1) == directory .. '/'
end

function M.cache_socket_path()
  local cache = vim.env.XDG_CACHE_HOME
  if not cache or cache == '' then
    local home = vim.env.HOME
    if home and home ~= '' then
      cache = home .. '/.cache'
    end
  end
  if cache and cache ~= '' then
    return M.normalize(cache .. '/papyri/control.sock')
  end
  local uid = 0
  if vim.uv.getuid then
    local ok, value = pcall(vim.uv.getuid)
    if ok and value then
      uid = value
    end
  end
  return M.normalize(vim.fs.joinpath(vim.uv.os_tmpdir(), 'papyri-' .. uid, 'control.sock'))
end

--- Resolve the control socket using config, PAPYRI_CONTROL_SOCKET, XDG
--- runtime/cache, and finally the private temporary directory.
function M.socket_path(config)
  if type(config.socket) == 'function' then
    local value = config.socket()
    if type(value) ~= 'string' or value == '' then
      error('papyri.nvim: `socket` function must return a path')
    end
    return M.normalize(value)
  end
  if type(config.socket) == 'string' and config.socket ~= '' then
    return M.normalize(config.socket)
  end
  local override = vim.env.PAPYRI_CONTROL_SOCKET
  if override and override ~= '' then
    return M.normalize(override)
  end
  local runtime = vim.env.XDG_RUNTIME_DIR
  if runtime and runtime ~= '' then
    return M.normalize(runtime .. '/papyri/control.sock')
  end
  return M.cache_socket_path()
end

return M

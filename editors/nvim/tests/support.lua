local M = {}

function M.fail(message)
  error(message, 3)
end

function M.equal(actual, expected, label)
  if not vim.deep_equal(actual, expected) then
    M.fail(
      (label or 'value')
        .. ': expected '
        .. vim.inspect(expected)
        .. ', got '
        .. vim.inspect(actual)
    )
  end
end

function M.truthy(value, label)
  if not value then
    M.fail((label or 'value') .. ' was not truthy')
  end
end

function M.wait_until(predicate, label, timeout)
  if not vim.wait(timeout or 3000, predicate, 10) then
    M.fail('timed out waiting for ' .. (label or 'condition'))
  end
end

local roots = {}

function M.root()
  local directory = vim.fn.tempname()
  vim.fn.mkdir(directory .. '/.git', 'p')
  table.insert(roots, directory)
  return directory
end

--- Remove temporary project roots created by the suite.
function M.cleanup()
  for _, directory in ipairs(roots) do
    vim.fn.delete(directory, 'rf')
  end
  roots = {}
end

function M.write(path, lines)
  vim.fn.mkdir(vim.fn.fnamemodify(path, ':h'), 'p')
  vim.fn.writefile(lines or { '# Title', '', 'Body' }, path)
end

function M.edit_as(path, filetype)
  vim.cmd('edit ' .. vim.fn.fnameescape(path))
  local bufnr = vim.api.nvim_get_current_buf()
  vim.bo[bufnr].filetype = filetype
  vim.api.nvim_exec_autocmds('FileType', { buffer = bufnr })
  return bufnr
end

function M.edit(path)
  return M.edit_as(path, 'markdown')
end

function M.edit_typst(path)
  return M.edit_as(path, 'typst')
end

return M

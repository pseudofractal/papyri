# papyri.nvim

A Neovim companion for [Papyri](https://github.com/pseudofractal/papyri). Papyri stays the preview
window; Neovim owns the text while a buffer is attached.

Papyri's Neovim companion supports Markdown and Typst on Linux. Typst uses Papyri's Tinymist live
preview, follows multi-file projects, and turns preview clicks into Neovim
cursor jumps. Markdown scroll position mirrors both ways; Typst follows Neovim
scrolling only, because Tinymist does not report preview scroll position.

## Requirements

- Papyri with the `preview.attach` control feature. Feature-detect it with
  `papyri ctl state --json`.
- Neovim 0.10 or newer.
- Tinymist for Typst live preview. Papyri's managed Tinymist or a configured
  `languageServerPaths.typst` works.
- Linux. The transport is a Unix socket at
  `$XDG_RUNTIME_DIR/papyri/control.sock` (or the app's documented fallbacks).

## Download

The plugin source lives in `editors/nvim` on Papyri's `main` branch. CI
publishes it with a standalone plugin layout on the `nvim-plugin` branch, so
plugin managers can track it with normal Git updates:

```sh
git clone --branch nvim-plugin https://github.com/pseudofractal/papyri.git
```

That branch contains only the plugin files. It is regenerated whenever
`editors/nvim` changes, so plugin updates do not require a Papyri release.

## Install

`setup()` is required; it creates the commands and autocommands and does not
connect to Papyri until a document needs it.

### lazy.nvim

```lua
{
  url = 'https://github.com/pseudofractal/papyri.git',
  branch = 'nvim-plugin',
  name = 'papyri.nvim',
  event = 'BufReadPre *.md,*.typ',
  opts = {},
}
```

`opts = {}` makes lazy.nvim call `require('papyri').setup({})`. lazy.nvim's
checker reports when the `nvim-plugin` branch moves; update with
`:Lazy update papyri.nvim`.

### Built-in `vim.pack` (Neovim 0.12+)

```lua
vim.pack.add({
  {
    src = 'https://github.com/pseudofractal/papyri',
    version = 'nvim-plugin',
    name = 'papyri.nvim',
  },
})
require('papyri').setup({})
```

Then use `vim.pack.update()` to fetch plugin changes.

### Manual runtime path

```sh
git clone --branch nvim-plugin \
  https://github.com/pseudofractal/papyri.git \
  ~/.local/share/nvim/site/pack/papyri/start/papyri.nvim
```

Then add:

```lua
require('papyri').setup({})
```

If `:help papyri` does not resolve, generate the help tags once:

```vim
:helptags ~/.local/share/nvim/site/pack/papyri/start/papyri.nvim/doc
```

### Local development

For editing the plugin itself, point lazy.nvim at the checkout:

```lua
{
  dir = vim.fn.expand('~/GitHub/papyri/editors/nvim'),
  name = 'papyri.nvim',
  event = 'BufReadPre *.md,*.typ',
  opts = {},
}
```

This uses the working tree instead of the published branch; normal plugin
updates are tracked through `nvim-plugin`.

## Quick start

```vim
:edit notes.md
:Papyri open
:Papyri status
:Papyri root      " preview the current Typst file instead of main.typ
:Papyri close
```

Opening a saved Markdown or Typst buffer inside a project auto-attaches it by
default. `:Papyri open` is the manual fallback after `:Papyri detach`, or when
`auto_attach = false`.

## How it works

- Entering a saved Markdown or Typst buffer inside the project root attaches it
  to the single Papyri companion tab.
- For Typst, the plugin resolves the main document (`typst.toml` entrypoint,
  sibling `main.typ`, project root, or `typst_root`), opens that root, and
  streams modified `.typ` buffers as overlays and registers newly opened chapters
  for reveal. Switching between chapters
  in the same project keeps one preview.
- If Papyri is not running, the first attach launches it with decorationless
  mode on and waits up to `launch_timeout` for its control socket.
- Unsaved buffer text is streamed to Papyri as a preview-only overlay. It never
  touches disk and never opens Papyri's own editor.
- Moving the cursor reveals the matching block in the preview. Insert mode
  reveals once on `InsertLeave` by default; set `follow_insert = true` to reveal
  while typing too, coalesced by `debounce_ms`.
- Markdown scroll position mirrors both ways, snapped to block starts. Typst
  follows Neovim's viewport because Tinymist does not report preview scroll.
- Clicking in the preview moves Neovim's cursor to that source location. Typst
  uses the character reported by Tinymist; Markdown jumps to the block's first
  line. A configured `focus_command` raises the terminal after the jump.
- `:w` sends the saved text immediately; deleting the attached root buffer
  detaches and closes the companion tab. Quitting Neovim leaves Papyri running.
- While attached, Papyri's in-app editor is disabled for every owned path.
- A five-second heartbeat keeps the attachment alive. Papyri drops the overlay
  after fifteen seconds without one, so a crashed Neovim does not leave stale
  text or lock the in-app editor.

## Configuration

```lua
require('papyri').setup({
  auto_attach = true,
  follow = true,
  follow_insert = false,
  debounce_ms = 120,
  launch = true,
  launch_timeout = 15000,
  decorationless = true, -- hide Papyri chrome when connecting
  takeover = 'prompt', -- prompt | always | never
  papyri = 'papyri',
  socket = nil, -- path or function returning a path
  root_markers = { '.git', 'typst.toml', 'package.json', 'Makefile' },
  ignore_globs = { '**/node_modules/**', '**/.git/**' },
  filetypes = { 'markdown', 'typst' },
  typst_main = 'main.typ',
  typst_root = nil, -- function(bufnr) returning the main .typ path
  focus_command = nil, -- shell string or function; runs after a preview jump
  scroll_sync = true,
  scroll_debounce_ms = 80,
  max_bytes = 8 * 1024 * 1024,
  max_request_bytes = 31 * 1024 * 1024,
  notify = true,
})
```

`root_markers` uses `vim.fs.root`; a buffer outside the detected root is not
auto-attached. Set `auto_attach = false` to require `:Papyri open`.
`:Papyri detach` suppresses auto-attach for that document (or Typst project
root) until `:Papyri open`.
`decorationless = true` also applies when connecting to an already-running
Papyri window; use `:Papyri decorationless off` to restore the chrome for the
session. `takeover = 'prompt'` asks before replacing another Neovim session's
attachment; `'always'` takes over and `'never'` refuses.

Typst root resolution checks, in order: `typst_root(bufnr)`, a buffer named
`typst_main`, a sibling `typst_main`, a `typst.toml` `[package] entrypoint`, a
project-root `typst_main`, then the current buffer. Override it when a project
uses a different layout.

`scroll_sync` mirrors Markdown block starts in both directions and is coalesced
by `scroll_debounce_ms`. Typst only follows Neovim's viewport; Tinymist does not
publish preview scroll position.

`focus_command` runs after a preview click opens a source buffer. Neovim cannot
raise its own terminal, so this is the hook for a compositor command, for
example a niri mapping:

```lua
focus_command = 'niri msg action focus-window --id 123',
```

Use a function for anything more involved; it runs inside the Neovim process.

## Commands

Use `:Papyri <subcommand>`.

| Command                              | Behaviour                                                       |
| ------------------------------------ | --------------------------------------------------------------- |
| `:Papyri open [path]`                | Attach the current Markdown/Typst buffer or open a path.        |
| `:Papyri root`                       | Preview the current Typst buffer instead of its `main.typ`.     |
| `:Papyri toggle`                     | Open or close the companion preview.                            |
| `:Papyri close`                      | Detach and close the companion tab.                             |
| `:Papyri detach`                     | Release text ownership but leave the tab open.                  |
| `:Papyri reveal`                     | Reveal the cursor line now.                                     |
| `:Papyri follow [on/off]`            | Toggle or set cursor following.                                 |
| `:Papyri scroll-sync [on/off]`       | Toggle Markdown viewport mirroring.                             |
| `:Papyri tabs`                       | Pick a Papyri tab.                                              |
| `:Papyri outline`                    | Pick a heading from the active document.                        |
| `:Papyri search [query]`             | Search; uses the visual selection or prompts when empty.        |
| `:Papyri zoom [in/out/reset/N]`      | Set document zoom.                                              |
| `:Papyri theme [latte/mocha/toggle]` | Change the Papyri theme.                                        |
| `:Papyri decorationless [on/off]`    | Toggle decoration-less mode.                                    |
| `:Papyri live [on/off]`              | Toggle the Typst live pane.                                     |
| `:Papyri takeover`                   | Force an attachment takeover for the current buffer.            |
| `:Papyri start`                      | Connect or launch Papyri without opening a document.            |
| `:Papyri refresh`                    | Ask Papyri to refresh the active document.                      |
| `:Papyri status`                     | Show connection and attachment state.                           |
| `:Papyri focus`                      | Raise the Papyri window.                                        |
| `:Papyri quit`                       | Quit Papyri.                                                    |
| `:Papyri raw METHOD [json]`          | Send a raw control method.                                      |
| `:Papyri help`                       | Print the subcommand list.                                      |
| `:Papyri <method> [json]`            | Send a raw control method, e.g. `:Papyri scroll.by {"dy":200}`. |

There are no default keymaps. A suggested mapping:

```lua
vim.keymap.set('n', '<leader>po', '<cmd>Papyri open<cr>', { desc = 'Papyri: open preview' })
vim.keymap.set('n', '<leader>pc', '<cmd>Papyri close<cr>', { desc = 'Papyri: close preview' })
vim.keymap.set('n', '<leader>pr', '<cmd>Papyri reveal<cr>', { desc = 'Papyri: reveal cursor' })
```

## Lua API

```lua
local papyri = require('papyri')
papyri.open()
papyri.close()
papyri.toggle()
papyri.detach()
papyri.reveal()
papyri.status()
papyri.request('scroll.by', { dy = 200 })
```

## Tests

```sh
editors/nvim/tests/check.sh
```

The check runs StyLua, Luacheck, a unit suite, and the headless integration
suite. StyLua and Luacheck are provided by the Nix devshell; their configuration
lives in `editors/nvim/stylua.toml` and `editors/nvim/.luacheckrc`. Unit coverage includes config validation, path/ignore rules, socket path
precedence, Typst root resolution, socket errors/timeouts/reconnects, and the
health check. Integration coverage includes attach/update/detach, project
filtering, cursor following, takeover prompts and forced takeover, oversized
Markdown fallback, clean and multi-file Typst attachments, chapter/root
deletion, preview jumps with UTF-16 columns, scroll mirroring, focus commands,
command forwarding, socket reconnects, lease heartbeats, close semantics,
viewport validation, write-triggered updates, failed-update retries, oversized
Typst warnings, visual search, and empty pickers.

`editors/nvim/tests/run.sh` runs only the integration suite.

An opt-in smoke test drives a real Papyri window under Xvfb:

```sh
PAPYRI_BINARY=$(nix build --print-out-paths .#papyri)/bin/papyri \
  editors/nvim/tests/real-window.sh
```

`editors/nvim/tests/real-plugin.sh` goes one step further and runs the real
plugin against that window: attach, live text, preview reveal, and detach.

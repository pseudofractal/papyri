# Control API and CLI

The Linux app exposes a per-user control socket while it is running. `papyri ctl`
is a small client for that socket, and the same newline-delimited JSON protocol
is available to editor integrations such as a Neovim plugin.

The API controls the visible window. It does not turn Papyri into a headless
renderer: documents are still rendered by the running app.

## Quick start

```sh
papyri notes.md                  # Open normally (forwards to a running window)
papyri ctl ping                  # Is a window running?
papyri ctl open notes.md         # Open, launching Papyri if needed
papyri ctl state                 # Active document, tabs, view, preferences
papyri ctl state --json          # Compact machine-readable output
papyri ctl tab next
papyri ctl tab list
papyri ctl scroll by 600
papyri ctl scroll to 0
papyri ctl panel outline toggle
papyri ctl fit-width on
papyri ctl zoom set 120 --target document
papyri ctl search "theorem"
papyri ctl command next-tab
papyri ctl preferences set '{"theme":"latte","documentZoom":120}'
papyri ctl socket                # Print the resolved socket path
```

Run `papyri --help` or `papyri ctl --help` for the complete command list and
examples. Paths are resolved against the CLI's working directory and sent to
the app as absolute paths. `--wait SECONDS` waits for the socket and the host
UI to become ready. This is useful from editor startup hooks:

```sh
papyri ctl ping --wait 5
```

Passing a path to `papyri` while a window is running forwards the path instead
of starting a second instance. Running `papyri` with no arguments while a window
is running raises that window.

## Help and completion

Each command has detailed help, including value names, aliases and examples:

```sh
papyri ctl open --help
papyri ctl scroll by --help
papyri ctl preferences --help
```

Generate completions for your shell:

```sh
papyri completions bash > ~/.local/share/bash-completion/completions/papyri
papyri completions zsh > ~/.zfunc/_papyri
papyri completions fish > ~/.config/fish/completions/papyri.fish
papyri completions elvish
papyri completions powershell
```

The completion script is written to stdout; redirect it to the location your
shell loads. `papyri completions --help` lists the supported shells. Common
aliases are `status`, `tabs`, `fit`, and `prefs`; `-j` is shorthand for
`--json` and `-s` for `--socket`. `papyri --version` and `papyri ctl --version`
print the application version.

## Socket

| Platform    | Default path                                                            |
| ----------- | ----------------------------------------------------------------------- |
| Linux       | `$XDG_RUNTIME_DIR/papyri/control.sock`                                  |
| Fallback    | `$XDG_CACHE_HOME/papyri/control.sock` or `~/.cache/papyri/control.sock` |
| Last resort | `$TMPDIR/papyri-<uid>/control.sock`                                     |

Set `PAPYRI_CONTROL_SOCKET` to use another path, or pass the global
`papyri ctl --socket <PATH>` option. The parent directory is created with mode
`0700` when absent and the socket with mode `0600`, so only the same user can
connect. Keep an overridden socket directory private. There is no network
listener. `papyri ctl socket` prints the path that would be used without
connecting.

Each line is one JSON object. Requests carry an `id` chosen by the client and a
method name:

```json
{ "id": 1, "method": "open", "params": { "path": "/home/me/notes.md", "pane": "main" } }
```

The response repeats the id and contains either a result or an error:

```json
{"id":1,"result":{"active":"/home/me/notes.md","tabs":[]}}
{"id":1,"error":{"code":"app-error","message":"No tab is open."}}
```

Event subscriptions receive separate lines:

```json
{ "event": "state", "data": { "active": "/home/me/notes.md", "...": "..." } }
```

### Ready state

The window marks itself ready after the host UI has installed its control
listener. Requests wait up to 20 seconds for that readiness, so a client may
connect immediately after the socket appears. Document mutations are serialized
in arrival order; view, theme, zoom, and preference changes use a separate queue
so they do not wait behind a slow document open. `state`, `headings`, and
`commands` are read-only and may run while another command is in flight. `ping` is handled by the native
layer and reports `ready` without touching the webview. Readiness covers the
control listener, not the initial document: use `state.busy` and `state.active`
while startup finishes. Document actions also wait for the initial folder and
document selection to finish, so an `open` sent during startup is applied after
Papyri finishes opening its initial path. Queued mutations carry the request
deadline; one that expires before reaching the front of the queue is skipped,
while work already underway may finish after the client has timed out.

## Methods

| Method                         | Parameters                                                                                              | Description                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `ping`                         | none                                                                                                    | Version, protocol, PID, socket path and readiness.                |
| `state`                        | none                                                                                                    | Active document, tabs, PDF page, view flags, preferences, source. |
| `headings`                     | none                                                                                                    | Headings for the active document.                                 |
| `commands`                     | none                                                                                                    | Palette commands available with `command`.                        |
| `open`                         | `path`, optional `pane` (`main`/`secondary`), `anchor`, `directory`                                     | Open a document, folder, or split pane.                           |
| `close`                        | optional `path`                                                                                         | Close a tab, defaulting to the active tab.                        |
| `focus`                        | `path`                                                                                                  | Focus an open tab, opening it first if needed.                    |
| `tab.next` / `tab.previous`    | none                                                                                                    | Cycle tabs.                                                       |
| `tab.activate`                 | `path`                                                                                                  | Focus an open tab.                                                |
| `tab.close`                    | optional `path`                                                                                         | Close a tab.                                                      |
| `scroll.to`                    | `y`, optional `pane`                                                                                    | Scroll to an absolute pixel position.                             |
| `scroll.by`                    | `dy`, optional `pane`                                                                                   | Scroll by a relative amount.                                      |
| `scroll.top` / `scroll.bottom` | optional `pane`                                                                                         | Jump to an end.                                                   |
| `zoom`                         | `target` (`document`/`ui`), either `action` (`in`/`out`/`reset`) or `value`                             | Change zoom.                                                      |
| `fit-width`                    | optional `enabled` boolean                                                                              | Toggle or set fit-to-width.                                       |
| `theme`                        | `theme` (`latte`/`mocha`/`toggle`)                                                                      | Change the color theme.                                           |
| `panel`                        | `name` (`sidebar`, `outline`, `settings`, `palette`, `search`, `split`), `action` (`on`/`off`/`toggle`) | Show or hide UI surfaces.                                         |
| `search`                       | `query`                                                                                                 | Set document search; an empty query clears it.                    |
| `heading`                      | `id`                                                                                                    | Scroll to a heading or PDF outline target.                        |
| `page`                         | `page`                                                                                                  | Go to a PDF page.                                                 |
| `command`                      | `id`                                                                                                    | Run a palette command by id.                                      |
| `preferences.set`              | `patch` object                                                                                          | Merge validated preference changes.                               |
| `refresh`                      | none                                                                                                    | Refresh the active document and explorer.                         |
| `raise`                        | none                                                                                                    | Focus and show the main window (native).                          |
| `quit`                         | none                                                                                                    | Exit Papyri (native).                                             |
| `subscribe`                    | optional `events` array                                                                                 | Register for events; returns the initial state.                   |
| `unsubscribe`                  | none                                                                                                    | Stop events on the current connection.                            |

`papyri ctl raw METHOD '{"key":1}'` sends any method directly, so integrations
can use new methods without waiting for a CLI update. `papyri ctl socket` and
`papyri completions <shell>` are CLI-only; they do not send a socket request.
An `open` with `pane: "secondary"` opens in the split pane when a document is
already active; with no active document it opens in the main pane so the preview
is visible. The `anchor` option applies to the main pane only. Documents with
scripts enabled do not update the saved scroll bookmark, but a control-initiated
scroll still resolves with the frame's resulting position so `papyri ctl scroll`
can report success.

### State shape

`state` returns a stable summary suitable for polling:

```json
{
  "protocol": 1,
  "active": "/home/me/notes.md",
  "secondary": null,
  "tabs": [
    {
      "path": "/home/me/notes.md",
      "kind": "markdown",
      "active": true,
      "secondary": false,
      "scroll": 320,
      "error": null
    }
  ],
  "pdf": null,
  "view": {
    "sidebar": true,
    "outline": false,
    "settings": false,
    "palette": false,
    "search": false,
    "split": false,
    "query": ""
  },
  "preferences": {
    "theme": "mocha",
    "documentZoom": 100,
    "pdfZoom": 100,
    "uiZoom": 100,
    "fitWidth": false,
    "network": false
  },
  "directory": "/home/me",
  "source": { "label": "Local filesystem", "root": "/", "live": true },
  "busy": false,
  "error": null
}
```

`kind` is `markdown`, `pdf`, `typst-source`, or `latex-source`. A Typst or LaTeX
tab uses `pdf` when compilation succeeded and `*-source` when the source is
shown after a compilation failure.

### Preferences

`preferences.set` accepts a partial object. Unknown keys are rejected. Supported
keys are `theme`, `network`, `fitWidth`, `documentZoom`, `pdfZoom`, `uiZoom`,
`sidebarWidth`, `typstPath`, `latexEngine`, `latexPaths`, and `delimiters`.
Numeric zoom and sidebar values are clamped to the same limits as the settings
dialog. For example:

```sh
papyri ctl preferences get
papyri ctl preferences set '{"theme":"latte","network":true,"documentZoom":120}'
papyri ctl preferences set '{"latexEngine":"xelatex","latexPaths":{"xelatex":"/opt/xelatex"}}'
```

## Events

```sh
papyri ctl watch
papyri ctl watch --events state,headings
```

Each line is one JSON object. `state` is emitted after the visible state changes
(at most about ten times per second), and `headings` when the active document's
outline changes. The initial `state` is printed unless `--no-initial` is used.
Events are not replayed: use `state` for a one-shot snapshot and `watch` for
changes.

Direct socket clients subscribe with:

```json
{ "id": 2, "method": "subscribe", "params": { "events": ["state", "headings"] } }
```

The response contains `{"subscribed":true,"state":{...}}`, and later lines are
events. Omit `events` to receive all event types. Sending `unsubscribe` on the
same connection stops the stream. Subscribing again on the same connection
replaces the previous filter. A subscriber whose event queue cannot keep up is
removed from the event stream rather than blocking the app or other clients;
reconnect and subscribe again after a stalled consumer.

## Errors

Control failures use the protocol error shape shown above. With `--json`, the
CLI writes a single object to stdout and exits nonzero:

```json
{
  "error": { "code": "timeout", "message": "Papyri did not respond to `state` within 60 seconds." }
}
```

Without `--json`, errors are printed to stderr as `error: <message>` and the
exit status is nonzero. A closed output pipe is treated as a normal end of
output, not an error.

## Neovim

The CLI is the simplest integration point. Open the current buffer and read
state synchronously:

```lua
local function papyri(args)
  return vim.fn.system(vim.list_extend({ 'papyri', 'ctl' }, args))
end

vim.api.nvim_create_user_command('PapyriOpen', function()
  local path = vim.api.nvim_buf_get_name(0)
  if path == '' then
    vim.notify('Save the buffer before previewing it.', vim.log.levels.WARN)
    return
  end
  papyri({ 'open', path })
end, {})

vim.api.nvim_create_user_command('PapyriState', function()
  print(papyri({ 'state', '--json' }))
end, {})
```

For live updates, start `papyri ctl watch` as a job and decode each line:

```lua
local watcher

local function start_watcher()
  if watcher then return end
  watcher = vim.fn.jobstart({ 'papyri', 'ctl', 'watch', '--events', 'state,headings' }, {
    on_stdout = function(_, lines)
      for _, line in ipairs(lines) do
        if line ~= '' then
          local ok, message = pcall(vim.json.decode, line)
          if ok then
            vim.schedule(function()
              -- message.event is "state" or "headings"
              -- message.data is the payload
            end)
          end
        end
      end
    end,
    on_exit = function() watcher = nil end,
  })
end
```

The underlying protocol is plain JSONL, so a plugin may also connect directly
with `vim.uv.new_pipe()` (or the deprecated `vim.loop`) and `pipe:connect()`.
Use `PAPYRI_CONTROL_SOCKET` to isolate an instance in tests.

A Neovim plugin can map buffer changes to `open` calls, cursor movement to
`heading`, and its own UI to `state`/`headings` events. Because `open` accepts
absolute paths and the app stays read-only, the preview can follow the editor
without adding write access to the viewer.

## Security

The socket is a same-user control channel. Any process running as your user can
send these commands, just as it could simulate keystrokes or clicks. It is not a
privilege boundary and does not grant the control client new filesystem access
beyond opening documents the app already allows. The socket is not reachable over
the network. Enabling scripts for a document remains a separate, per-tab action;
opening a document through the control API never enables document scripts.

The socket carries absolute paths and document headings in `state` events. Keep
`$XDG_RUNTIME_DIR` and any overridden socket directory private.

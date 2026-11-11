# Control API and CLI

The Linux app exposes a per-user control socket while it is running. `papyri ctl`
is a small client for that socket, and the same newline-delimited JSON protocol
is available to editor integrations such as a Neovim plugin.

The API controls the visible window. It does not turn Papyri into a headless
renderer: documents are still rendered by the running app.

## Quick start

```sh
papyri notes.md                  # Open normally (forwards to a running window)
papyri --decorationless notes.md # Open directly in decoration-less mode
papyri ctl ping                  # Is a window running?
papyri ctl open notes.md         # Open, launching Papyri if needed
papyri ctl state                 # Active document, tabs, view, preferences
papyri ctl state --json          # Compact machine-readable output
papyri ctl tab next
papyri ctl tab list
papyri ctl scroll by 600
papyri ctl scroll to 0
papyri ctl panel outline toggle
papyri ctl decorationless on
papyri ctl fit-width on
papyri ctl zoom set 120 --target document
papyri ctl search "theorem"
papyri ctl command next-tab
papyri ctl editor open
papyri ctl editor set --file draft.tex
papyri ctl editor save
papyri ctl explorer list
papyri ctl note set "Check section 3"
papyri ctl right notes
papyri ctl menu open file notes.md
papyri ctl menu activate 1
papyri ctl dom query 'header button'
papyri ctl screenshot element dom-1 --clipboard
papyri ctl browser navigate "https://example.com"
papyri ctl tools install tinymist texlab
papyri ctl preferences set '{"theme":"latte","documentZoom":120}'
papyri ctl socket                # Print the resolved socket path
```

Run `papyri --help` or `papyri ctl --help` for the complete command list and
examples. Paths are resolved against the CLI's working directory and sent to
the app as absolute paths. `--wait SECONDS` waits for the control socket;
`ping --wait` also waits for the host UI to report ready. This is useful from
editor startup hooks:

```sh
papyri ctl ping --wait 5
```

Passing a path to `papyri` while a window is running forwards the path instead
of starting a second instance. Running `papyri` with no arguments while a window
is running raises that window.

## Help and completion

The control help includes workflow examples, and each command has detailed
value and option help:

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
aliases are `status`, `tabs`, `fit`, and `prefs`; `decoration-less` is accepted
for `decorationless`. `-j` is shorthand for `--json` and `-s` for `--socket`.
`papyri --version` and `papyri ctl --version` print the application version.

## Launch output and logging

When Papyri is started from a terminal, release builds detach from the shell and
append stdout and stderr to a log file. Interactive launches print the chosen
path. Use `--log TARGET` (or `-l`) to choose where the detached process sends
output:

| Target                 | Behavior                                               |
| ---------------------- | ------------------------------------------------------ |
| `terminal`, `tty`, `-` | Stay attached to the terminal and stream output there. |
| `PATH` or `file:PATH`  | Append both streams to `PATH` and detach.              |
| `cmd:COMMAND`          | Pipe both streams through `sh -c COMMAND` and detach.  |

```sh
papyri --log terminal notes.md       # Keep stdio in this terminal
papyri --log ~/papyri.log notes.md   # Append to a specific file
papyri --log cmd:wl-copy notes.md    # Pipe output into wl-copy
```

`cmd:` targets receive the stream on stdin; commands that wait for EOF, such as
`wl-copy`, finish when Papyri exits. The command must keep consuming stdin, or
the app can block once the pipe fills. Shell syntax is available inside the
command. `--log` only applies when starting Papyri; it reports an error if a
window is already running. Without `--log`, development builds stay attached to
the terminal so `tauri dev` keeps its stdio.

The default log path is:

| Priority         | Path                                   |
| ---------------- | -------------------------------------- |
| `XDG_STATE_HOME` | `$XDG_STATE_HOME/papyri/papyri.log`    |
| Fallback         | `$HOME/.local/state/papyri/papyri.log` |
| Fallback         | `$XDG_CACHE_HOME/papyri/papyri.log`    |
| Last resort      | `$TMPDIR/papyri-<uid>/papyri.log`      |

The file is appended to, created with mode `0600`, and missing parent
directories are created with mode `0700`.

## Socket

| Platform    | Default path                                                            |
| ----------- | ----------------------------------------------------------------------- |
| Linux       | `$XDG_RUNTIME_DIR/papyri/control.sock`                                  |
| Fallback    | `$XDG_CACHE_HOME/papyri/control.sock` or `~/.cache/papyri/control.sock` |
| Last resort | `$TMPDIR/papyri-<uid>/control.sock`                                     |

Set `PAPYRI_CONTROL_SOCKET` to use another path, or pass the global
`papyri ctl --socket <PATH>` option. A relative `--socket` path is resolved to
an absolute path against the CLI's working directory. The parent directory is
created with mode `0700` when absent and the socket with mode `0600`, so only
the same user can connect. Keep an overridden socket directory private. There
is no network listener. `papyri ctl socket` prints the path that would be used
without connecting.

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
| `decorationless`               | optional `enabled` boolean                                                                              | Toggle or set decoration-less reading mode.                       |
| `theme`                        | `theme` (`latte`/`mocha`/`toggle`)                                                                      | Change the color theme.                                           |
| `panel`                        | `name` (`sidebar`, `outline`, `settings`, `palette`, `search`, `split`), `action` (`on`/`off`/`toggle`) | Show or hide UI surfaces.                                         |
| `search`                       | `query`                                                                                                 | Set document search; an empty query clears it.                    |
| `heading`                      | `id`                                                                                                    | Scroll to a heading or PDF outline target.                        |
| `page`                         | `page`                                                                                                  | Go to a PDF page.                                                 |
| `command`                      | `id`                                                                                                    | Run a palette command by id.                                      |
| `preferences.set`              | `patch` object                                                                                          | Merge validated preference changes.                               |
| `refresh`                      | none                                                                                                    | Refresh the active document and explorer.                         |
| `latex.status`                 | none                                                                                                    | Path, engine, and elapsed time of the active LaTeX compile.       |
| `latex.cancel`                 | optional `path`                                                                                         | Cancel the active LaTeX compile (optionally only that path).      |
| `raise`                        | none                                                                                                    | Focus and show the main window (native).                          |
| `quit`                         | none                                                                                                    | Exit Papyri (native).                                             |
| `subscribe`                    | optional `events` array                                                                                 | Register for events; returns the initial state.                   |
| `unsubscribe`                  | none                                                                                                    | Stop events on the current connection.                            |

`papyri ctl raw METHOD '{"key":1}'` sends any method directly, so integrations
can use new methods without waiting for a CLI update. `papyri ctl socket` and
`papyri completions <shell>` are CLI-only; they do not send a socket request.
An `open` with `pane: "secondary"` opens in the split pane when a document is
already active; with no active document it opens in the main pane so the preview
is visible. The `anchor` option applies to the main pane only. `tab list --json`
returns a focused `{"tabs":[...]}` object. Documents with scripts enabled do not
update the saved scroll bookmark, but a control-initiated scroll still resolves
with the frame's resulting position so `papyri ctl scroll` can report success.

LaTeX compiles can be inspected and cancelled while they run:

```sh
papyri ctl raw latex.status '{}'
papyri ctl raw latex.cancel '{}'
papyri ctl raw latex.cancel '{"path":"/home/me/paper.tex"}'
```

`latex.status` returns `null` when idle, or `{id, path, engine, elapsedSeconds}`.
`latex.cancel` returns `true` when it requested cancellation. The preview also
shows a **Stop** button while compiling and a **Stop other and retry** action when
another document's compile is blocking it.

`--timeout SECONDS` sets the response timeout for one request. The default is
60 seconds; `tools` commands default to one hour so downloads and TeX Live
installs can finish. The native layer accepts timeouts from 1 second to 24 hours.

### Source editing

| Method                                        | Parameters                   | Description                                        |
| --------------------------------------------- | ---------------------------- | -------------------------------------------------- |
| `editor.open`                                 | none                         | Open the source editor for the active document.    |
| `editor.close`                                | none                         | Close the editor and keep the draft.               |
| `editor.toggle`                               | none                         | Toggle the editor.                                 |
| `editor.save`                                 | none                         | Save the active draft.                             |
| `editor.reload`                               | optional `discard` boolean   | Reload from disk; `discard` skips confirmation.    |
| `editor.discard`                              | none                         | Reload and discard unsaved changes.                |
| `editor.get`                                  | none                         | Return `{path,text,dirty}`.                        |
| `editor.set`                                  | `text`                       | Replace the whole draft text.                      |
| `editor.reveal`                               | `line`, optional `character` | Reveal a zero-based source position.               |
| `editor.sync`                                 | none                         | Reveal the current source position in the preview. |
| `editor.undo` / `editor.redo`                 | none                         | Undo or redo the last source edit.                 |
| `editor.select-all`                           | none                         | Select the whole document.                         |
| `editor.select`                               | `from`, `to`                 | Select a zero-based character range.               |
| `editor.copy` / `editor.cut` / `editor.paste` | none                         | Clipboard editing at the cursor or selection.      |

`editor set` replaces the editor buffer without saving. It marks the draft dirty,
updates the live preview, and leaves saving to `editor save`. The CLI accepts
`editor set TEXT`, `editor set --file PATH`, or `editor set --stdin`; `editor
reveal` takes one-based line and column numbers. Undo, redo, select-all, copy,
cut, and paste are exposed directly so the source editor's native context menu
is not required for automation.

### Explorer

| Method              | Parameters                  | Description                                        |
| ------------------- | --------------------------- | -------------------------------------------------- |
| `explorer.list`     | optional `path`             | Return `{path,entries}` for the folder.            |
| `explorer.cwd`      | `path`                      | Set the explorer working directory.                |
| `explorer.expand`   | `path`                      | Expand a folder and make it the working directory. |
| `explorer.collapse` | `path`                      | Collapse a folder.                                 |
| `explorer.select`   | `path`                      | Select an entry.                                   |
| `explorer.create`   | `directory`, `name`, `kind` | Create `folder`, `markdown`, `typst`, or `latex`.  |
| `explorer.rename`   | `path`, `name`              | Rename a file or folder.                           |
| `explorer.delete`   | `path`, `force`             | Delete permanently; `force` must be `true`.        |

The CLI's `explorer create PATH --kind TYPE` derives the parent folder and adds
`.md`, `.typ`, or `.tex` when the name has no matching extension. Deleting
requires `--yes`; the socket method requires `"force": true`.

### Notes, trust, and selection

| Method            | Parameters                       | Description                                         |
| ----------------- | -------------------------------- | --------------------------------------------------- |
| `note.get`        | none                             | Return `{path,text}` for the active document.       |
| `note.set`        | `text`                           | Replace the active document's note.                 |
| `trust`           | optional `enabled` boolean       | Enable or disable scripts for the Markdown tab.     |
| `selection.get`   | none                             | Return `{text,source,preview}` for the selection.   |
| `selection.copy`  | `kind` (`source`/`text`/`quote`) | Copy the selection in that form.                    |
| `selection.set`   | `text`                           | Select the first visible occurrence in the preview. |
| `selection.clear` | none                             | Clear the preview selection.                        |

Enabling scripts through the socket is equivalent to clicking the trust control
in the window. Only Markdown documents support it, and it stays limited to the
active revision.

### Screenshots and DOM inspection

| Method       | Parameters                                                                                                                 | Description                                               |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `dom.query`  | optional `selector`, `limit` (1–1000), `includeHidden`                                                                     | Return visible matching nodes with stable `ref` values.   |
| `dom.get`    | `ref`                                                                                                                      | Return text, HTML, attributes, rect, and computed styles. |
| `dom.focus`  | `ref`                                                                                                                      | Focus a node.                                             |
| `dom.click`  | `ref`                                                                                                                      | Focus and click a node.                                   |
| `dom.type`   | `ref`, `text`                                                                                                              | Set an input/select/textarea/editable value.              |
| `screenshot` | `target` (`screen`/`app`/`element`/`rect`), optional `output`, `clipboard`, `ref`, `selector`, `x`, `y`, `width`, `height` | Capture PNG pixels or copy them to the clipboard.         |

```sh
papyri ctl dom query 'header button' --json
papyri ctl dom get dom-12 --json
papyri ctl dom click dom-12
papyri ctl dom type dom-20 'Needle'
papyri ctl screenshot screen --output ~/shots/screen.png
papyri ctl screenshot element dom-12 --clipboard
papyri ctl dom --frame preview query 'h1'
papyri ctl dom --frame browser query 'button'
papyri ctl record --output-dir ~/shots/series --count 10 --interval-ms 300
papyri ctl screenshot rect 100 80 640 480 --output ~/shots/region.png
```

`screen` captures the whole compositor output, including other windows and the
native website panel. `app` captures the main app webview only; it includes the
Markdown/PDF preview but excludes the separate native browser panel. `element`
captures one main-document node using a DOM reference or `--selector`, cropped
from a WebKit snapshot at device resolution. `rect` uses absolute physical
screen pixels.

Without `--output` or `--clipboard`, screenshots are written to
`$XDG_CACHE_HOME/papyri/screenshots` (or `~/.cache/papyri/screenshots`) with
mode `0600`. Clipboard images use `wl-copy` on Wayland or `xclip` on X11.
Screen capture uses `grim` on Wayland or ImageMagick `import` on X11.

DOM references are stable for the life of the current page. They are reset by
a reload. `--frame preview` queries the sandboxed Markdown/PDF preview through
its postMessage bridge; `--frame browser` queries the active website tab with
an injected page helper. `element` screenshots work in all three frames:
main-document nodes crop a WebKit snapshot, preview nodes are offset by the
iframe bounds, and browser nodes crop the native browser surface. `dom.ax`
returns a compact role/name/value tree for all three frames.

### Native input, clipboard, windows, and waits

| Method           | Parameters                                | Description                                               |
| ---------------- | ----------------------------------------- | --------------------------------------------------------- |
| `input.move`     | `x`, `y`                                  | Move the pointer to absolute screen coordinates.          |
| `input.click`    | `x`, `y`, optional `button`, `count`      | Click, double-click, or triple-click.                     |
| `input.drag`     | `x`, `y`, `toX`, `toY`, optional `button` | Press, drag, and release.                                 |
| `input.scroll`   | `x`, `y`, optional `dx`, `dy`             | Scroll at a screen position.                              |
| `input.key`      | `keys`                                    | Press a combination such as `ctrl+l` or `shift+tab`.      |
| `input.type`     | `text`                                    | Type into the focused control.                            |
| `clipboard.get`  | none                                      | Return clipboard text.                                    |
| `clipboard.set`  | `text`                                    | Replace clipboard text.                                   |
| `window.list`    | none                                      | List native windows with ids, titles, and geometry.       |
| `window.focus`   | `id`                                      | Present and focus a native window.                        |
| `window.capture` | `id`, optional `output`, `clipboard`      | Capture a native window as PNG.                           |
| `wait.selector`  | `selector`, optional `frame`, `timeoutMs` | Wait until a selector matches.                            |
| `wait.idle`      | optional `timeoutMs`                      | Wait until document, editor, browser, and tools are idle. |
| `wait.state`     | `path`, `equals`, optional `timeoutMs`    | Wait until a dotted state path equals a JSON value.       |

`input.*` uses XTest and therefore requires an X11 display; Papyri should run
with `GDK_BACKEND=x11` on Wayland desktops. `window.capture` uses the native
window surface, so it includes browser-panel webviews. The CLI equivalents are
`input`, `clipboard`, `window`, and `wait`.

```sh
papyri ctl input click 400 300
papyri ctl input key ctrl+l
papyri ctl input type 'https://example.com'
papyri ctl clipboard set --stdin
papyri ctl clipboard get-image --output ~/clipboard.png
papyri ctl clipboard set-image ~/clipboard.png
papyri ctl window list --json
papyri ctl wait selector 'h1' --frame preview
papyri ctl wait state busy false
papyri ctl wait idle --timeout-ms 10000
```

### Context menus and selection actions

| Method          | Parameters                                                                                             | Description                                     |
| --------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| `menu.open`     | `kind` (`app`/`document`/`tab`/`file`/`selection`), optional `path`, `x`, `y`, `directory`, `document` | Open a menu and expose its entries.             |
| `menu.activate` | `index`                                                                                                | Run an entry by its zero-based index.           |
| `menu.close`    | none                                                                                                   | Close the context menu or selection action pad. |

`state.menu` mirrors the open menu: kind, title, position, target path, and an
ordered list of `{index,id,label,shortcut?,separator?}` entries. This includes
the application, document, tab, file/folder, and selection action-pad menus.
`menu.open selection` opens the action pad for the current preview selection;
use `selection.set TEXT` first when no text is selected.
`menu.open file PATH` infers whether the target is a folder or document unless
`directory`/`document` is supplied. Actions that only open dialogs in the UI
(for example **New file…**) remain available, but the dedicated `explorer` and
`settings` methods are usually better for automation.

### Right panel and browser

| Method             | Parameters                          | Description                                     |
| ------------------ | ----------------------------------- | ----------------------------------------------- |
| `right.tab`        | `tab` (`outline`, `notes`, site)    | Select and show a right-panel tab.              |
| `browser.navigate` | `target`                            | Navigate to a URL, hostname, or search query.   |
| `browser.back`     | none                                | Go back.                                        |
| `browser.forward`  | none                                | Go forward.                                     |
| `browser.reload`   | none                                | Reload the page.                                |
| `browser.stop`     | none                                | Stop loading.                                   |
| `browser.zoom`     | `action` (`in`/`out`/`reset`)       | Change the page zoom.                           |
| `browser.window`   | optional `url`                      | Open the current or given page in a new window. |
| `browser.quote`    | `site` (`chatgpt`/`gemini`), `text` | Send a quote to the site composer.              |
| `browser.search`   | `text`                              | Search Wikipedia for the text.                  |

Browser methods require the Linux app. `right.tab` accepts `outline`, `notes`,
`chatgpt`, `wikipedia`, and `gemini`. Website pages can be inspected and driven
with `dom --frame browser` (query/get/focus/click/type/ax); browser DOM
references are scoped to the active page and reset on navigation.

### Search, PDF, and live preview

| Method              | Parameters                    | Description                                      |
| ------------------- | ----------------------------- | ------------------------------------------------ |
| `search.next`       | none                          | Scroll to the next match.                        |
| `search.previous`   | none                          | Scroll to the previous match.                    |
| `pdf.password`      | `password`                    | Unlock a password-protected PDF.                 |
| `live-preview`      | optional `enabled` boolean    | Show, hide, or toggle the live preview.          |
| `live-preview.zoom` | `action` (`in`/`out`/`reset`) | Zoom the Typst live preview or document preview. |
| `live-preview.fit`  | none                          | Fit the live preview or document to width.       |

Prefer `papyri ctl pdf password --stdin` on shared machines so the password does
not appear in the process list. Search match counts appear in `state.search`.

### Tools, settings, and documents

| Method          | Parameters                                             | Description                                      |
| --------------- | ------------------------------------------------------ | ------------------------------------------------ |
| `tools.install` | `name` (`marksman`/`tinymist`/`texlab`/`typst`)        | Download or update a managed tool and select it. |
| `tools.texlive` | `action` (`install`/`update`)                          | Install or update managed TeX Live.              |
| `settings.tab`  | `tab` (`appearance`/`reading`/`documents`/`compilers`) | Open settings on that tab.                       |
| `document.copy` | none                                                   | Copy the active document's raw source.           |

`tools status` is CLI-only and prints the tool state plus configured paths.
`document stats` is CLI-only and prints `state.stats`.

`record --output-dir DIR --count N --interval-ms M [--target screen|app]`
captures a numbered PNG frame series for observing animations, loading states,
and menus. It is a frame series rather than an encoded video file.

Decoration-less mode hides the one-line shell, explorer, right panel, and status
bar so the preview fills the viewport. The command palette and all keyboard
shortcuts remain available; `Esc` leaves the mode when no dialog or search is
open. Toggle it with `Ctrl Shift D` or
`papyri ctl decorationless [on|off|toggle]`. Launch straight into the mode with
`papyri --decorationless notes.md` (or `-d`); if a window is already running,
the flag applies to that window instead of starting a second instance. The mode
is view state rather than a preference, so it is not persisted across restarts.

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
    "decorationless": false,
    "query": "",
    "rightTab": "outline"
  },
  "editor": {
    "available": true,
    "open": false,
    "path": "/home/me/notes.md",
    "language": "markdown",
    "dirty": false,
    "busy": false,
    "readOnly": false,
    "status": "",
    "error": null,
    "cursor": null,
    "selection": null,
    "diagnostics": { "errors": 0, "warnings": 0, "information": 0, "hints": 0 }
  },
  "explorer": {
    "workingDirectory": "/home/me",
    "selected": null,
    "expanded": []
  },
  "search": { "open": false, "query": "", "matches": null },
  "note": { "path": "/home/me/notes.md", "text": "" },
  "trust": { "supported": true, "enabled": false },
  "browser": null,
  "livePreview": { "available": false, "visible": false },
  "tools": { "busy": false, "message": "", "error": "" },
  "stats": {
    "words": 120,
    "characters": 740,
    "minutes": 1,
    "bytes": null,
    "pages": null
  },
  "selection": null,
  "menu": {
    "open": false,
    "kind": null,
    "title": "",
    "x": 0,
    "y": 0,
    "path": null,
    "directory": null,
    "items": []
  },
  "recent": { "files": [], "folders": [], "commands": [] },
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
shown after a compilation failure. `pdf.locked` is true while a protected PDF
waits for `pdf.password`. `editor.cursor` and `editor.selection` use zero-based
line and character positions; selection text is capped at 100 kB. The editor
snapshot also includes diagnostic counts by severity; `editor.diagnostics`
returns the full language-server list. `browser` is
the live `BrowserState` in the Linux app and null elsewhere.

### Preferences

`preferences.set` accepts a partial object. Unknown keys are rejected. Supported
keys are `theme`, `network`, `fitWidth`, `documentZoom`, `pdfZoom`, `uiZoom`,
`sidebarWidth`, `browserWidth`, `browserUrl`, `paletteWidth`, `paletteHeight`,
`paletteMaxWidth`, `paletteMaxHeight`, `uiFont`, `textFont`, `codeFont`,
`mathFont`, `typstPath`, `latexEngine`, `latexPaths`, and `delimiters`. Palette
percentages range from 40 to 100. Palette pixel limits range from 320 to 2000
wide and 240 to 1600 tall. `browserWidth` ranges from 280 to 1000, and
`browserUrl` must be an HTTP(S) address or `about:blank`.
Font values are CSS `font-family` lists; `mathFont` may be empty to keep KaTeX's
bundled fonts.
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
papyri ctl watch --events state,headings,browser,selection
```

Each line is one JSON object. `state` is emitted after the visible state changes
(at most about ten times per second) and now carries editor, explorer, search,
note, trust, browser, live-preview, tools, statistics, selection, menu, and
recent state. `headings` follows the active document's outline, `browser` follows the
embedded browser state, and `selection` follows the preview's selected word and
character counts. The initial `state` is printed unless `--no-initial` is used.
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
exit status is nonzero. Argument parsing errors are reported by clap and are
not part of the JSON envelope. A closed output pipe is treated as a normal end
of output, not an error.

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
privilege boundary and does not grant the control client filesystem access
beyond what the app already allows. The socket is not reachable over the
network. `editor`, `explorer`, `note`, `trust`, and `tools` methods act with the
same permissions as the corresponding UI controls. Opening a document through
`open` never enables document scripts; `trust` must be sent explicitly, and
deleting a file requires `"force": true` (`--yes` in the CLI).

`dom.click` and `dom.type` can activate any main-window control, including
trust and file actions. `screenshot screen` captures the entire desktop, not
just Papyri, and may include other applications. Screenshot files are created
with mode `0600`; clipboard images are readable by any client of the same
clipboard session. `input.*` injects real mouse and keyboard events into the
X11 session, so it can operate other applications and native dialogs too. Treat the control socket and screenshot output as sensitive
as the desktop itself.

The socket carries absolute paths and document headings in `state` events. Keep
`$XDG_RUNTIME_DIR` and any overridden socket directory private.

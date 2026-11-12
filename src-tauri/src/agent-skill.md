# Papyri agent skill

Papyri is a local-first Markdown, PDF, Typst, and LaTeX viewer and source editor. A running window exposes a control API; use `papyri ctl` instead of automating the GUI or editing files directly.

## Discover

- `papyri ctl --help` lists every command.
- `papyri ctl <command> --help` explains values and options.
- `papyri skill` prints this skill.
- The full agent guide is at https://github.com/pseudofractal/papyri/blob/main/docs/agent-guide.md.

## Connect

```sh
papyri ctl ping --wait 5        # Wait for a running window
papyri ctl open path/to/doc.md  # Open, launching Papyri if needed
papyri ctl state --json         # Active document, tabs, view, preferences
```

A bare `papyri path/to/doc.md` also forwards to a running window or launches one. The control socket is per-user and sensitive; do not expose it.

## Work

| Goal                | Command                                                           |
| ------------------- | ----------------------------------------------------------------- |
| Open a document     | `papyri ctl open PATH`                                            |
| Switch tabs         | `papyri ctl tab next`, `papyri ctl tab list`                      |
| Search              | `papyri ctl search "text"`                                        |
| Scroll to a heading | `papyri ctl heading ID`                                           |
| Go to a PDF page    | `papyri ctl page 2`                                               |
| Edit and save       | `papyri ctl editor open`, then `editor set --file`, `editor save` |
| Show the explorer   | `papyri ctl explorer list`                                        |
| Toggle panels       | `papyri ctl panel outline toggle`, `papyri ctl right notes`       |
| Inspect the UI      | `papyri ctl dom query 'selector'`, `papyri ctl dom get REF`       |
| Capture the app     | `papyri ctl screenshot app --output path.png`                     |
| Change preferences  | `papyri ctl preferences set '{"theme":"latte"}'`                  |
| Watch live state    | `papyri ctl watch --events state,headings,selection`              |

Commands print readable output by default. Add `--json` for compact JSON. Paths are resolved against the CLI working directory.

## Tools and setup

- Managed language servers and Typst: **Settings → Compilers**, or `papyri ctl tools install marksman tinymist texlab typst` while Papyri is running.
- Managed TeX Live: **Settings → Compilers**, or `papyri ctl tools texlive install`. It is large and needs network.
- `papyri ctl tools status` prints tool state and configured paths.
- `papyri ctl tools install` requires a running window. Start one with `papyri ctl open PATH` first.
- The browser build is view/edit only. Compilation, language servers, the embedded browser panel, and native capture require the desktop app.

## Safety

- `papyri ctl` controls the visible window; it is not a headless renderer.
- Do not paste private document contents into prompts or expose the control socket.
- For the complete protocol and examples, see `docs/control.md` in the repository.

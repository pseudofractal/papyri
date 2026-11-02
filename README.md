Papyri is a read-only Markdown, PDF, Typst, and LaTeX viewer for Linux with offline math and diagrams.

Control a running window from the terminal with `papyri ctl`; see [docs/control.md](docs/control.md) for commands, events, and editor integrations. Press `Ctrl Shift D` for decoration-less reading, which hides the surrounding chrome while keeping the command palette and keyboard shortcuts, or start directly with `papyri --decorationless notes.md`. Run `papyri --help` for command help and `papyri completions <shell>` for shell completions.

When launched from a terminal, Papyri detaches and appends output to its log file. Use `--log terminal` to stay attached, `--log PATH` to choose a file, or `--log cmd:COMMAND` to pipe output through a command such as `wl-copy`.

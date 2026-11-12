# Using Papyri with an AI agent

Papyri is a local-first Markdown, PDF, Typst, and LaTeX viewer and source editor. This guide is for people who want an AI agent to set up Papyri, open and navigate documents, or use the running window through `papyri ctl`.

The compact version is built into the CLI:

```sh
papyri skill
```

## Before you start

- A desktop build is required for `papyri ctl`, compilation, language servers, the embedded browser panel, and native capture. The web build is view/edit only.
- `papyri ctl` controls a visible window. It is not a headless renderer.
- On Linux the CLI is usually `papyri` on `PATH`. On macOS and Windows it lives inside the app bundle or install directory and may not be on `PATH`; use the full path if needed.
- macOS builds are ad-hoc signed but not notarized; approve Papyri in **System Settings → Privacy & Security** on first launch. Windows builds are unsigned and may show a SmartScreen prompt.

## Quick start

```sh
papyri ctl ping --wait 5        # Wait for a running window
papyri ctl open path/to/doc.md  # Open, launching Papyri if needed
papyri ctl state --json         # Active document, tabs, view, preferences
```

`papyri ctl open` accepts a document, folder, or split-pane target. A bare `papyri path/to/doc.md` also forwards to a running window or launches one.

## What an agent can do

| Area                | Commands                                                                |
| ------------------- | ----------------------------------------------------------------------- |
| Inspect state       | `state`, `headings`, `commands`, `watch`                                |
| Open and switch     | `open`, `tab list`, `tab next`, `tab activate`, `tab close`             |
| Navigate            | `scroll`, `heading`, `page`, `search`                                   |
| Edit                | `editor open`, `editor set`, `editor save`, `editor reload`             |
| Explore files       | `explorer list`                                                         |
| Control the UI      | `panel`, `right`, `decorationless`, `fit-width`, `zoom`, `theme`        |
| Inspect and capture | `dom query`, `dom get`, `dom click`, `dom type`, `screenshot`, `record` |
| Manage tools        | `tools install`, `tools texlive`, `tools status`                        |
| Preferences         | `preferences get`, `preferences set`                                    |

Run `papyri ctl --help` for the complete command list, and `papyri ctl <command> --help` for values and options.

## Setup for the user

### Install Papyri

Download a build for Linux, macOS, or Windows from [Releases](https://github.com/pseudofractal/papyri/releases/latest). On Linux, Nix users can install or run it directly:

```sh
nix profile install github:pseudofractal/papyri
nix run github:pseudofractal/papyri -- path/to/document.md
```

### Open a document or folder

```sh
papyri path/to/document.md
papyri path/to/folder
```

Use `--decorationless` for a chrome-free reading window. The app reopens the most recent project when started without a path.

### Install language servers and compilers

Open **Settings → Compilers** in the app, or ask the running window to install a managed tool:

```sh
papyri ctl tools install marksman tinymist texlab typst
papyri ctl tools texlive install
papyri ctl tools status
```

`tools install` downloads the latest upstream release, verifies its SHA-256 and architecture, installs it under Papyri's data directory, and selects it automatically. A running window is required; use `papyri ctl open PATH` first if necessary.

Managed TeX Live is a large optional download. On macOS it uses the system `perl`; on Windows it uses the official TeX Live installer. The browser build cannot run compilers or language servers.

### Permissions

macOS asks for Accessibility permission before synthetic input and Screen Recording permission before screen or window capture. Windows input cannot target elevated windows. Papyri's own control socket is per-user and should be treated as sensitive.

## Common workflows

### Open a document and summarize it

```sh
papyri ctl open path/to/document.md
papyri ctl state --json
papyri ctl document stats
```

### Find a section or page

```sh
papyri ctl headings
papyri ctl search "theorem"
papyri ctl heading introduction
papyri ctl page 3
```

### Edit and save

```sh
papyri ctl editor open
papyri ctl editor set --file draft.tex
papyri ctl editor save
```

Use the editor commands for source changes instead of modifying files behind the app. Save behavior includes external-change checks and draft handling.

### Inspect the UI or take a screenshot

```sh
papyri ctl dom query 'header button' --json
papyri ctl dom get dom-12 --json
papyri ctl screenshot app --output /tmp/papyri.png
```

`screenshot app` captures the main app view. `screenshot screen` captures the whole desktop, and `screenshot element` captures one DOM node.

### Watch for changes

```sh
papyri ctl watch --events state,headings,browser,selection
```

`watch` streams newline-delimited JSON. Other commands print readable output by default; add `--json` for one compact JSON object.

## Discovery and help

```sh
papyri --help
papyri ctl --help
papyri ctl open --help
papyri skill
papyri completions bash
```

`papyri skill` prints the compact agent skill embedded in the binary. Point other agents at this guide with the repository URL or a local checkout:

```text
https://github.com/pseudofractal/papyri/blob/main/docs/agent-guide.md
```

## Safety and limits

- `papyri ctl` controls the visible window; it does not render documents headlessly.
- The document preview is isolated from the privileged host DOM. Do not weaken that boundary or inject document HTML into the host.
- LaTeX and Typst run with the current user's permissions. There is no compiler sandbox; only open documents and use compiler binaries you trust.
- Network access for document resources is opt-in.
- Do not expose the control socket, paste private document contents into prompts, or include credentials and personal filesystems in test fixtures.
- Full protocol details and examples are in [the control API](control.md). Platform support and build notes are in [platform support](platform.md); the trust model is in [security](security.md).

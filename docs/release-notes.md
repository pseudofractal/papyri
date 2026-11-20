# Papyri release notes

Papyri is a Markdown, PDF, Typst, and LaTeX viewer and source editor. Releases include native builds for Linux, macOS, and Windows. The browser build runs from source.

## What's new in v0.3.0

- Added the **Neovim companion plugin** in `editors/nvim`: Markdown and Typst overlays for unsaved buffer text, cursor follow, preview clicks that return to the source, a single companion tab, and a `:Papyri {subcommand}` command surface. The plugin is published to the `nvim-plugin` branch for lazy.nvim and `vim.pack`.
- Added the preview-attachment control API: `preview.attach`, `preview.detach`, `preview.heartbeat`, `preview.update`, `preview.reveal`, and `preview.viewport`, including ownership leases and takeover handling.
- Typst attachments no longer compile a PDF before switching. Source text is opened directly, so Markdown ↔ Typst switches avoid the old 10-second stall; attached Typst panes show a loading state while Tinymist starts.
- Decoration-less mode now hides the Typst live-preview heading and zoom controls as well as the rest of the application chrome.
- Preview changes use a short midpoint-peaked transition, disabled when reduced motion is requested.
- Build identity is now visible in `papyri --version`, `papyri ctl --version`, `ping`, and `state`, including the commit that produced the binary.
- Neovim launch handling now takes a cross-process launch lock, retries the control connection, and supports a configurable `launch_timeout`; health checks probe the running app, preview features, and Tinymist/Marksman.

## What's new in v0.2.2

- Fixed the Nix npm dependency hash so flake checks and the release verification pass. The v0.2.1 tag was not published.
- Added the **Compilation log**: a desktop Log window for the most recent LaTeX or Typst compile, with phase and page progress, diagnostics, copy-to-clipboard, and command-palette defaults of 70% width and 60% height. The size is configurable under **Settings → Compilers**.
- Cancelled builds are reported as **Cancelled** instead of failed, and only the newest compiler output is retained.
- Removed the temporary compile-log design lab and the header Designs button.
- LaTeX compilation now allows 5 minutes per compiler subprocess for first-run font-cache builds and large documents; Typst remains at 30 seconds.
- Includes the macOS ad-hoc signing fix added after v0.2.0, so downloads no longer need the previous manual `codesign` repair.

## Linux

Download the x86_64 AppImage or `.deb` package.

```sh
chmod +x Papyri-*.AppImage
./Papyri-*.AppImage path/to/document.md
```

Or install with Nix:

```sh
nix profile install github:pseudofractal/papyri
nix run github:pseudofractal/papyri -- path/to/document.md
```

The Linux build uses GTK/WebKitGTK for the embedded browser panel and X11 for coordinate input. Screen/window capture and `papyri ctl` are available as well.

## macOS

Download the `.dmg` for your Mac (`x86_64` for Intel, `aarch64` for Apple Silicon), open it, and drag Papyri into Applications. The builds are ad-hoc signed but not notarized. On first launch, open **System Settings → Privacy & Security**, scroll to Security, and choose **Open Anyway** for Papyri. On older macOS versions, right-clicking the app and choosing **Open** also works. macOS 11 or newer is required.

The macOS build compiles LaTeX and Typst with the compilers found on `PATH` or selected in Settings. Compilation runs with the current user permissions. Managed language-server, Typst, and TeX Live downloads are available. The embedded browser panel, coordinate input, screen/window capture, and `papyri ctl` are available. macOS asks for Accessibility permission before synthetic input and Screen Recording permission before screen/window capture.

## Windows

Download and run the NSIS installer. Windows 10 or newer with the WebView2 runtime is required; the installer downloads WebView2 if it is missing.

The Windows build compiles LaTeX and Typst with the compilers found on `PATH` or selected in Settings. Compilation runs with the current user permissions. Managed language-server, Typst, and TeX Live downloads are available. The embedded browser panel, coordinate input, screen/window capture, and `papyri ctl` are available. Windows input cannot target higher-integrity/elevated windows. LaTeX and Typst run with the current user permissions.

## Web build

The browser build works on all three platforms and supports document viewing, editing with browser-granted folders, and bibliography parsing. Native compilation, language servers, reference lookup/downloads, and the desktop browser panel require a native build.

## Feature matrix

| Feature                               | Linux | macOS | Windows | Web                    |
| ------------------------------------- | ----- | ----- | ------- | ---------------------- |
| Markdown, PDF, Typst, LaTeX view      | Yes   | Yes   | Yes     | Yes                    |
| Source editing and saving             | Yes   | Yes   | Yes     | Chromium folder access |
| Bibliography timeline                 | Yes   | Yes   | Yes     | Yes                    |
| LaTeX/Typst compilation               | Yes   | Yes   | Yes     | No                     |
| Language servers                      | Yes   | Yes   | Yes     | No                     |
| DOI/arXiv/PubMed lookup and downloads | Yes   | Yes   | Yes     | No                     |
| Embedded browser panel                | Yes   | Yes   | Yes     | No                     |
| Native screen/window capture          | Yes   | Yes   | Yes     | No                     |
| Coordinate input injection            | Yes   | Yes*  | Yes*    | No                     |
| `papyri ctl`                          | Yes   | Yes   | Yes     | No                     |

- macOS requires Accessibility/Screen Recording grants; Windows input cannot target elevated windows.

## Checksums

Each release includes `SHA256SUMS.txt` covering every uploaded asset. Verify with:

```sh
sha256sum -c SHA256SUMS.txt
```

On Windows, compare `Get-FileHash <file> -Algorithm SHA256` with the manifest.

## Android

Android is not part of this release. The native shell now reports platform capabilities and keeps document, preview, editor, and bibliography code independent of desktop-only subsystems so an Android shell can reuse them later.

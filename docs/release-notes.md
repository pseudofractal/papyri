# Papyri release notes

Papyri is a Markdown, PDF, Typst, and LaTeX viewer and source editor. Releases include native builds for Linux, macOS, and Windows, plus a browser build.

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

Download the `.dmg` for your Mac (`x86_64` for Intel, `aarch64` for Apple Silicon), open it, and drag Papyri into Applications. The builds are unsigned, so the first launch may require right-clicking the app and choosing **Open**. macOS 11 or newer is required.

The macOS build compiles LaTeX and Typst with the compilers found on `PATH` or selected in Settings. Compilation uses `sandbox-exec` to deny network access and writes outside the temporary output directory. Managed language-server, Typst, and TeX Live downloads are available. The embedded browser panel, coordinate input, screen/window capture, and `papyri ctl` are available. macOS asks for Accessibility permission before synthetic input and Screen Recording permission before screen/window capture.

## Windows

Download and run the NSIS installer. Windows 10 or newer with the WebView2 runtime is required; the installer downloads WebView2 if it is missing.

The Windows build compiles LaTeX and Typst with the compilers found on `PATH` or selected in Settings. Compilation runs with your user permissions because Windows has no bubblewrap equivalent. Managed language-server, Typst, and TeX Live downloads are available. The embedded browser panel, coordinate input, screen/window capture, and `papyri ctl` are available. Windows input cannot target higher-integrity/elevated windows, and compilation runs with the current user permissions.

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

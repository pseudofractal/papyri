# Platform support

Papyri keeps the document, preview, editor, bibliography, and project code independent of the native window toolkit. The native shell reports a capability set at startup, and both Rust and the frontend use it to select the available feature surface.

## Capability contract

`src-tauri/src/platform/mod.rs` defines `Capabilities` and serializes it into `window.__PAPYRI_PLATFORM__` before the frontend runs. The same values are available through the `platform_capabilities` command.

| Capability                            | Meaning                                                              |
| ------------------------------------- | -------------------------------------------------------------------- |
| `browserPanel`                        | Embedded GTK website tabs are available.                             |
| `inputInjection`                      | Coordinate/keyboard input via X11 is available.                      |
| `screenCapture`                       | Full-screen or rectangular screenshots are available.                |
| `webviewCapture`                      | The application webview can be captured natively.                    |
| `windowEnumeration` / `windowCapture` | External windows can be listed and captured.                         |
| `controlSocket`                       | `papyri ctl` can connect to the running window.                      |
| `managedTools`                        | Language servers and Typst can be downloaded from upstream releases. |
| `managedTexlive`                      | The private TeX Live installer is supported.                         |
| `latex` / `typst`                     | Native compilation is available.                                     |
| `sandboxedCompilation`                | Compilation has an OS sandbox.                                       |
| `clipboardImages`                     | Image clipboard read/write is available.                             |

The frontend reads the injected object in `src/lib/platform.ts`. It hides embedded-browser controls and disables managed downloads where the capability is false.

## Platform modules

- `platform/control.rs`: Unix stream socket on Linux/macOS; loopback TCP endpoint with a per-process token on Windows.
- `platform/sandbox.rs`: bubblewrap plus `prlimit` on Linux, `sandbox-exec` on macOS, direct execution on Windows. LaTeX and Typst share this interface, so adding another OS only requires a compiler-command implementation.
- `platform/clipboard.rs`: `wl-copy`/`xclip` on Unix, `arboard` on macOS and Windows.
- `screenshot.rs`: grim/ImageMagick on Linux, `screencapture` on macOS, PowerShell/System.Drawing on Windows. Webview capture remains Linux-only.
- `input.rs` / `input_portable.rs`: X11 input and GTK window capture on Linux; Tauri window enumeration and focus elsewhere.
- `browser.rs` / `browser_stub.rs`: the GTK child-webview panel on Linux; a typed "unavailable" command surface elsewhere.

## Building

### Linux

```sh
nix develop -c npm ci
nix develop -c npm run tauri build -- --bundles appimage,deb
```

The Nix package (`nix build .#papyri`) is still the supported reproducible Linux build.

### macOS

Install Xcode Command Line Tools, Node 24, and Rust. Then:

```sh
npm ci
npm run tauri build -- --target aarch64-apple-darwin   # Apple Silicon
npm run tauri build -- --target x86_64-apple-darwin    # Intel
```

The local `.dmg` and `.app` are under `src-tauri/target/<target>/release/bundle/`. Unsigned builds require right-click → Open on first launch. Code signing and notarization can be added with the standard Tauri macOS environment variables.

### Windows

Install Node 24, Rust with the MSVC toolchain, and the WebView2 runtime. Then:

```sh
npm ci
npm run tauri build
```

The NSIS installer is under `src-tauri/target/release/bundle/nsis/`. The installer bootstraps WebView2 if needed.

### Android

Android is not built yet. The modular boundary is in place:

1. Keep document, preview, editor, bibliography, and settings code free of desktop-only commands.
2. Add a `tauri.android.conf.json` capability profile and a mobile entry point.
3. Register mobile implementations for the commands that remain (file access through the platform picker, clipboard, and external links).
4. Hide desktop-only controls through `Capabilities`.

The generated `src-tauri/icons/android` and `src-tauri/icons/ios` icon sets are already present for `tauri android init`.

## CI

- `.github/workflows/ci.yml` checks Linux through Nix and runs `cargo check` on macOS and Windows.
- `.github/workflows/release.yml` builds AppImage/deb, macOS Intel/Apple Silicon DMGs, and a Windows NSIS installer, then uploads them to the matching GitHub release.

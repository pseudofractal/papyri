# Platform support

Papyri keeps the document, preview, editor, bibliography, and project code independent of the native window toolkit. The native shell reports a capability set at startup, and both Rust and the frontend use it to select the available feature surface.

## Capability contract

`src-tauri/src/platform/mod.rs` defines `Capabilities` and serializes it into `window.__PAPYRI_PLATFORM__` before the frontend runs. The same values are available through the `platform_capabilities` command.

| Capability                            | Meaning                                                              |
| ------------------------------------- | -------------------------------------------------------------------- |
| `browserPanel`                        | Embedded child-webview website tabs are available.                   |
| `inputInjection`                      | Native pointer/keyboard input is available (subject to OS grants).   |
| `screenCapture`                       | Full-screen or rectangular screenshots are available.                |
| `webviewCapture`                      | The application webview can be captured.                             |
| `windowEnumeration` / `windowCapture` | Desktop windows can be listed, focused, and captured.                |
| `controlSocket`                       | `papyri ctl` can connect to the running window.                      |
| `managedTools`                        | Language servers and Typst can be downloaded from upstream releases. |
| `managedTexlive`                      | The private TeX Live installer is supported on all desktops.         |
| `latex` / `typst`                     | Native compilation is available.                                     |
| `clipboardImages`                     | Image clipboard read/write is available.                             |

The frontend reads the injected object in `src/lib/platform.ts`. It hides embedded-browser controls and disables managed downloads where the capability is false.

## Platform modules

- Compilation runs the selected LaTeX/Typst executables directly with the current user permissions on every platform. There is no compiler sandbox; the app still limits elapsed time and output size.
- `platform/control.rs`: Unix stream socket on Linux/macOS; loopback TCP endpoint with a per-process token on Windows.
- `platform/clipboard.rs`: `wl-copy`/`xclip` on Linux, `arboard` on macOS and Windows.
- `platform/window.rs`: `xcap` window enumeration and capture on macOS/Windows, with native focus calls.
- `screenshot.rs`: grim/ImageMagick on Linux, `screencapture` on macOS, PowerShell/System.Drawing on Windows. App and browser capture use native Linux snapshots or a window-region capture on macOS/Windows.
- `input.rs` / `input_portable.rs`: X11 input and GTK window capture on Linux; CoreGraphics (`platform/macos.rs`) and `SendInput` (`platform/windows.rs`) input on macOS/Windows.
- `browser.rs` / `browser_tauri.rs`: the GTK child-webview panel on Linux; Tauri `Window::add_child` webviews on macOS/Windows with per-profile data storage, navigation, zoom, popups, DOM bridging, and capture.

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

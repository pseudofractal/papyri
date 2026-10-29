# PDF and Typst documents

Open `.pdf` or `.typ` files with `papyri path/to/document`, the file picker, the explorer, or a link from another document. They share tabs, split view, keyboard shortcuts, and live refresh with Markdown. The viewer remains read-only. A Typst preview compiles into memory and never writes a PDF beside the source.

## PDF

Mozilla's PDF.js renders PDFs locally, with selectable text, Ctrl F search, page controls, internal destinations, PDF outlines in the table of contents, and external links through the existing URL policy. Relative links to supported local documents resolve against the PDF's folder. `#page=2` and named destinations work in links to PDFs. Zoom redraws page canvases at the new resolution; Ctrl = fits the current pane width. PDF scale is stored separately from Markdown font size, ranges from 10–1,000%, and follows the fitted scale so zoom-in always increases the page. PDF pages have a fixed layout, so font-size reflow is not available. The surrounding interface follows Catppuccin; authored page colors are preserved.

The renderer loads only when a PDF or Typst preview opens. Its worker, standard fonts, CMaps, image decoders, and interface icons are bundled, without a CDN; their upstream notices are included in `pdf-licenses/` in the static output. Visible pages are prioritized by PDF.js and its page-buffer cache releases older canvases. There is a 64 MiB input/output limit and an 8-megapixel budget per canvas. This is not a total process memory limit: large images, many pages, and searching long files can still consume substantial resources. PDFs are read fully before parsing; HTTP range streaming is not used for local files.

Password-protected PDFs prompt within the isolated preview. Passwords are not persisted. PDF JavaScript, XFA, interactive form editing, embedded-file downloads, and document launch actions are not enabled. PDF text search cannot find words in scanned images; OCR is not included. An invalid or unsupported PDF reports a preview error.

## Typst on Linux

The Nix package and development shell supply the official Typst CLI, Bubblewrap, and `prlimit`, pinned by `flake.lock`. The current lock provides Typst 0.15.1. No separate compiler installation or network service is needed. A kernel permitting unprivileged user namespaces is required; a sandbox initialization failure reports an error rather than compiling without isolation.

The containing directory of the canonical `.typ` file is the project root. Local imports, data, bibliography, and images must stay within that directory. Absolute Typst paths start at this project root. For a multi-file project, open its main entry point at the project root. Parent-directory imports and host filesystem paths are deliberately unavailable. Symlinks pointing outside the mounted project cannot read those host files.

Typst's embedded fonts are available offline. Additional fonts can be placed in a `fonts/` subdirectory beside the entry point; system font discovery is disabled for consistent sandbox access. Font substitutions and missing fonts follow Typst's diagnostics. Cached packages are mounted read-only from `$XDG_DATA_HOME/typst/packages` and `$XDG_CACHE_HOME/typst/packages`, falling back to `~/.local/share/typst/packages` and `~/.cache/typst/packages`. Missing packages fail: Papyri never downloads them. Prepare them separately with the official CLI before opening a document that needs them. The application network-content preference does not permit Typst downloads.

The compiler has no network interface, no inherited host environment or credentials, and no writable project access. Its runtime Nix store paths and cached packages are read-only; a private temporary output directory holds dependency metadata and is removed afterward. Compilation is limited to one job at a time, two compiler threads, 2 GiB address space, 25 CPU seconds per process, 30 seconds elapsed time, and 64 MiB PDF output. These limits contain ordinary runaway documents; they are not a guarantee against all compiler or kernel vulnerabilities.

Foreground polling checks the entry point and local dependencies reported by the last successful compilation. Changes to imported source, images, or bibliography trigger recompilation. On syntax errors, missing imports, or timeouts, an already-open tab retains its last successful preview and shows the compiler diagnostics. An unopened document with an error does not create a blank tab. Changes to package caches, fonts, and newly referenced dependencies may require changing the entry point or reopening it. Polling is paused while the app is hidden.

## Static web build

The GitHub Pages-compatible build supports PDFs selected by the user or present in a granted folder. Selected-file imports are snapshots; granted folders can be polled where the browser supports that API. Local links cannot reach outside the selected files or granted folder. The renderer assets are local to the deployment; the site must first load, and an offline restart is not guaranteed without an installed service worker.

Typst compilation requires the installed Linux app. Opening `.typ` in the browser explains this limitation; an exported PDF can be viewed there. A browser compiler was considered, but would add another compiler/WASM and font distribution, plus a separate filesystem/import implementation. The first implementation uses the official compiler and shares PDF rendering across both modes.

Upstream integration references: [PDF.js examples](https://mozilla.github.io/pdf.js/examples/), [PDF.js API](https://mozilla.github.io/pdf.js/api/draft/), [Typst](https://github.com/typst/typst), and [Bubblewrap](https://github.com/containers/bubblewrap).

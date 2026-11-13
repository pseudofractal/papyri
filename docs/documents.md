# PDF, Typst and LaTeX documents

Open `.pdf` or `.typ` files with `papyri path/to/document`, the file picker, the explorer, or a link from another document. They share tabs, split view, keyboard shortcuts, and live refresh with Markdown. The viewer remains read-only. A Typst preview compiles into memory and never writes a PDF beside the source.

Papyri remembers recently opened folders locally. The command palette shows up to ten recent projects in its All and Recent filters, and typing `~` filters directly to them. Selecting one switches the explorer and workspace scope and reopens the last document used from that folder when it is still available. The palette's segmented scope control switches between the current folder, its parent, and the workspace folder without a dropdown. Recent folders are stored only in the local application profile.

The desktop app also opens `.tex` entry points, compiles them locally and previews the resulting PDF. When compilation or PDF rendering fails, Papyri shows the source with syntax highlighting and an explanation. The static web build shows Typst and LaTeX source; use an exported PDF for the compiled output.

## PDF

Mozilla's PDF.js renders PDFs locally, with selectable text, Ctrl F search, page controls, internal destinations, PDF outlines in the table of contents, and external links through the existing URL policy. Relative links to supported local documents resolve against the PDF's folder. `#page=2` and named destinations work in links to PDFs. Zoom redraws page canvases at the new resolution; Ctrl = fits the current pane width. PDF scale is stored separately from Markdown font size, ranges from 10–1,000%, and follows the fitted scale so zoom-in always increases the page. The PDF toolbar follows the interface font; page content keeps its embedded fonts. PDF pages have a fixed layout, so font-size reflow is not available. The surrounding interface follows Catppuccin; authored page colors are preserved.

The renderer loads only when a PDF or Typst preview opens. Its worker, standard fonts, CMaps, image decoders, and interface icons are bundled, without a CDN; fonts, CMaps, and decoders load only if needed. Their upstream notices are included in `pdf-licenses/` in the static output. Visible pages are prioritized by PDF.js and its page-buffer cache releases older canvases. There is a 64 MiB input/output limit and an 8-megapixel budget per canvas. This is not a total process memory limit: large images, many pages, and searching long files can still consume substantial resources. PDFs are read fully before parsing; HTTP range streaming is not used for local files.

Password-protected PDFs prompt within the isolated preview. Passwords are not persisted. PDF JavaScript, XFA, interactive form editing, embedded-file downloads, and document launch actions are not enabled. PDF text search cannot find words in scanned images; OCR is not included. An invalid or unsupported PDF reports a preview error.

## Typst

Papyri searches for Typst on the app's `PATH`. In Settings, an absolute executable path overrides discovery; leaving it blank uses the discovered command, or the Nix-bundled compiler if none is found. The Nix package and development shell supply Typst 0.15.1, pinned by `flake.lock`. Changing the path recompiles open Typst previews.

The containing directory of the canonical `.typ` file is the project root. Local imports, data, bibliography, and images must stay within that directory. Absolute Typst paths start at this project root. For a multi-file project, open its main entry point at the project root. Typst is invoked with `--root` set to that directory, so imports outside it are rejected by the compiler.

Typst's embedded fonts are available offline. Additional fonts can be placed in a `fonts/` subdirectory beside the entry point; system font discovery is disabled for consistent output. Font substitutions and missing fonts follow Typst's diagnostics. Typst resolves packages from its normal user cache and may download missing packages. Papyri does not pre-seed or block that cache; the application network-content preference does not apply to the compiler.

Typst runs directly with the current user's permissions on every platform. It can read files and access the network according to Typst's normal behavior. A private temporary output directory holds the PDF and dependency metadata and is removed afterward. Compilation is limited to one job at a time and 30 seconds elapsed time, with a 64 MiB PDF output limit.

Foreground polling checks the entry point and local dependencies reported by the last successful compilation. Changes to imported source, images, or bibliography trigger recompilation. On syntax errors, missing imports, or timeouts, the tab shows source and compiler diagnostics; it returns to the PDF when compilation succeeds. Changes to package caches, fonts, and newly referenced dependencies may require changing the entry point or reopening it. Polling is paused while the app is hidden.

## LaTeX

Select LuaLaTeX, pdfLaTeX, or XeLaTeX in Settings. Papyri looks for the selected command on the application's `PATH`; an absolute executable path in Settings overrides discovery. Desktop launchers can have a different `PATH` from an interactive shell. XeLaTeX also needs `xdvipdfmx` beside its executable. Missing executables and compiler errors are shown in the app. Selecting a different engine or path triggers recompilation of open LaTeX previews.

The entry point's containing directory is the project root. Compilation uses two engine passes and a temporary output directory; it never writes auxiliary files or PDFs into the project. When the document requires BibTeX, Papyri finds it beside the engine or on `PATH` and makes a third engine pass. Imported files reported by the compiler and BibTeX bibliography files are tracked for live refresh. If compilation fails, the source and diagnostics remain visible while Papyri retries.

Papyri uses the installed TeX distribution rather than downloading packages. It does not run Biber, makeindex, latexmk, or other build tools. Documents requiring Biber report an error; documents requiring other tools may have unresolved references or indexes. The compiler runs with the current user's permissions and can use the installed TeX distribution, user packages, fonts, wrapper scripts, network access, and shell facilities according to its configuration. Compiler diagnostics explain failures; an exported PDF remains an alternative.

Compilation runs directly on every platform with the current user's permissions. Every platform uses a private temporary output directory and a 64 MiB per-file output limit. LaTeX allows 5 minutes per compiler subprocess; Typst allows 30 seconds.

## Compilation log

In the desktop app, when a LaTeX or Typst document is open, the **Log** button at the bottom of the window opens the most recent compilation. The floating log dims the workspace, shows the current phase and page progress, and retains up to 400 lines of the newest compiler output for copying. Typst compilations report a single-pass progress state instead of page counts. A new compilation from either engine replaces the previous log. The window defaults to 70% width and 60% height, follows the command palette's UI-scale handling, and is capped by the same maximum dimensions as the palette; both percentages are configurable under Settings → Compilers.

## Static web build

The GitHub Pages-compatible build supports PDFs selected by the user or present in a granted folder. Selected-file imports are snapshots; granted folders can be polled where the browser supports that API. Local links cannot reach outside the selected files or granted folder. The renderer assets are local to the deployment; the site must first load, and an offline restart is not guaranteed without an installed service worker.

Typst and LaTeX compilation require the installed desktop app. The browser shows source with syntax highlighting; an exported PDF can be viewed there. A browser compiler was considered, but would add another compiler/WASM and font distribution, plus a separate filesystem/import implementation. The first implementation uses the official compiler and shares PDF rendering across both modes. For source files longer than 100,000 characters, highlighting is disabled to keep the preview responsive.

Upstream integration references: [PDF.js examples](https://mozilla.github.io/pdf.js/examples/), [PDF.js API](https://mozilla.github.io/pdf.js/api/draft/), [Typst](https://github.com/typst/typst).

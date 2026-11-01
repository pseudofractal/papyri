# LaTeX preview implementation plan

## Scope and behavior

- Open `.tex` entry points in the Linux app and render their compiled PDFs using the existing PDF viewer. In browser mode, explain that compilation requires the Linux app.
- Offer LuaLaTeX, pdfLaTeX, and XeLaTeX as explicit choices, with LuaLaTeX as the default. Discover executables on the user's `PATH`, and allow executable paths to be configured in settings. Persist the choice and recompile open LaTeX previews when it changes.
- Display useful compiler diagnostics on failure. Keep the last successful preview visible during refresh failures, and provide a way to retry an initial failure.
- Treat the entry point's containing directory as the project root, consistent with Typst. Detect changes to files used by the last successful build, including imported TeX, images, and bibliography files.

## Compiler and isolation

- Discover the selected compiler on the user's `PATH` unless an executable path is configured. Validate the engine and executable path at the native boundary and report missing or unusable executables clearly. Use the user's installed TeX distribution and packages, rather than requiring a bundled TeX Live distribution. Keep the Nix development environment usable on both supported Linux architectures.
- Run the build in Bubblewrap with no network, a restricted environment, a read-only project and compiler runtime, a private writable output directory, and bounded time, CPU, memory, diagnostics, and PDF output. Support the library and TeX package paths needed by ordinary host installations without mounting the user's entire home directory. Disable TeX shell escape. LuaTeX remains capable of executing Lua, so isolation is required even with shell escape disabled. Explain unsupported runtime layouts or inaccessible package paths rather than silently compiling without isolation.
- Handle cross-references and bibliographies through a bounded build sequence. If using latexmk, suppress user and project configuration files and constrain the tools it may execute. Do not advertise BibTeX or Biber support until verified with real fixtures.
- Read dependency information from the compiler's recorder output, accepting project-local inputs only. Handle paths containing spaces and missing or malformed output explicitly. Never write auxiliary files into the project.

## Integration

- Extend native document detection, file picker, desktop associations, links, explorer, and startup paths. Keep the browser's existing import boundary intact.
- Connect engine choice to the source and workspace lifecycle without stale results replacing newer selections. Changes must trigger a fresh compilation even when the document's timestamp is unchanged.
- Update user-facing format descriptions, settings, security and compiler documentation to match the actual behavior and package coverage.

## Verification

- Exercise all three engines with real compilations, including an engine-specific document, imported files, cross-references, bibliography, syntax errors, and missing packages.
- Test engine switching, failed initial compilation, error recovery, last-preview retention, and dependency refresh. Check that stale concurrent results cannot replace the latest selection.
- Verify sandbox denial of network access, writes to the project and reads outside the allowed mounts, including symlinks; exercise timeout, output limits and child-process cleanup.
- Test PATH discovery and configured binary paths with representative system and Nix installations, including missing executables and unavailable dependencies. Evaluate the Nix package for both supported Linux architectures, and run native compilation and sandbox tests on each where runners are available. An evaluation or an x86-only test does not establish that the aarch64 build or runtime works.
- Run the configured frontend checks, Rust formatting and tests, the relevant native and browser tests, and the Nix package checks. Report any environment limitations without claiming unrun checks passed.

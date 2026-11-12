# AGENTS.md

Papyri is a local-first Markdown, PDF, Typst, and LaTeX viewer and source editor for Linux, macOS, Windows, and the web. Before changing code, read `README.md`, `docs/architecture.md`, `docs/security.md`, and `docs/platform.md`.

## Non-negotiable working rules

- Match the surrounding code, naming, formatting, and test patterns. Project conventions take precedence over general preferences.
- Keep changes focused. Do not refactor unrelated code, reformat whole files, upgrade dependencies, or add speculative abstractions.
- Preserve work you did not create. If a human edits code you wrote, respect it and do not reintroduce deleted code without explicit permission.
- Never claim a check passed without running it. Report the command and result, and distinguish pre-existing failures from new ones.
- Never commit secrets, credentials, private documents, or personal filesystem contents.
- Do not edit generated files (`dist/`, `public/renderer.*`, `public/pdf.*`, `src-tauri/target/`, `src-tauri/gen/`) by hand.
- Update `package-lock.json`, `Cargo.lock`, and `flake.lock` through their tools, never by hand.
- Do not run destructive Git or filesystem commands unless explicitly requested.

## Coding style

The `coding-style` skill is the normative style guide for this repository. If your harness exposes skills, load it before non-trivial implementation or review work. If the skill is unavailable, the rules below apply directly.

### Readable code

- Prefer clear, straightforward code over cleverness, terseness, or minimizing the number of variables. Use descriptive intermediate values to explain intent.
- Give domain values, thresholds, and other unexplained literals meaningful names.
- Name variables, functions, and types for their meaning and responsibility. Boolean names should read naturally in conditions.
- Extract difficult conditions into named booleans or predicates. Preserve evaluation order, short-circuiting, and lazy behavior.
- Prefer guard clauses and early returns when they simplify control flow. Extract a coherent operation into a well-named function when nesting or mixed responsibilities obscure intent.
- Keep functions focused and interfaces straightforward. Avoid duplication when a shared concept is clear, but do not introduce abstractions for hypothetical future needs.

### Comments and documentation

- Make code understandable through naming, structure, and small coherent operations. Keep comments minimal.
- Do not narrate obvious code or use comments to compensate for confusing implementation.
- Keep comments that explain reasoning, constraints, assumptions, tradeoffs, workarounds, or surprising behavior. Update them when behavior changes.
- Document public APIs, modules, and non-obvious interfaces according to project conventions. Explain parameters, return values, assumptions, side effects, and errors without restating signatures.
- Update relevant documentation and examples when public behavior or setup requirements change.

### Changes and error handling

- Make focused, complete changes that address the requested behavior. Preserve unrelated work and avoid incidental refactors, dependency upgrades, and formatting churn.
- Follow existing error-handling patterns. Handle expected failures explicitly and provide useful context.
- Do not silently swallow errors, disguise failure as success, or return plausible placeholder results.
- Validate inputs at boundaries; avoid redundant internal checks.
- Fix issues introduced by your changes. Report material pre-existing failures separately.

### Formatting and verification

- TypeScript and Svelte use Prettier (single quotes, trailing commas, 100 columns) and ESLint. Run `npx prettier --write <files>` for the files you changed; use `npm run format` only when a repo-wide format is intended.
- Rust uses `rustfmt` with two-space indentation and a 100-column width. Run `cargo fmt --manifest-path src-tauri/Cargo.toml`.
- Run the narrowest meaningful tests first, then the applicable project checks. Never run a repo-wide formatter over unrelated files.
- Inspect the final diff for accidental changes, generated artifacts, and whitespace errors.

### Commits

Inspect recent commit messages and follow the repository convention. Use `type(scope): concise description` with one primary type and scope per commit. Add short factual detail lines when useful, and split independent changes into separate commits.

## Repository map

- `src/` — Svelte 5 and TypeScript frontend. Use the existing runes, component, and store patterns.
- `src/render/` — preview frame runtime, sandbox policy, PDF renderer, and DOM inspector.
- `src-tauri/src/` — Rust/Tauri backend, commands, CLI, control socket, compilers, and managed tools.
- `src-tauri/src/platform/` — Linux, macOS, Windows, and shared platform implementations.
- `tests/` — Vitest unit and integration tests.
- `e2e/` — Playwright browser tests.
- `examples/showcase/` — representative documents and fixtures.
- `docs/` — architecture, security, platform, document support, control API, agent guide, and verification notes.
- `scripts/` — build, icon, release, benchmark, and native smoke tooling.

## Commands

Use the locked Nix development environment where possible:

```sh
nix develop
npm ci --ignore-scripts
git config --local core.hooksPath .githooks
npm run dev            # browser build
npm run tauri dev      # native app
```

Common checks:

```sh
npm run check
npm test
npm run lint
npm run test:e2e -- --workers=2
nix flake check --cores 4
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
nix build .#papyri
nix build .#web
```

The pre-push hook runs the full browser suite. It requires a clean working tree, and the pushed ref must point at the checked-out commit. GitHub Actions runs the flake checks and desktop compile checks, but not the full browser suite. macOS and Windows runtime behavior is not exercised by CI; use a physical platform pass for platform-specific changes.

For native WebKit validation on Linux:

```sh
PAPYRI_BINARY=$(nix build --print-out-paths .#papyri)/bin/papyri ./scripts/native-smoke.sh
```

Some compiler integration tests are ignored by default. Run them explicitly with `PAPYRI_TEST_TEX_BIN` set to a directory containing `lualatex`, `pdflatex`, and `xelatex`.

## Architecture and security invariants

- Keep the frontend/backend boundary: native capabilities go through Tauri commands; do not reach into platform APIs from the frontend.
- Use the capability contract in `src/lib/platform.ts`. Gate desktop-only controls through `Capabilities`; keep document, preview, editor, bibliography, and project logic usable by a future Android shell.
- Keep shared code platform-neutral. Use `src-tauri/src/platform/` for paths, executables, config directories, clipboard, input, windows, and screenshots. Do not assume POSIX paths or Linux APIs in shared modules.
- Preview isolation is intentional. Document HTML must stay out of the privileged host DOM. Keep the opaque-origin `srcdoc` frame, CSP, DOMPurify sanitization, and script trust flow intact. Do not add `allow-same-origin` or weaken the frame policy.
- Compilers run directly with the current user's permissions on every platform. Do not reintroduce compiler sandboxing (`sandboxedCompilation`, bubblewrap, `prlimit`, `sandbox-exec`) or re-add `-no-shell-escape`. The app still bounds elapsed time, diagnostics, and output size.
- The host token is injected into the main webview only. Browser child webviews and preview frames must not receive it.
- Managed tools are downloaded from upstream GitHub releases and must keep size, SHA-256, archive, and architecture verification. Do not bypass these checks or add unchecked download paths.
- Network access for document resources is opt-in. Do not fetch remote content when the network preference is disabled.
- Treat `SECURITY.md` and `docs/security.md` as the reporting and trust-model references.

## Git and releases

Only modify Git state when the user explicitly requests it. Treat each request as authorization for one write operation; after completing it, do not perform another write operation until asked. Do not amend or create fixup commits after feedback unless explicitly instructed.

Keep versions aligned across `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json`. Run `node scripts/check-release.mjs vX.Y.Z` before tagging. Tagging, publication, and repository-visibility changes are separate maintainer actions; do not perform them unless requested.

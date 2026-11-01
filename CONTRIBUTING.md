# Contributing

Papyri is a read-only Markdown, PDF, Typst, and LaTeX viewer for Linux with a shared static web frontend. Keep changes focused on these formats, navigation and supported embedded content. Android, document editing and general-purpose file viewing are outside the current scope. See [document support](docs/documents.md) for compiler requirements and deployment differences.

## Development

Use the locked Nix development environment and dependencies:

```sh
nix develop
npm ci --ignore-scripts
git config --local core.hooksPath .githooks
npm run dev
# Or: npm run tauri dev
```

Use TypeScript and the existing Svelte 5 patterns. Use maintained Markdown, math and diagram libraries rather than adding a custom parser or rendering engine. Keep UI text functional and direct. Use theme variables for UI colors; the app mark should inherit its surrounding color.

The configured pre-push hook runs the full browser suite in the Nix development environment and blocks the push if it fails. Install dependencies first with `npm ci --ignore-scripts`. For pushes containing commits, the hook requires a clean working tree and each pushed ref to point to the checked-out commit; check out and push other commits separately. Deletion-only pushes do not run the suite. Git hooks are local to each clone and do not run for changes made directly on GitHub. GitHub Actions continues to run the flake checks, but not the browser suite.

Before proposing a change, run:

```sh
npm run check
npm test
npm run lint
npm run test:e2e -- --workers=2
nix flake check --cores 4
```

Run `npm run format` and `cargo fmt --manifest-path src-tauri/Cargo.toml` when needed. Add regression coverage for changed behavior, especially local paths, live refresh, math delimiters and sandbox boundaries. Native behavior requires the [Linux WebDriver smoke test](scripts/native-smoke.py); Chromium alone cannot validate WebKit or Tauri IPC isolation.

For process-to-window and first-document measurements, see the [startup performance rubric and native benchmark](docs/startup-performance.md).

Keep npm, Cargo and Nix lockfiles in sync when changing dependencies. The app is not distributed through npm; `private: true` prevents accidental npm publication. See [icon regeneration](docs/design/README.md) for branding changes.

## Bug reports

Include the app version, Linux distribution, WebKitGTK version if known, deployment mode (Nix app or browser), reproduction steps and expected behavior. A small non-sensitive Markdown example is more useful than a large personal document. Mention UI/document zoom, theme, custom math delimiters and whether scripts or network resources were enabled when relevant.

Use the [security reporting policy](SECURITY.md) for suspected vulnerabilities. Do not include private documents, credentials or personal filesystem contents in reports or test fixtures.

## Release candidates

Keep the versions in `package.json`, `package-lock.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json` aligned. Nix reads its version from `package.json`. Run `node scripts/check-release.mjs vX.Y.Z` before tagging; the tag workflow enforces this agreement. Complete frontend, flake and native checks and update [verification results](docs/verification.md). Tagging validates the candidate; publication and repository visibility are separate maintainer actions.

# Verification

Validation target: x86_64 Linux, Chromium and native Tauri/WebKitGTK. Last full verification: 29 October 2026. These results describe this environment, not guarantees for every Linux desktop or document.

## Automated coverage

| Check                             | Coverage                                                                                                                                                                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                   | Svelte and TypeScript, including browser tests                                                                                                                                                                                                      |
| `npm test`                        | 100 tests: rendering, delimiters, references, settings merge/validation, control dispatch, paths, CSP, navigation races, source replacement, refresh, compiled-preview retention, paging, frame viewport measurements and dialog viewport lifecycle |
| `npm run lint`                    | ESLint and Prettier                                                                                                                                                                                                                                 |
| `npm run test:e2e -- --workers=2` | Production frontend at desktop and mobile browser sizes; reading, links, search, splits, diagrams, trust, persistence, zoom, sizing, keyboard navigation and accessibility                                                                          |
| `nix flake check --cores 4`       | Static and Linux builds, Rust tests/formatting, frontend quality, icon regeneration, desktop-entry validation and matching release metadata                                                                                                         |
| `scripts/native-smoke.py`         | Packaged Linux WebKit app; CLI file/directory/current directory, live updates, hidden files, images, local links, rendering, themes, zoom, split panes, numeric references, IPC isolation, control socket/CLI, control settings and panels          |

The mobile explorer-drag browser scenario is intentionally skipped because that layout uses an overlay sidebar. Mobile browser emulation is not an Android app test. Native smoke tests use an isolated temporary application profile and fixtures; they do not modify user preferences or documents. Headless runs use an explicit X11 backend, a 96-DPI virtual display and `WEBKIT_DISABLE_COMPOSITING_MODE=1`, which are test settings rather than application defaults. An initial 100-DPI run misaligned WebDriver pointer coordinates and failed the drag check; the complete suite passed at 96 DPI with and without a window manager. Run `nix develop -c ./scripts/native-smoke.sh` with `PAPYRI_BINARY` set to a built binary; the wrapper pins the display size, DPI and X11 backend. The development shell provides `tauri-driver`, `WebKitWebDriver`, `xvfb-run`, and `xdotool`. See the [native smoke script](../scripts/native-smoke.py) for driver requirements.

The branding cleanup passed 34 unit tests, Svelte/TypeScript checks, ESLint/Prettier and the complete production browser suite: 35 passed, with the one intentional mobile skip. Browser coverage includes inherited mark color, the favicon, both icon placements, light-theme settings/help dialogs, configurable CSS accent inheritance and long filenames.

The final x86_64 Linux flake checks passed, including three Rust tests and the new packaging check. Rust Clippy also passed with warnings denied. The packaged application passed the complete native smoke suite with a filename containing spaces, themed settings, inherited logo color, real mouse dragging, keyboard shortcuts and live refresh. The refresh test waits for the real scroll message to reach the host before changing its fixture, avoiding a race with the debounced bookmark update.

A separate X11 desktop check launched the installed `.desktop` entry through GIO with a filename containing spaces, confirmed the `papyri` window class, and inspected GTK's actual icon pixmap: the selected bracketed M at 512 × 512, with neutral grayscale pixels. GTK exposes that icon through legacy `WM_HINTS` in this environment; inspecting only `_NET_WM_ICON` can report a generic startup fallback or no property. Native startup explicitly reapplies the configured icon after webview creation. Desktop-entry validation also runs during Nix installation, and the package includes both scalable icons and all five raster sizes.

## Regression checks

- Theme, document zoom and fit-width changes retain the preview DOM. Appearance updates do not create another parsing worker or reload the frame.
- Physical Linux WebDriver input verifies Ctrl Shift = and numeric keypad + increase the font size, reflow text and leave page scale unchanged. Missing logical-key values and Shift Tab are covered explicitly.
- Each preview tracks its own viewport while explorer, outline, split layout and UI zoom change. Tests compare document bounds against frame `innerWidth` and the host iframe, avoiding WebKit's scaled `clientWidth` measurement. Document font size stays independent of UI zoom.
- A real geometry guide previously passed 16 native layout checks at 50–200% UI zoom with panel and split changes. The document stays inside its viewport; fit-width code wraps without changing source text. The private guide was not modified or copied into the repository. Generic fixtures cover the same layout conditions.
- Wide equations, tables and diagrams retain local scrolling. Expanded diagrams fit the frame, remain isolated, and support Close and Escape. Catppuccin defaults apply when authors omit colors; authored colors are preserved.
- Security tests cover opaque-origin parent access rejection, safe-mode script blocking, explicit trust, trust revocation, forged/absent native host tokens, deferred-library DOM clobbering and revoked frame message channels.
- Native control checks exercise `papyri ctl` over the real Unix socket: ping and state, auto-launched and forwarded opens, tab switching, split panes, Markdown and PDF scrolling, headings, search, palette commands, preferences, event watching, raise and quit.
- Branding checks use one monochrome SVG source, regenerate launcher/native icons, validate the desktop entry, and verify inherited icon color and themed dialogs. Long filenames remain bounded in the toolbar.

## Floating-panel layout

Settings, help, trust prompts and expanded diagrams are limited to 75% of the visible viewport width and 80% of its height. Host modal overlays use a stable viewport coordinate system, preserving the selected UI scale inside the panel. Window resizing, visual-viewport changes and panning update their measurements. Text, buttons and control rows wrap; settings and prompt overflow is vertical. Diagram artwork keeps its own two-axis scroll area.

Regression coverage includes 20 settings viewport/zoom combinations per browser profile, long unbroken text, scrolling between Close and Apply, narrow help/trust prompts, Escape dismissal, viewport offsets during mobile emulation, and the diagram size limits. Three unit cases cover measurement, resize/pan updates and listener cleanup. The Linux smoke suite checks settings at 12 size/zoom combinations from 50–200%, visible Close/Apply controls, a physical Close click at 140%, help/trust bounds and expanded-diagram bounds.

Final validation passed: 37 unit tests, 37 production browser tests with one intentional mobile skip, Svelte/TypeScript checks, lint, x86_64 Linux flake checks and the full native suite against the final package. One earlier native run encountered a WebDriver transport reset; the final isolated run passed. A native settings screenshot at 140% UI zoom was inspected during layout verification. The mobile sweep also caught a fixed-size prompt icon overflowing its narrow content area; icons are now constrained to their panel, and long button labels wrap.

The existing mobile explorer-drag skip remains unchanged. Physical mobile hardware and pinch-zoom pointer interactions are not claimed as verified. The help/trust resize sweep checks geometry and keyboard dismissal; ordinary dialog actions and the settings close button retain separate pointer coverage.

## Performance

A five-sample parse benchmark with Node 24.21.0 and the real Markdown-it/highlighting/math integration measured:

| Input bytes | Median parse time | Five-sample range |
| ----------: | ----------------: | ----------------: |
|     102,000 |             52 ms |          49–79 ms |
|   1,020,000 |            439 ms |        411–505 ms |

The corpus repeats headings, paragraphs, links, code and tables. These are parser measurements on one machine, not startup, DOM layout, memory or diagram benchmarks. Browser tests separately exercise 1,000-file paging and host controls during a roughly 1 MiB parse. Parsing runs in a cancellable worker with a 15-second timeout. Large document DOM layout and expensive diagrams can still consume substantial resources; there is no complete document virtualization or hard diagram CPU sandbox.

At the time of this measurement, the frame runtime was approximately 36 KiB JS plus 1.4 MiB CSS/fonts. Diagram engines are a separate deferred 7.3 MiB bundle. Host JS was approximately 101 kB, CSS 105 kB, and the parsing worker 804 kB. Exact sizes vary with the locked toolchain and subsequent changes. Bundled assets provide offline rendering without CDNs; see [startup performance](startup-performance.md) for the current measurement method.

## Deployment and remaining limits

GitHub Pages-compatible output is production-browser tested. Repository-subpath hosting has also been checked, including workers, local renderer assets/fonts, Markdown navigation and Graphviz WASM. No Pages deployment, release publication or repository-visibility change is performed by these checks. Browser access is limited to selected files or granted folders; snapshot imports cannot observe subsequent filesystem changes.

The aarch64 Linux package and NixOS module have been evaluated; aarch64 execution has not been verified. Physical touch hardware, native picker interaction, full desktop MIME registration, Wayland shell integration, other WebKit versions and long-duration filesystem stress remain outside the automated coverage. Android and other native platforms are outside this release. PlantUML, local script/style dependency trees and Linux HTML event attributes retain their [documented limitations](rendering.md).

The last recorded dependency audit found zero production advisories and two low-severity development-tool advisories through `deepmerge` in the Svelte Vite plugin, with no offered upstream fix. Audit again before publishing; this is not a claim that future dependency advisories are covered.

## Review regressions

The post-review fixes add coverage for Mermaid node and edge text under SVG-only sanitization, including attempts to enable HTML labels through document directives; prose/code search without changing SVG or KaTeX markup; one-time heading navigation across tab changes and preview rebuilds; collision-free reference targets alongside headings and raw HTML IDs; and representative syntax-token contrast of at least 4.5:1 in both document themes. Browser scenarios run in desktop and mobile profiles.

Unit cases reject oversized browser files before reading, retain byte and UTF-8 validation after reads, reject obsolete source-selection results and errors, and verify normalized tab identity and heading-command consumption. The Linux smoke test additionally starts from a path containing `..`, follows a self-link without opening a duplicate tab, and checks SVG search preservation, Mermaid labels, reference IDs and syntax colors in WebKit.

Validation of these fixes passed on 29 October 2026: 43 unit tests, 47 production browser tests with the existing mobile explorer-drag skip, Svelte/TypeScript checks, ESLint/Prettier, all x86_64 Linux flake checks (including three Rust tests), and the complete expanded native WebKit smoke suite against the rebuilt Nix package. The browser suite used two workers. No GitHub Pages deployment or aarch64 execution was performed.

## PDF and Typst additions

The production browser suite passes 55 scenarios with the existing mobile explorer-drag skip. New scenarios run in both desktop and mobile profiles and cover PDF text/canvases, page navigation, internal destinations, relative Markdown/PDF links, search, themes, independent zoom, fit width followed by a measured page-size increase on zoom-in, password retries, ignored PDF JavaScript, opaque-origin isolation, malformed PDFs, and the browser's explicit Typst limitation. A 200-page fixture keeps host controls usable and retains at most 12 canvases before and after jumping to page 200. This checks rendering prioritization and cache behavior, not a universal PDF load-time or memory bound. PDF asset requests are local; the offline scenario rejects external requests.

All 46 unit cases pass. New source cases distinguish binary PDFs from UTF-8 Markdown, enforce PDF limits before and after browser reads, and check binary tab refresh/error retention. Svelte/TypeScript validation reports no errors or warnings, and ESLint/Prettier pass. A real sandboxed Typst compilation test verifies imported-file stamps, no source-side output, missing imports/packages, rejection of a symlink to a private sibling directory, and Typst's infinite-loop diagnostic. A separate timeout test kills and reaps a non-terminating child process. These compiler integration tests require user namespaces and run explicitly outside the Nix build sandbox.

The packaged Linux WebKit suite passes with PDF canvas/text rendering, page navigation, fit width at 50%, 140%, and 200% UI scale, host-token isolation, sandboxed Typst compilation, syntax-error retention, correction, and imported-file live refresh, in addition to the existing Markdown checks. The PDF bundle is approximately 5 MiB JavaScript plus 176 KiB CSS/icons, loaded only for PDF/Typst previews. Its fonts, CMaps, image decoders, and upstream notices ship with the static artifact.

The static build supports PDFs; Typst compilation remains Linux-only. No GitHub Pages deployment, physical mobile run, or aarch64 execution was performed for these additions. Browser tests exercise fixture PDFs and cannot establish compatibility with every PDF feature or font. System font discovery and package downloads are disabled for Typst; see [document support](documents.md) for the root, cached-package, font, and resource restrictions.

All x86_64 Linux flake checks pass, including the static build, packaging, frontend quality checks, and native package. The native flake check passes six Rust tests; the namespace-dependent compiler integration test is deliberately skipped inside the Nix build sandbox. Running all seven Rust tests explicitly in the development shell, including that integration case, passes. The final production dependency audit reports zero advisories.

## Papyri branding

The selected mark is Papyri study 14, the papyrus reed inside a rounded page. Branding checks cover the application and window titles, the SVG favicon and inherited CSS-mask color, the empty-state mark, and regenerated neutral launcher PNGs. Release checks require matching npm/Cargo package names, Tauri product/window names, and desktop-entry name, executable, icon, and window class. The native suite asserts the Papyri window title.

The executable, desktop entry, flake package, NixOS option, repository, application identifier, preference key, and internal renderer protocols use the Papyri name. No compatibility aliases are provided. The new application identity starts with fresh preferences. Earlier icon validation above records the original bracketed-M design.

Final rename validation on 29 October 2026 passed all 46 unit tests, all seven Rust tests, Svelte/TypeScript checks, ESLint/Prettier, icon and release checks, x86_64 Linux flake checks, and the complete packaged WebKit smoke suite. The production browser rerun passed 55 tests with the existing mobile explorer-drag skip. The first browser run timed out waiting for a large mobile document to become visible while the clean Rust build ran concurrently; the full rerun after compilation passed. Production dependency auditing reported zero advisories. NixOS evaluation confirms that `programs.papyri.enable` installs Papyri and that the package attributes are `default`, `papyri`, and `web`. The aarch64 package was evaluated, without building or executing it.

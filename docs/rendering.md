# Rendering support

Markdown, PDF, Typst, and LaTeX documents open as viewer tabs. PDF.js renders PDF pages in both desktop and web modes; the desktop apps compile Typst and LaTeX to PDF. See [document support](documents.md) for page controls, live compilation, offline assets, project-root restrictions, and fixed-layout behavior. The sections below describe Markdown rendering.

Markdown-it supplies CommonMark-style parsing with its enabled GFM features (tables, strikethrough, autolinking), plus established plugins for task lists and footnotes. Raw HTML is sanitized by DOMPurify before insertion into the isolated document frame. Highlight.js bundles its common language set with a theme-aware Catppuccin palette; unknown languages and code blocks above 100,000 characters remain plain code. The app intentionally does not implement its own Markdown, math, diagram or chart language.

| Fence             | Renderer                                | Offline behavior                                                                                                             |
| ----------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `mermaid`         | Mermaid 12, strict mode                 | Flowcharts, sequence, class, state, ER, Gantt, pie, journey, mindmap, timeline and the diagrams supported by bundled Mermaid |
| `dot`, `graphviz` | Graphviz via `@viz-js/viz` WASM         | DOT to SVG; Graphviz layouts supported by bundled Viz                                                                        |
| `vega`            | Vega 6                                  | JSON specifications; SVG output and interactions                                                                             |
| `vega-lite`       | Vega-Lite 6 and Vega                    | JSON grammar compiled locally to Vega                                                                                        |
| `plantuml`        | Evaluated, not rendered in this release | Source remains visible; a clear message explains the missing local Java renderer                                             |

Diagram blocks have an explicit **Render** button and collapsible source. Mermaid uses SVG-native labels so text survives SVG sanitization; HTML labels are disabled, including in document configuration directives. Mermaid uses Catppuccin theme variables, Graphviz uses default graph/node/edge attributes, and Vega/Vega-Lite use a Catppuccin configuration. Explicit document colors and renderer theme settings take precedence over these defaults. Wide diagrams retain their vector dimensions and scroll within the document. **Expand diagram** moves the live diagram into a centered panel sized to its artwork and bounded by the viewport, over a dark blurred backdrop. Large diagrams initially fit the screen; floating controls show the current zoom, adjust it from 1% to 400%, reset it, or fit it again. Drag to pan, use Ctrl/⌘-scroll to zoom around the pointer, or use +, − and 0 while the panel has focus. For interactive Vega charts, use Shift-drag to pan. Oversized diagrams scroll in both directions. **Close diagram** or Escape restores the same diagram and focus. Expansion also works in split view. One malformed diagram does not hide the rest of the document. Layout is capped at 50,000 source characters; Mermaid additionally limits edges to 500. Diagram libraries are bundled locally but execute only when a Render button is pressed; ordinary documents do not load them. Diagrams are not sent to a server. Changing the document theme preserves existing diagrams and their readable original palette; use **Update diagram theme** to redraw a rendered diagram when needed. Graphviz layout and Mermaid rendering are synchronous within that frame and are not a hard CPU/memory sandbox. A graph below the input limit can still be expensive. Close its tab if it stalls. Vega specifications can reference network data only when network resources are enabled. Vega expressions use the maintained expression interpreter to avoid granting JavaScript `eval` to charts.

Expanded diagrams can be downloaded as SVG or PNG, or copied as PNG when the environment supports image clipboard access. Exports are limited to 16 MiB; PNG exports also have a 16-megapixel limit. External image references cannot be exported. Export is disabled for script-enabled previews.

PlantUML's full syntax relies on its Java distribution and sometimes Graphviz. A browser-only local renderer would have different coverage or require a large JVM/WASM dependency. We chose not to mislabel Mermaid or a subset implementation as PlantUML, and not to send private diagrams to a server. D2, TikZ, Kroki, executable notebooks, MDX, VS Code extension APIs, frontmatter processing, emoji shortcodes, and arbitrary fence renderers are not supported. Raw frontmatter is ordinary Markdown. GitHub-specific callout syntax is not specially styled.

## Mathematics

KaTeX renders locally, with bundled fonts, through the established Markdown-it texmath extension. Settings has one editable row per pair: opening delimiter, closing delimiter, and **Display** or **Inline** mode. All enabled pairs work together; you can configure several display pairs and several inline pairs, up to 20 total.

Defaults are `$$ … $$`, `\[ … \]`, and bare `[ … ]` for display, plus `\( … \)` for inline math. Display blocks support blank lines, matrices and `\tag{7}`. Put the closing delimiter at the end of its line. For example:

```text
[ \begin{bmatrix}Y_a&I\ O&J_R\end{bmatrix} \begin{bmatrix}\mathbf A\\mathbf B\end{bmatrix}

\begin{bmatrix}\kappa^2\mathbf e_0\\mathbf0\end{bmatrix}. \tag{7} ]
```

Bare brackets in Display mode require TeX commands and a standalone block. Closed prose labels, Markdown links, images and citations stay Markdown. Escaped `\[ … \]` or `$$ … $$` are preferable when bracket syntax is ambiguous. Opting into bare brackets in Inline mode gives them precedence over Markdown links and citations; choose that only deliberately.

Use **Add delimiter pair** for custom pairs such as `%% … %%`. Longest opening wins. Duplicate openings, empty pairs, HTML delimiters, newlines and strings longer than 32 characters are rejected with a visible error. Single dollars are opt-in because of currency conflicts. **Apply preferences** updates the preview and persists all pairs. Unchanged preferences from the previous release gain the bare-bracket display default; custom delimiter configurations are preserved.

Unclosed pairs remain literal; invalid TeX stays visible in red. Code fences and inline code are excluded. KaTeX trust is disabled and expansion/size limits are bounded. The viewer does not repair malformed TeX or infer missing matrix row separators. Full LaTeX document classes, packages, arbitrary preambles and MathJax-only extensions are outside KaTeX's coverage.

## Numbered references

Existing Markdown links, autolinks and footnotes remain clickable. Plain `[1]` markers link to matching `[1] Author…` bibliography paragraphs, or numbered items under a **References**, **Bibliography**, **Works cited**, or **Sources** heading. Plain `(7)` markers link to a display equation with `\tag{7}`; decimal tags such as `(3.2)` also work. These references scroll within the document, including while scripts are enabled. Code and existing link labels are left alone. Generated reference targets avoid collisions with heading slugs and authored HTML IDs. Numbers without matching targets remain ordinary text; no URLs or missing bibliography entries are invented.

## HTML and assets

Hover or keyboard-focus an external HTTP(S) link in Markdown or PDF to see its destination at the bottom right and a preview card after a short delay. Email links show their destination without a network request. With external content disabled, no preview request is made. When enabled, direct image links load an image; other links open in a script-disabled, non-interactive sandboxed frame. Some websites block embedding or require scripts and cannot display a useful preview. Links containing credentials are never loaded in a preview. Touch users can open links normally.

Safe mode preserves common semantic HTML, tables, disclosures, SVG and math, while removing scripts, event handlers, inline stylesheets, frames, forms, and embedded objects. KaTeX inline layout styles remain. CSS and inline/module script elements can run after explicitly trusting a document. On Linux, Tauri’s inherited nonce policy blocks HTML event attributes such as `onclick`; attach handlers using `addEventListener` from a trusted script instead. Place scripts in standalone raw HTML blocks separated by blank lines, following Markdown-it HTML block rules; inline script bodies mixed into a Markdown paragraph can be escaped by the Markdown parser. Scripts are activated in document order; external script execution is subject to browser loading semantics, CORS, CSP and network preferences. Relative local scripts, stylesheets, fonts, video and audio are not loaded from the filesystem in this release. Absolute HTTPS references can work with network permission. Local CSS/JS dependency packaging is a future feature, not implied support for arbitrary HTML applications.

Local images support PNG, JPEG, GIF, WebP, AVIF, and SVG, with a 16 MiB per-image limit, 100 local image references and a 32 MiB total local-image budget per preview. Paths are resolved from the document. Missing images show explanatory alternate text. SVG is embedded as an image, never as privileged application markup. Images have native lazy loading, but local bytes are loaded before frame creation. There is no general-purpose file browser or arbitrary asset opener. HTML `srcset` is removed so resolution cannot bypass the image policy. Remote images and explicitly referenced remote styles/data obey the frame's resource policy, with the trusted-script caveat described in security documentation.

Direct `data:image/*` sources, including SVG, are rendered without a host filesystem read. Click an image or its **Expand image** button to open the local viewer. Inline SVG in Markdown or raw HTML gets the same treatment. The viewer fits the media to the viewport, supports zoom from 1% to 400%, fit/reset, drag-to-pan and Ctrl/⌘-scroll, and keeps focus restoration and Escape handling consistent with expanded diagrams. Transparent PNG, GIF, WebP, AVIF and SVG content is shown over an adaptive checkerboard so alpha is visible. Images inside links keep their link behavior; use the **Expand image** button to open those without following the link. Assets skipped by the image policy are not viewable.

## Reading layout

Document zoom changes the root font size, allowing text and math to reflow at full rendering quality. Equations that cannot wrap, including wide inline matrices, scroll inside their own area rather than widening the page. SVG diagrams remain vectors and scale with that font size. UI magnification is separate; the frame cancels inherited UI scaling so document font size and rendering coordinates stay independent. **Fit document to width** (Ctrl =) removes the reading-column limit and preserves the selected font size. In this mode, code lines wrap visually without changing their copied text; normal reading mode keeps horizontal code scrolling. Ctrl + / − / 0 changes or resets the document font size. On keyboards where + shares the = key, use Ctrl Shift = to zoom in.

## Appearance and fonts

Settings is divided into Appearance, Reading, Documents, and Compilers tabs. Appearance controls the interface zoom, interface font, and command-palette size. Palette width and height are percentages of the available window, with separate pixel limits for large displays. Reading controls Markdown zoom plus independent text, code, and math font stacks. Documents groups network access and math delimiters. Compilers holds the Typst and LaTeX executable settings.

Fonts are stored as CSS `font-family` lists in the local profile. Any installed family can be typed, and the preset lists are suggestions rather than a fixed catalog. Papyri never downloads fonts: unavailable names fall through to the next family in the list. The text font applies to prose and headings, the code font to inline and fenced code, and the math font overrides KaTeX's bundled faces while keeping its layout. Leaving the math font empty retains the KaTeX defaults. Specialized KaTeX size fonts still draw large delimiters and operators, so unusual symbols can fall back to their bundled glyphs. The PDF toolbar follows the interface font; PDF page content keeps the fonts embedded in the document.

Each preview measures its own available viewport and refreshes that measurement when the pane resizes. Reading width, responsive padding and diagram dialog dimensions use those measurements, including at non-default UI zoom. Explorer, outline and split-pane changes therefore update the document without estimating panel widths.

Search highlights prose and code without inserting markup into SVG or mathematics; diagram labels and mathematical notation are excluded from text matching.

Theme and layout changes do not reparse Markdown. The frame begins with its selected background and remains concealed until the renderer reports readiness, so blank frame navigation cannot flash a white surface.

Renderer configuration references: [Mermaid theming](https://mermaid.js.org/config/theming.html), [Viz default attributes](https://viz-js.com/api/), and [Vega configuration precedence](https://vega.github.io/vega/docs/config/).

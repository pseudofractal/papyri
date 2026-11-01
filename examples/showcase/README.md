# Papyri feature showcase

Open this folder in Papyri, then select this file. You can also open it directly with `papyri examples/showcase/README.md`. The Linux app supports every document in this folder; the static web app can import the folder and preview Markdown and PDF, while Typst and LaTeX compilation require the Linux app.

## Start here

- [Markdown and math](./markdown.md): formatting, citations, equations, images, links, and HTML.
- [Diagrams and charts](./diagrams.md): Mermaid, Graphviz, Vega, Vega-Lite, and the PlantUML limitation.
- [Typst document](./paper.typ): pages, math, an image, a bibliography, and an imported section.
- [LaTeX document](./paper.tex): pages, math, cross-references, an imported section, and a BibTeX bibliography.
- [PDF document](./sample.pdf): a two-page PDF with text, outline, and links.
- [Password-protected PDF](./password-protected.pdf): unlock with `papyri-test-password`.
- [PDF with disabled JavaScript](./scripts-disabled.pdf): opens normally without running its embedded script.
- [Second Markdown page](./linked.md): a link target for the sample PDF.
- [Intentional compiler errors](./errors.md): instructions for testing diagnostics and recovery.

## Interactive checklist

1. Use the file explorer, the table of contents, and links between files. Open two files and try split view and next/previous tab shortcuts.
2. Search for `PAPYRI-NEEDLE` in the Markdown, then try searching for text in the PDF. In the PDF, use the page controls, outline, text selection, internal and external links.
3. Try document zoom, interface zoom, fit-to-width, light/dark theme, and resizing the explorer. Confirm text reflows in Markdown while PDF pages retain their layout.
4. Render each diagram, expand it, close it with Escape, and update its diagram theme after changing the app theme.
5. Edit and save the imported sections in `parts/`; the open Typst or LaTeX preview should refresh. Restore the files when finished. Changes to files imported through the browser file picker are snapshots; use the Linux app or a granted live browser folder for refresh testing.
6. Open Settings to try math delimiter changes and the Typst/LaTeX executable paths. The examples use the default delimiters and standard packages. For LaTeX, choose an installed LuaLaTeX, pdfLaTeX, or XeLaTeX; BibTeX is needed for the bibliography.
7. Follow [error tests](./errors.md) to check malformed documents and recovery. The static web build reports that Typst and LaTeX compilation require the Linux app.

To test external-content permission, add a remote HTTPS image to a temporary copy of the Markdown document and toggle **Allow network resources** in Settings. The included examples do not require a network connection.

Hover the external link in [Markdown and math](./markdown.md), or an external link in [the PDF](./sample.pdf), to see its destination and preview card. Enable network resources to request a preview; some sites block embedding.

The app remains read-only: editing these files requires an external editor. The compiler sandboxes and browser-mode limitations are described in [document support](../../docs/documents.md).

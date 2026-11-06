import { importedSource } from './sources';
const welcome = `# Papyri

**Papyri** is a Markdown, PDF, Typst, and LaTeX viewer with source editing. Open a file or folder to get started.

> Core rendering works locally. No telemetry.

## Supported content

| Content | Ready to read |
| :-- | :-- |
| GitHub Markdown | Tables, tasks, footnotes, strikethrough |
| Mathematics | KaTeX, configurable delimiters |
| Diagrams | Mermaid, Graphviz, Vega & Vega-Lite |
| Code | Offline syntax highlighting |
| PDF documents | Text selection, search, links, page navigation |
| Typst documents | Local compilation in the Linux app |
| LaTeX documents | Local compilation with an installed engine in the Linux app |

### Mathematics

The Gaussian integral, rendered locally:

$$\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}$$

## Diagrams

Diagrams render when you ask, keeping even a long document responsive.

\`\`\`mermaid
flowchart LR
  A[Open a folder] --> B[Choose a file]
  B --> C[Render Markdown]
  C --> D[Read document]
\`\`\`

## Code with context

\`\`\`typescript
interface ReadingSession {
  document: string;
  readOnly: true;
}
const session: ReadingSession = {
  document: 'welcome.md',
  readOnly: true,
};
\`\`\`

## Features

- [x] Private by default
- [x] Light and dark Catppuccin palettes
- [x] Keyboard and touch navigation
- [ ] Open a folder

Read the [format gallery](./gallery.md), or open Settings to choose math delimiters.

Example footnote.[^local]

[^local]: Core rendering works offline after installation. The hosted web page must first be downloaded.
`;
const gallery = `# Format gallery

[Back to welcome](./welcome.md#diagrams)

## Graphviz

\`\`\`dot
digraph { rankdir=LR; Markdown -> Preview; Preview -> Display; }
\`\`\`

## Vega-Lite

\`\`\`vega-lite
{"$schema":"https://vega.github.io/schema/vega-lite/v6.json","data":{"values":[{"day":"Mon","pages":12},{"day":"Tue","pages":24},{"day":"Wed","pages":18}]},"mark":"bar","encoding":{"x":{"field":"day","type":"ordinal"},"y":{"field":"pages","type":"quantitative"}}}
\`\`\`

## HTML

<details><summary>Native HTML disclosure</summary><p>Sanitized HTML is supported without enabling scripts.</p></details>

## PlantUML

\`\`\`plantuml
@startuml
Reader -> Papyri: Open document
@enduml
\`\`\`
`;
export const demoSource = () =>
  importedSource([new File([welcome], 'welcome.md'), new File([gallery], 'gallery.md')]);

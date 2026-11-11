# LaTeX completion data

These JSON files are copied from the MIT-licensed
[LaTeX-Workshop](https://github.com/James-Yu/LaTeX-Workshop) project so Papyri
can offer LaTeX command, environment, package and math-symbol completion
without requiring a language server.

- Upstream revision: `2f5a60a11a99f33013c1235f0499546cc831cfcb`
- Source: <https://github.com/James-Yu/LaTeX-Workshop/tree/master/data>
- License: MIT (see `LICENSE`)

`package-commands.json` is generated from the same upstream package data
(`data/packages/*.json`), with package-command data from texlab's MIT-licensed
`completion.json.gz` added for packages that LaTeX-Workshop does not cover.
texlab is available at <https://github.com/latex-lsp/texlab> and is MIT-licensed.
`bibliography-styles.json` lists common BibTeX style names from TeX Live 2025
and widely used journal styles; style names themselves are not copyrightable.

Commands, environments, packages and math symbols are data, not executable
code. Keep this attribution and license with the data when redistributing it.

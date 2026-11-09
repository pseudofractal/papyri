# Language server completion samples

These files contain the original JSON completion responses from the supported language servers, captured with the same completion capabilities advertised by Papyri. The sample workspace is generated locally: its headings, file names, citation titles and authors are test data, while the items and their fields are returned by the servers. Temporary workspace paths are replaced by `/sample-workspace`. Texlab citation responses include the result of resolving each item. Reproduce the samples with `python3 scripts/collect-lsp-completions.py` using the desired server versions on `PATH`.

The captures use Tinymist 0.15.10, Texlab 5.26.0 and Marksman 2026-02-08. They are observations of these versions and contexts, not an exhaustive description of the protocol. Servers and installed packages may produce different items and fields.

## Observed clusters

- **Tinymist:** The sample contains 526 distinct function-kind label/detail pairs, 418 property-kind pairs, 97 variable-kind pairs and 50 class-kind pairs. Global functions commonly have a detail shaped like `(inputs) => output`; the inputs can be positional or named, and their type expressions can contain nested punctuation. Parameter completions commonly put Markdown documentation in `detail` and a type in `labelDetails.description`. Other items use `detail` for plain values, types or descriptions. Some symbol properties pair a glyph with a Unicode escape; named colors can contain an RGB hex value. A signature, symbol or color preview is structured only when its expected format is recognized; everything else is retained as supplied.
- **Texlab:** The sample contains 50 file suggestions, 50 citations and 50 references. File suggestions have no details. Citation suggestions have a `data` field and acquire Markdown documentation through `completionItem/resolve`. Reference suggestions contain plain text in `detail`. These are generated workspace examples, and the server capped each response at 50. The tested `\sec` context returned no completions in this installation.
- **Marksman:** The sample contains 50 heading-link suggestions without detail or documentation. The tested file and wiki-link contexts returned no items in this workspace.

The 50-example target is met for these observed major groups, not for every protocol kind: the Tinymist corpus also has 36 snippet, 16 module and 4 file label/detail pairs. Additional contexts, packages and server versions should be sampled before assuming those smaller groups have one uniform format.

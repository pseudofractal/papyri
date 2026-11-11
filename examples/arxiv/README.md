# arXiv bibliography corpus

This example contains **200 real arXiv BibTeX records** exported from
`https://arxiv.org/bibtex/<id>` on 2026-11-11.

The categories were sampled with a fixed seed (`20261111`) from a broad,
cross-domain pool. The 200 records span these categories:

- `astro-ph.CO`
- `cs.AI`
- `cs.CL`
- `cs.CR`
- `cs.HC`
- `cs.IR`
- `cs.RO`
- `cs.SE`
- `cs.SY`
- `eess.AS`
- `eess.IV`
- `gr-qc`
- `hep-th`
- `math.DG`
- `nucl-th`
- `physics.flu-dyn`
- `physics.optics`
- `q-bio.NC`
- `stat.ME`
- `stat.TH`

The individual records live in `tests/fixtures/arxiv-bib/` and are parsed by
`tests/bibliography-arxiv.test.ts`. `arxiv-200.bib` is the same corpus
concatenated into one file so it can be opened directly in Papyri.

Note: arXiv's `@misc` exports are detected as **Preprint** records, and their
`primaryClass` is exposed as a keyword. They usually have no `journal` field,
so the timeline's venue count is expected to be zero for this corpus.

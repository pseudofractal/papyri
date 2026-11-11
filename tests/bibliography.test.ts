import { describe, expect, it } from 'vitest';
import {
  bibtexKey,
  bibliographyStats,
  bibliographyTitle,
  detectBibliographyFormat,
  ensureUniqueBibtexKey,
  formatBibtexEntry,
  formatCitation,
  latexToText,
  normalizeBibtexMonthAliases,
  parseAuthors,
  parseBibliography,
  toBibtex,
  uniqueCitationKey,
} from '../src/lib/bibliography';

const bibtex = String.raw`
@string{jasa = "Journal of the Acoustical Society of America"}

@article{example2024,
  author = {Example, Ada and M{\"u}ller, Bea},
  title = {A {Spatial} Study of Rooms},
  journal = jasa,
  year = {2024},
  volume = {155},
  number = {2},
  pages = {100--112},
  doi = {10.1234/example.2024},
  keywords = {room acoustics, spatial audio},
  abstract = {We study rooms.}
}

@inproceedings{second2023,
  author = {Second, Bea and others},
  title = {Reverberation and Perception},
  booktitle = {Proceedings of the International Conference on Acoustics},
  year = {2023},
  pages = {1--6}
}

@book{parent2020,
  editor = {Editor, Eve},
  title = {Handbook of Acoustics},
  publisher = {Acoustic Press},
  year = {2020},
  address = {Berlin}
}

@incollection{chapter2022,
  author = {Chapter, Cleo},
  title = {A Chapter},
  crossref = {parent2020},
  year = {2022},
  pages = {10--20}
}
`;

const ris = `TY  - JOUR
AU  - Example, Ada
AU  - Müller, Bea
TI  - A Spatial Study of Rooms
JO  - Journal of the Acoustical Society of America
PY  - 2024
VL  - 155
IS  - 2
SP  - 100
EP  - 112
DO  - 10.1234/example.2024
KW  - room acoustics
KW  - spatial audio
AB  - We study rooms.
ER  -`;

const csl = JSON.stringify([
  {
    id: 'example2024',
    type: 'article-journal',
    title: 'A Spatial Study of Rooms',
    author: [
      { family: 'Example', given: 'Ada' },
      { family: 'Müller', given: 'Bea' },
    ],
    issued: { 'date-parts': [[2024]] },
    'container-title': 'Journal of the Acoustical Society of America',
    volume: '155',
    issue: '2',
    page: '100-112',
    DOI: '10.1234/example.2024',
    keyword: ['room acoustics', 'spatial audio'],
  },
]);

const nbib = `PMID- 12345678
TI  - A Spatial Study of Rooms
AU  - Example A
AU  - Müller B
JT  - Journal of the Acoustical Society of America
DP  - 2024
VI  - 155
IP  - 2
PG  - 100-112
LID - 10.1234/example.2024 [doi]
OT  - room acoustics
AB  - We study rooms.
PT  - Journal Article
`;

const endnote = `%0 Journal Article
%A Example, Ada
%A Müller, Bea
%T A Spatial Study of Rooms
%J Journal of the Acoustical Society of America
%D 2024
%V 155
%N 2
%P 100-112
%R 10.1234/example.2024
%K room acoustics
%X We study rooms.
`;

describe('bibliography parsing', () => {
  it('converts TeX accents and formatting to readable text', () => {
    expect(latexToText('M{\\"u}ller and \\emph{Rooms}')).toBe('Müller and Rooms');
    expect(latexToText('50\\% of $x^2$')).toBe('50% of x^2');
  });

  it('parses BibTeX macros, names, crossrefs, and metadata', () => {
    const document = parseBibliography(bibtex, '/library.bib');
    expect(document.format).toBe('bibtex');
    expect(document.entries).toHaveLength(4);
    const [example, second, parent, chapter] = document.entries;
    expect(example.authors).toEqual(['Ada Example', 'Bea Müller']);
    expect(example.container).toBe('Journal of the Acoustical Society of America');
    expect(example.year).toBe(2024);
    expect(example.keywords).toEqual(['room acoustics', 'spatial audio']);
    expect(example.doi).toBe('10.1234/example.2024');
    expect(second.authors).toEqual(['Bea Second']);
    expect(parent.authors).toEqual([]);
    expect(parent.editors).toEqual(['Eve Editor']);
    expect(chapter.publisher).toBe('Acoustic Press');
    expect(chapter.place).toBe('Berlin');
  });

  it('parses RIS, CSL JSON, NBIB, and EndNote records', () => {
    expect(parseBibliography(ris, '/library.ris').entries[0]).toMatchObject({
      title: 'A Spatial Study of Rooms',
      authors: ['Ada Example', 'Bea Müller'],
      year: 2024,
      doi: '10.1234/example.2024',
      keywords: ['room acoustics', 'spatial audio'],
    });
    expect(parseBibliography(csl, '/library.json').entries[0]).toMatchObject({
      title: 'A Spatial Study of Rooms',
      authors: ['Ada Example', 'Bea Müller'],
      year: 2024,
      keywords: ['room acoustics', 'spatial audio'],
    });
    expect(parseBibliography(nbib, '/library.nbib').entries[0]).toMatchObject({
      key: '12345678',
      title: 'A Spatial Study of Rooms',
      year: 2024,
      doi: '10.1234/example.2024',
    });
    expect(parseBibliography(endnote, '/library.enw').entries[0]).toMatchObject({
      title: 'A Spatial Study of Rooms',
      authors: ['Ada Example', 'Bea Müller'],
      year: 2024,
      doi: '10.1234/example.2024',
    });
  });

  it('detects bibliography formats', () => {
    expect(detectBibliographyFormat(bibtex, '/a.bib')).toBe('bibtex');
    expect(detectBibliographyFormat(ris, '/a.ris')).toBe('ris');
    expect(detectBibliographyFormat(nbib, '/a.nbib')).toBe('nbib');
    expect(detectBibliographyFormat(endnote, '/a.enw')).toBe('endnote');
    expect(detectBibliographyFormat(csl, '/a.json')).toBe('csl-json');
  });

  it('formats citations and computes used/unused statistics', () => {
    const document = parseBibliography(bibtex, '/library.bib');
    const entry = document.entries[0];
    expect(formatCitation(entry, 'latex')).toBe('\\cite{example2024}');
    expect(formatCitation(entry, 'apa')).toContain('Example, A.');
    expect(formatCitation(entry, 'vancouver')).toContain('2024;155(2):100–112');
    expect(formatCitation(entry, 'nature')).toContain('A Spatial Study of Rooms');
    const stats = bibliographyStats(document.entries, { example2024: 2 });
    expect(stats.total).toBe(4);
    expect(stats.cited).toBe(1);
    expect(stats.uncited).toBe(3);
    expect(stats.missingDoi).toBe(3);
    expect(stats.years).toEqual([2020, 2022, 2023, 2024]);
  });

  it('formats books with publisher information', () => {
    const document = parseBibliography(
      `@book{book2022,
        author = {Ivanov, Ivan},
        title = {Computational Methods for Room Acoustics},
        publisher = {Springer},
        address = {Cham},
        year = {2022}
      }`,
      '/my_refs.bib',
    );
    const entry = document.entries[0];
    expect(formatCitation(entry, 'apa')).toBe(
      'Ivanov, I. (2022). Computational Methods for Room Acoustics. Springer, Cham.',
    );
    expect(formatCitation(entry, 'vancouver')).toBe(
      'Ivanov I. Computational Methods for Room Acoustics. Springer, Cham. 2022.',
    );
    expect(formatCitation(entry, 'nature')).toContain('Springer, Cham (2022).');
    expect(bibliographyTitle('/my_refs.bib')).toBe('My refs');
  });

  it('serializes an entry into parseable BibTeX and fixes colliding keys', () => {
    const source = String.raw`@article{Kucsko_2013,
      title={Nanometre-scale thermometry in a living cell},
      author={Kucsko, G. and Maurer, P. C. and Yao, N. Y.},
      year={2013},
      journal={Nature},
      volume={500},
      number={7460},
      pages={54--58},
      doi={10.1038/nature12373}
    }`;
    const entry = parseBibliography(source, '/doi.bib').entries[0];
    const generated = toBibtex(entry, 'Kucsko2013');
    expect(generated).toContain('@article{Kucsko2013');
    const reparsed = parseBibliography(generated, '/new.bib').entries[0];
    expect(reparsed).toMatchObject({
      key: 'Kucsko2013',
      title: 'Nanometre-scale thermometry in a living cell',
      authors: ['G. Kucsko', 'P. C. Maurer', 'N. Y. Yao'],
      year: 2013,
      container: 'Nature',
      volume: '500',
      issue: '7460',
      doi: '10.1038/nature12373',
    });
    const renamed = ensureUniqueBibtexKey(source, entry, new Set(['Kucsko_2013']));
    expect(bibtexKey(renamed)).not.toBe('Kucsko_2013');
    expect(parseBibliography(renamed, '/renamed.bib').entries[0].title).toBe(entry.title);
    expect(uniqueCitationKey('Kucsko2013', new Set(['Kucsko2013']))).toBe('Kucsko2013a');
    expect(normalizeBibtexMonthAliases('@article{x, month=July, year={2013}}')).toContain(
      'month={July}',
    );
    expect(formatBibtexEntry('@article{x, title={A, B}, year={2024}}')).toBe(
      '@article{x,\n  title = {A, B},\n  year = {2024},\n}',
    );
  });

  it('prefers full PubMed author names over abbreviated AU lines', () => {
    const document = parseBibliography(
      `PMID- 31452104
TI  - Molegro Virtual Docker for Docking.
FAU - Bitencourt-Ferreira, Gabriela
AU  - Bitencourt-Ferreira G
FAU - de Azevedo, Walter Filgueira Jr
AU  - de Azevedo WF Jr
DP  - 2019
PMC - 6800157
PT  - Journal Article
`,
      '/lookup.nbib',
    );
    expect(document.entries[0].authors).toEqual([
      'Gabriela Bitencourt-Ferreira',
      'Walter Filgueira Jr de Azevedo',
    ]);
    expect(document.entries[0].fields.pmid).toBe('31452104');
    expect(document.entries[0].fields.pmc).toBe('6800157');
  });

  it('handles malformed or empty input without throwing', () => {
    expect(parseBibliography('', '/empty.bib').entries).toEqual([]);
    expect(parseBibliography('{not json', '/broken.json').entries).toEqual([]);
    expect(parseAuthors('Last, First and {The Association} and others')).toEqual([
      'First Last',
      'The Association',
    ]);
  });
});

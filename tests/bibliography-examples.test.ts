import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseBibliography } from '../src/lib/bibliography';

async function parseExample(name: string) {
  return parseBibliography(await readFile(`examples/bibliography/${name}`, 'utf8'), name);
}

describe('bibliography examples', () => {
  it('parses the 15-entry BibTeX library', async () => {
    const document = await parseExample('library.bib');
    expect(document.format).toBe('bibtex');
    expect(document.entries).toHaveLength(15);
    expect(document.entries.every((entry) => entry.title)).toBe(true);
    expect(document.entries.map((entry) => entry.key)).toContain('gauss2026');
    expect(document.entries.find((entry) => entry.key === 'gauss2026')?.authors).toEqual([
      'Ada Example',
      'Bea Müller',
      'Chen Zhao',
    ]);
  });

  it('parses the alternate bibliography formats', async () => {
    const ris = await parseExample('library.ris');
    const csl = await parseExample('library.csljson');
    const nbib = await parseExample('library.nbib');
    const enw = await parseExample('library.enw');
    expect(ris.format).toBe('ris');
    expect(csl.format).toBe('csl-json');
    expect(nbib.format).toBe('nbib');
    expect(enw.format).toBe('endnote');
    expect(ris.entries.length).toBeGreaterThan(0);
    expect(csl.entries.length).toBeGreaterThan(0);
    expect(nbib.entries.length).toBeGreaterThan(0);
    expect(enw.entries.length).toBeGreaterThan(0);
    for (const document of [ris, csl, nbib, enw]) {
      expect(document.entries.every((entry) => entry.title)).toBe(true);
    }
  });
});

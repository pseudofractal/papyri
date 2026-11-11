import { describe, expect, it } from 'vitest';
import { parseBibliography } from '../src/lib/bibliography';

function randomText(seed: number): string {
  let state = seed;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state;
  };
  const alphabet = '@{}()=,"\\\n abcXYZ0123456789#%';
  const length = next() % 400;
  let text = '';
  for (let index = 0; index < length; index++) {
    text += alphabet[next() % alphabet.length];
  }
  return text;
}

describe('broken bibliography input', () => {
  it('returns an empty document instead of a garbage entry for a truncated BibTeX file', () => {
    const document = parseBibliography(
      '@article{broken, title = {An unclosed title, author = {Ada Example}, year = {2024}',
      '/broken.bib',
    );
    expect(document.entries).toEqual([]);
    expect(document.warnings).toContain('No bibliography entries could be parsed.');
  });

  it('recovers later valid entries after an unbalanced entry', () => {
    const document = parseBibliography(
      '@article{broken, title = {Broken\n\n@article{good, title={Good}, author={Ada Example}, year={2024}}',
      '/partial.bib',
    );
    expect(document.entries).toHaveLength(1);
    expect(document.entries[0]).toMatchObject({
      key: 'good',
      title: 'Good',
      authors: ['Ada Example'],
      year: 2024,
    });
  });

  it.each([
    ['empty file', ''],
    ['whitespace', '   \n\t  '],
    ['missing key', '@article{, title={A}, author={B}, year={2024}}'],
    ['plain text', 'not a bibliography at all'],
    ['invalid JSON', '{not json'],
    ['header only', '@article{only,'],
  ])('does not throw and reports no entries for %s', (_name, text) => {
    const document = parseBibliography(text, '/broken.bib');
    expect(document.entries).toEqual([]);
    expect(document.warnings.length).toBeGreaterThan(0);
  });

  it.each([
    ['broken RIS', 'TY  - JOUR\nAU  - Example, Ada\nTI  - Missing terminator'],
    ['broken NBIB', 'PMID- 123\nTI  - Missing fields'],
    ['broken EndNote', '%0 Journal Article\n%T Missing fields'],
  ])('degrades gracefully for %s', (_name, text) => {
    const document = parseBibliography(text, '/broken.bib');
    expect(document.entries.length + document.warnings.length).toBeGreaterThan(0);
    for (const entry of document.entries) {
      expect(entry.warnings.length).toBeGreaterThan(0);
    }
  });

  it('terminates on a very large unbalanced entry', () => {
    const document = parseBibliography(
      `@article{huge, title = {${'x'.repeat(200_000)}`,
      '/huge.bib',
    );
    expect(document.entries).toEqual([]);
    expect(document.warnings).toContain('No bibliography entries could be parsed.');
  });

  it('parses valid entries with unmatched parentheses in a title', () => {
    const document = parseBibliography(
      '@article{paren, title={A title with an unmatched ( parenthesis}, author={Ada Example}, year={2024}}',
      '/paren.bib',
    );
    expect(document.entries).toHaveLength(1);
    expect(document.entries[0].title).toBe('A title with an unmatched ( parenthesis');
    expect(document.entries[0].authors).toEqual(['Ada Example']);
  });

  it('never throws on arbitrary text', () => {
    for (let seed = 1; seed <= 150; seed++) {
      expect(() => parseBibliography(randomText(seed), '/fuzz.bib')).not.toThrow();
    }
  });
});

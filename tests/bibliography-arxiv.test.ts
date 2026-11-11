import { readFile, readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseBibliography } from '../src/lib/bibliography';

const corpusDirectory = new URL('./fixtures/arxiv-bib/', import.meta.url);

async function corpusFiles(): Promise<string[]> {
  const names = await readdir(corpusDirectory);
  return names.filter((name) => name.endsWith('.bib')).sort();
}

describe('arXiv bibliography corpus', () => {
  it('contains at least 200 BibTeX files', async () => {
    expect((await corpusFiles()).length).toBeGreaterThanOrEqual(200);
  });

  it('records 200 unique papers across multiple categories', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('manifest.json', corpusDirectory), 'utf8'),
    ) as { id: string; category: string }[];
    expect(manifest).toHaveLength(200);
    expect(new Set(manifest.map((item) => item.id)).size).toBe(200);
    expect(new Set(manifest.map((item) => item.category)).size).toBeGreaterThanOrEqual(15);
  });

  it('parses every individual arXiv BibTeX file', async () => {
    const failures: string[] = [];
    for (const name of await corpusFiles()) {
      const text = await readFile(new URL(name, corpusDirectory), 'utf8');
      const document = parseBibliography(text, name);
      const entry = document.entries[0];
      if (
        document.format !== 'bibtex' ||
        document.entries.length !== 1 ||
        !entry?.key ||
        !entry.title ||
        !entry.year ||
        !entry.authors.length ||
        entry.type !== 'preprint' ||
        entry.keywords.length === 0
      ) {
        failures.push(
          `${name}: format=${document.format} entries=${document.entries.length} key=${entry?.key ?? '—'} title=${entry?.title ?? '—'} year=${entry?.year ?? '—'} authors=${entry?.authors.length ?? 0} type=${entry?.type ?? '—'} keywords=${entry?.keywords.length ?? 0}`,
        );
      }
    }
    expect(failures).toEqual([]);
  });

  it('aggregates the corpus into one renderable library', async () => {
    const files = await corpusFiles();
    const combined = (
      await Promise.all(files.map((name) => readFile(new URL(name, corpusDirectory), 'utf8')))
    ).join('\n\n');
    const document = parseBibliography(combined, '/arxiv-200.bib');
    expect(document.format).toBe('bibtex');
    expect(document.entries.length).toBe(files.length);
    expect(
      document.entries.every((entry) => entry.title && entry.authors.length && entry.year),
    ).toBe(true);
    expect(new Set(document.entries.map((entry) => entry.id)).size).toBe(document.entries.length);
  });

  it('parses the committed 200-entry example timeline', async () => {
    const text = await readFile(
      new URL('../examples/arxiv/arxiv-200.bib', import.meta.url),
      'utf8',
    );
    const document = parseBibliography(text, 'arxiv-200.bib');
    expect(document.format).toBe('bibtex');
    expect(document.entries).toHaveLength(200);
    expect(
      document.entries.every((entry) => entry.title && entry.authors.length && entry.year),
    ).toBe(true);
  });
});

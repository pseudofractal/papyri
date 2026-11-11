import {
  formatBibtexEntry,
  normalizeBibtexMonthAliases,
  parseBibliography,
  toBibtex,
  type BibliographyEntry,
} from './bibliography';
import { invokeHost } from './native';

interface FetchedBibliography {
  kind: string;
  identifier: string;
  format: string;
  text: string;
  source: string;
}

export interface LookupResult {
  kind: string;
  identifier: string;
  entry: BibliographyEntry;
  bibtex: string;
}

/** Fetch full citation metadata for a DOI, arXiv ID, or PubMed ID. */
export async function lookupReference(identifier: string): Promise<LookupResult> {
  const value = identifier.trim();
  if (!value) throw new Error('Enter a DOI, arXiv ID, or PubMed ID.');
  const record = await invokeHost<FetchedBibliography>('fetch_bibliography_record', {
    identifier: value,
  });
  const parsed = parseBibliography(
    record.text,
    record.format === 'bibtex' ? 'lookup.bib' : 'lookup.nbib',
  );
  const entry = parsed.entries[0];
  if (!entry) {
    throw new Error(
      parsed.warnings.join(' ') || 'The lookup returned no usable citation metadata.',
    );
  }
  if (!entry.title || !entry.authors.length) {
    throw new Error('The lookup returned a record without a title or authors.');
  }
  const bibtex =
    record.format === 'bibtex' && entry.raw.trim().startsWith('@')
      ? formatBibtexEntry(normalizeBibtexMonthAliases(entry.raw.trim()))
      : toBibtex(entry).trim();
  return {
    kind: record.kind,
    identifier: record.identifier || value,
    entry,
    bibtex,
  };
}

import { basename } from './paths';

export type BibliographyFormat = 'bibtex' | 'ris' | 'nbib' | 'endnote' | 'csl-json';

export interface BibliographyEntry {
  id: string;
  key: string;
  type: string;
  typeLabel: string;
  title: string;
  authors: string[];
  editors: string[];
  year: number | null;
  date: string;
  container: string;
  volume: string;
  issue: string;
  pages: string;
  publisher: string;
  place: string;
  doi: string;
  url: string;
  isbn: string;
  issn: string;
  abstract: string;
  keywords: string[];
  note: string;
  language: string;
  raw: string;
  fields: Record<string, string>;
  format: BibliographyFormat;
  warnings: string[];
}

export interface BibliographyDocument {
  format: BibliographyFormat;
  formatLabel: string;
  entries: BibliographyEntry[];
  warnings: string[];
}

export type CitationStyle = 'apa' | 'nature' | 'vancouver' | 'chicago' | 'bibtex' | 'latex';

const formatLabels: Record<BibliographyFormat, string> = {
  bibtex: 'BibTeX / BibLaTeX',
  ris: 'RIS',
  nbib: 'PubMed NBIB',
  endnote: 'EndNote',
  'csl-json': 'CSL JSON',
};

const typeLabels: Record<string, string> = {
  article: 'Journal article',
  journal: 'Journal article',
  inproceedings: 'Conference paper',
  conference: 'Conference paper',
  proceedings: 'Proceedings',
  book: 'Book',
  booklet: 'Booklet',
  incollection: 'Book chapter',
  inbook: 'Book chapter',
  collection: 'Collection',
  phdthesis: 'PhD thesis',
  mastersthesis: 'Master’s thesis',
  thesis: 'Thesis',
  techreport: 'Technical report',
  report: 'Report',
  manual: 'Manual',
  misc: 'Miscellaneous',
  preprint: 'Preprint',
  online: 'Online',
  webpage: 'Web page',
  software: 'Software',
  dataset: 'Dataset',
  unpublished: 'Unpublished',
  patent: 'Patent',
  electronic: 'Electronic resource',
  www: 'Web page',
  'article-journal': 'Journal article',
  'paper-conference': 'Conference paper',
  chapter: 'Book chapter',
};

const monthMacros: Record<string, string> = {
  jan: 'January',
  feb: 'February',
  mar: 'March',
  apr: 'April',
  may: 'May',
  jun: 'June',
  jul: 'July',
  aug: 'August',
  sep: 'September',
  oct: 'October',
  nov: 'November',
  dec: 'December',
};

const filterWords = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'by',
  'for',
  'from',
  'in',
  'into',
  'of',
  'on',
  'or',
  'the',
  'to',
  'via',
  'with',
]);

const accentCharacters: Record<string, string> = {
  '"': '\u0308',
  "'": '\u0301',
  '`': '\u0300',
  '^': '\u0302',
  '~': '\u0303',
  '=': '\u0304',
  '.': '\u0307',
  u: '\u0306',
  v: '\u030c',
  H: '\u030b',
  c: '\u0327',
  k: '\u0328',
  r: '\u030a',
};

const macroReplacements: Record<string, string> = {
  LaTeX: 'LaTeX',
  LaTeXe: 'LaTeX2e',
  TeX: 'TeX',
  BibTeX: 'BibTeX',
  XeLaTeX: 'XeLaTeX',
  LuaLaTeX: 'LuaLaTeX',
  ae: 'æ',
  AE: 'Æ',
  oe: 'œ',
  OE: 'Œ',
  aa: 'å',
  AA: 'Å',
  o: 'ø',
  O: 'Ø',
  ss: 'ß',
  l: 'ł',
  L: 'Ł',
  i: 'ı',
  j: 'ȷ',
  textendash: '–',
  textemdash: '—',
  textquoteleft: '‘',
  textquoteright: '’',
  textquotedblleft: '“',
  textquotedblright: '”',
  textbackslash: '\\',
  textasciitilde: '~',
  textasciicircum: '^',
  S: '§',
  P: '¶',
  copyright: '©',
  textcopyright: '©',
  textregistered: '®',
  dag: '†',
  ddag: '‡',
  pounds: '£',
  euro: '€',
};

const greek: Record<string, string> = {
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ε',
  zeta: 'ζ',
  eta: 'η',
  theta: 'θ',
  iota: 'ι',
  kappa: 'κ',
  lambda: 'λ',
  mu: 'μ',
  nu: 'ν',
  xi: 'ξ',
  pi: 'π',
  rho: 'ρ',
  sigma: 'σ',
  tau: 'τ',
  upsilon: 'υ',
  phi: 'φ',
  chi: 'χ',
  psi: 'ψ',
  omega: 'ω',
  Gamma: 'Γ',
  Delta: 'Δ',
  Theta: 'Θ',
  Lambda: 'Λ',
  Xi: 'Ξ',
  Pi: 'Π',
  Sigma: 'Σ',
  Upsilon: 'Υ',
  Phi: 'Φ',
  Psi: 'Ψ',
  Omega: 'Ω',
};

function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function stripOuterBraces(value: string): string {
  let text = value.trim();
  while (text.startsWith('{') && text.endsWith('}')) {
    let depth = 0;
    let balanced = true;
    for (let index = 0; index < text.length; index++) {
      if (text[index] === '{') depth++;
      else if (text[index] === '}') {
        depth--;
        if (depth === 0 && index !== text.length - 1) {
          balanced = false;
          break;
        }
      }
    }
    if (!balanced || depth !== 0) break;
    text = text.slice(1, -1).trim();
  }
  return text;
}

/** Convert common TeX markup to readable Unicode text. */
export function latexToText(value: string): string {
  if (!value) return '';
  let text = value.replace(/~+/g, ' ');
  // Protect escaped special characters before generic command stripping.
  text = text.replace(/\\([&%$#_{}])/g, '\u0000$1');
  text = text.replace(/\\([A-Za-z]+)\s*/g, (whole, name: string) => {
    if (Object.hasOwn(greek, name)) return greek[name];
    if (Object.hasOwn(macroReplacements, name)) return macroReplacements[name];
    return whole;
  });
  for (let pass = 0; pass < 3; pass++) {
    const next = text.replace(
      /\\(?:emph|textit|textbf|texttt|textrm|textsf|textsc|textnormal|mathrm|mathbf|mathit|mathsf|mathtt|text|mbox|hbox|url|href)\s*\{([^{}]*)\}/g,
      '$1',
    );
    if (next === text) break;
    text = next;
  }
  text = text.replace(/\\(["'`^~=.uvHckr])\s*\{?([A-Za-z])\}?/g, (_whole, accent, letter) =>
    `${letter}${accentCharacters[accent] ?? ''}`.normalize('NFC'),
  );
  text = text.replace(/\$([^$]*)\$/g, '$1');
  text = text.replace(/\\([A-Za-z]+)\s*\{([^{}]*)\}/g, '$2');
  text = text.replace(/\\[A-Za-z]+\s*/g, '');
  text = text.replace(/[{}$]/g, '');
  text = text.split(String.fromCharCode(0)).join('');
  text = text.replace(/---/g, '—').replace(/--/g, '–');
  text = text.replace(/\\\\/g, ' ');
  text = text.replace(/\s*&\s*/g, ' & ');
  return normalizeSpace(text);
}

function splitTopLevel(value: string, separator: string): string[] {
  const result: string[] = [];
  let depth = 0;
  let start = 0;
  const lower = value.toLocaleLowerCase();
  const needle = separator.toLocaleLowerCase();
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (character === '{') depth++;
    else if (character === '}') depth = Math.max(0, depth - 1);
    if (depth !== 0) continue;
    if (lower.startsWith(needle, index)) {
      result.push(value.slice(start, index));
      index += separator.length - 1;
      start = index + 1;
    }
  }
  result.push(value.slice(start));
  return result.map((part) => part.trim()).filter(Boolean);
}

function splitCommas(value: string): string[] {
  const result: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index++) {
    if (value[index] === '{') depth++;
    else if (value[index] === '}') depth = Math.max(0, depth - 1);
    else if (value[index] === ',' && depth === 0) {
      result.push(value.slice(start, index));
      start = index + 1;
    }
  }
  result.push(value.slice(start));
  return result.map((part) => part.trim());
}

function parseAuthor(value: string): string {
  let text = latexToText(stripOuterBraces(value));
  const parts = splitCommas(text);
  if (parts.length === 2) text = normalizeSpace(`${parts[1]} ${parts[0]}`);
  else if (parts.length === 3) {
    text = normalizeSpace(`${parts[2]} ${parts[0]}${parts[1] ? `, ${parts[1]}` : ''}`);
  }
  return normalizeSpace(text.replace(/^,|,$/g, ''));
}

/** Parse BibTeX-style author lists, including corporate names and `and others`. */
export function parseAuthors(value: string): string[] {
  if (!value.trim()) return [];
  return splitTopLevel(value, ' and ')
    .filter((name) => !/^others$/i.test(name.trim()))
    .map((name) => parseAuthor(name))
    .filter(Boolean);
}

function parseKeywords(value: string): string[] {
  if (!value.trim()) return [];
  return [
    ...new Set(
      value
        .split(/[;,]/)
        .map((keyword) => latexToText(stripOuterBraces(keyword)))
        .filter(Boolean),
    ),
  ];
}

function normalizeType(type: string): string {
  return type.trim().toLocaleLowerCase();
}

function typeLabel(type: string): string {
  return (
    typeLabels[type] ??
    type.replace(/(^|[-_])(\w)/g, (_m, _p, c: string) => ` ${c.toUpperCase()}`).trim()
  );
}

function normalizeYear(value: string): number | null {
  const match = /(?:^|\D)(\d{4})(?:\D|$)/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  return Number.isFinite(year) ? year : null;
}

function cleanDoi(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .replace(/[.,;]+$/, '');
}

function firstAuthorSurname(entry: Pick<BibliographyEntry, 'authors'>): string {
  const author = entry.authors[0] ?? '';
  const parts = author.split(/\s+/);
  return parts[parts.length - 1] ?? '';
}

function makeKey(
  entry: Omit<BibliographyEntry, 'id' | 'key' | 'warnings'>,
  fallback: string,
): string {
  const surname = firstAuthorSurname(entry).replace(/[^\p{L}\p{N}]/gu, '') || fallback;
  const year = entry.year ? String(entry.year) : '';
  return `${surname}${year}`;
}

function uniqueId(key: string, used: Map<string, number>): string {
  const count = used.get(key) ?? 0;
  used.set(key, count + 1);
  return count === 0 ? key : `${key}#${count + 1}`;
}

function createEntry(
  type: string,
  key: string,
  fields: Record<string, string>,
  raw: string,
  format: BibliographyFormat,
  warnings: string[],
  usedIds: Map<string, number>,
): BibliographyEntry {
  const baseType = normalizeType(type);
  const normalizedType =
    baseType === 'misc' && (fields.eprint || fields.archiveprefix) ? 'preprint' : baseType;
  const get = (...names: string[]): string => {
    for (const name of names) {
      const value = fields[name];
      if (value !== undefined && value.trim()) return value;
    }
    return '';
  };
  const authors = parseAuthors(get('author', 'authors'));
  const editors = parseAuthors(get('editor', 'editors'));
  const date = latexToText(get('date', 'year'));
  const year = normalizeYear(get('year', 'date'));
  const title = latexToText(get('title', 'booktitle'));
  const container = latexToText(
    get('journal', 'journaltitle', 'booktitle', 'eventtitle', 'series', 'organization'),
  );
  const keywords = parseKeywords(get('keywords', 'keyword'));
  const primaryClass = latexToText(get('primaryclass'));
  if (primaryClass && !keywords.includes(primaryClass)) keywords.push(primaryClass);
  const entry: BibliographyEntry = {
    id: uniqueId(key, usedIds),
    key,
    type: normalizedType,
    typeLabel: typeLabel(normalizedType),
    title,
    authors,
    editors,
    year,
    date,
    container,
    volume: latexToText(get('volume')),
    issue: latexToText(get('number', 'issue')),
    pages: latexToText(get('pages', 'page')).replace(/--/g, '–'),
    publisher: latexToText(get('publisher', 'school', 'institution')),
    place: latexToText(get('address', 'location')),
    doi: cleanDoi(get('doi')),
    url: get('url', 'howpublished').trim(),
    isbn: latexToText(get('isbn')),
    issn: latexToText(get('issn')),
    abstract: latexToText(get('abstract')),
    keywords,
    note: latexToText(get('note')),
    language: latexToText(get('language', 'langid')),
    raw,
    fields,
    format,
    warnings: [...warnings],
  };
  if (!entry.title) entry.warnings.push('Missing title');
  if (!entry.authors.length && !entry.editors.length) entry.warnings.push('Missing author');
  if (!entry.year) entry.warnings.push('Missing year');
  return entry;
}

interface RawBibEntry {
  type: string;
  key: string;
  fields: string;
  raw: string;
}

function findBalanced(text: string, start: number, open: string, close: string): number {
  const stack = [close];
  let quote = false;
  for (let index = start + 1; index < text.length; index++) {
    const character = text[index];
    if (character === '\\') {
      index++;
      continue;
    }
    if (character === '"') {
      if (!quote) quote = true;
      else quote = false;
      continue;
    }
    if (quote) continue;
    if (character === '{') stack.push('}');
    else if (character === '(' && stack[stack.length - 1] === ')') stack.push(')');
    else if (character === stack[stack.length - 1]) {
      stack.pop();
      if (!stack.length) return index;
    }
  }
  return -1;
}

function findTopLevelComma(value: string): number {
  let depth = 0;
  let quote = false;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (character === '\\') {
      index++;
      continue;
    }
    if (character === '"') {
      quote = !quote;
      continue;
    }
    if (quote) continue;
    if (character === '{') depth++;
    else if (character === '}') depth = Math.max(0, depth - 1);
    else if (character === ',' && depth === 0) return index;
  }
  return -1;
}

function parseBibValue(
  text: string,
  start: number,
  macros: Map<string, string>,
): { value: string; end: number } {
  let index = start;
  let value = '';
  while (index < text.length) {
    while (/\s/.test(text[index] ?? '')) index++;
    const character = text[index];
    if (character === '{') {
      const end = findBalanced(text, index, '{', '}');
      if (end < 0) {
        value += text.slice(index + 1);
        index = text.length;
      } else {
        value += text.slice(index + 1, end);
        index = end + 1;
      }
    } else if (character === '"') {
      let end = index + 1;
      while (end < text.length && (text[end] !== '"' || text[end - 1] === '\\')) end++;
      value += text.slice(index + 1, end);
      index = end + 1;
    } else {
      let end = index;
      while (end < text.length && !/[,}#)]/.test(text[end] ?? '')) end++;
      const token = text.slice(index, end).trim();
      value += macros.get(token.toLocaleLowerCase()) ?? token;
      index = end;
    }
    while (/\s/.test(text[index] ?? '')) index++;
    if (text[index] !== '#') break;
    index++;
  }
  return { value, end: index };
}

function parseBibFields(content: string, macros: Map<string, string>): Record<string, string> {
  const fields: Record<string, string> = {};
  let index = 0;
  while (index < content.length) {
    while (index < content.length && /[\s,]/.test(content[index])) index++;
    const nameMatch = /^[A-Za-z][\w-]*/.exec(content.slice(index));
    if (!nameMatch) break;
    const name = nameMatch[0].toLocaleLowerCase();
    index += nameMatch[0].length;
    while (/\s/.test(content[index] ?? '')) index++;
    if (content[index] !== '=') {
      while (index < content.length && content[index] !== ',') index++;
      continue;
    }
    index++;
    const parsed = parseBibValue(content, index, macros);
    fields[name] = stripOuterBraces(parsed.value);
    index = parsed.end;
    while (index < content.length && content[index] !== ',') {
      if (content[index] === '}') break;
      index++;
    }
  }
  return fields;
}

function parseBibtex(text: string): BibliographyEntry[] {
  const macros = new Map<string, string>(Object.entries(monthMacros));
  const rawEntries: RawBibEntry[] = [];
  let index = 0;
  while (index < text.length) {
    const at = text.indexOf('@', index);
    if (at < 0) break;
    const header = /^@\s*([A-Za-z]+)\s*/.exec(text.slice(at));
    if (!header) {
      index = at + 1;
      continue;
    }
    const type = header[1].toLocaleLowerCase();
    const contentStart = at + header[0].length;
    const open = text[contentStart];
    if (open !== '{' && open !== '(') {
      index = at + 1;
      continue;
    }
    const end = findBalanced(text, contentStart, open, open === '{' ? '}' : ')');
    if (end < 0) {
      // Unbalanced entry. Skip it and keep scanning so later valid entries survive.
      index = at + 1;
      continue;
    }
    const content = text.slice(contentStart + 1, end);
    const raw = text.slice(at, Math.min(text.length, end + 1));
    if (type === 'string') {
      const fields = parseBibFields(content, macros);
      for (const [name, value] of Object.entries(fields)) macros.set(name, value);
      index = end + 1;
      continue;
    }
    if (type === 'comment' || type === 'preamble') {
      index = end + 1;
      continue;
    }
    const comma = findTopLevelComma(content);
    if (comma < 0) {
      index = end + 1;
      continue;
    }
    const key = content.slice(0, comma).trim();
    if (!key) {
      index = end + 1;
      continue;
    }
    rawEntries.push({
      type,
      key,
      fields: content.slice(comma + 1),
      raw,
    });
    index = end + 1;
  }

  const byKey = new Map<string, Record<string, string>>();
  const pending = rawEntries.map((entry) => ({
    ...entry,
    parsed: parseBibFields(entry.fields, macros),
  }));
  for (const entry of pending) byKey.set(entry.key, entry.parsed);
  for (const entry of pending) {
    const crossref = entry.parsed.crossref;
    if (!crossref) continue;
    const parent = byKey.get(crossref);
    if (!parent) continue;
    for (const [name, value] of Object.entries(parent)) {
      if (!entry.parsed[name]) entry.parsed[name] = value;
    }
  }

  const usedIds = new Map<string, number>();
  const duplicates = new Set<string>();
  const result: BibliographyEntry[] = [];
  for (const entry of pending) {
    if (usedIds.has(entry.key)) duplicates.add(entry.key);
    result.push(createEntry(entry.type, entry.key, entry.parsed, entry.raw, 'bibtex', [], usedIds));
  }
  for (const entry of result) {
    if (duplicates.has(entry.key)) entry.warnings.push('Duplicate citation key');
  }
  return result;
}

function parseRisRecords(text: string): Record<string, string[]>[] {
  const records: Record<string, string[]>[] = [];
  let current: Record<string, string[]> | undefined;
  let lastTag = '';
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      if (current && current.ER) {
        records.push(current);
        current = undefined;
        lastTag = '';
      }
      continue;
    }
    const match = /^([A-Z0-9]{2})\s*-\s?(.*)$/.exec(line);
    if (match) {
      const [, tag, value] = match;
      if (tag === 'TY') current = {};
      if (!current) current = {};
      if (!current[tag]) current[tag] = [];
      current[tag].push(value);
      lastTag = tag;
    } else if (current && lastTag) {
      current[lastTag][current[lastTag].length - 1] += ` ${line.trim()}`;
    }
  }
  if (current && Object.keys(current).length) records.push(current);
  return records;
}

function parseRis(text: string): BibliographyEntry[] {
  const usedIds = new Map<string, number>();
  return parseRisRecords(text).map((record, index) => {
    const first = (tag: string) => record[tag]?.[0] ?? '';
    const all = (...tags: string[]) => tags.flatMap((tag) => record[tag] ?? []);
    const typeMap: Record<string, string> = {
      JOUR: 'article',
      JFULL: 'article',
      CONF: 'inproceedings',
      CPAPER: 'inproceedings',
      BOOK: 'book',
      CHAP: 'incollection',
      THES: 'thesis',
      RPRT: 'techreport',
      GEN: 'misc',
      ELEC: 'online',
      DATA: 'dataset',
      COMP: 'software',
    };
    const type = typeMap[first('TY')] ?? 'misc';
    const pages = [first('SP'), first('EP')].filter(Boolean).join('–');
    const fields: Record<string, string> = {
      author: all('AU', 'A1').join(' and '),
      editor: all('A2', 'ED').join(' and '),
      title: first('TI') || first('T1'),
      journal: first('JO') || first('JF') || first('T2'),
      year: first('PY') || first('Y1'),
      date: first('DA') || first('PY') || first('Y1'),
      volume: first('VL'),
      number: first('IS'),
      pages,
      doi: first('DO'),
      url: first('UR'),
      abstract: first('AB') || first('N2'),
      keywords: all('KW').join('; '),
      publisher: first('PB'),
      address: first('CY'),
      isbn: first('SN'),
      language: first('LA'),
      note: first('N1'),
    };
    const labels = all('KW').filter(Boolean);
    return createEntry(
      type,
      `RIS${index + 1}`,
      fields,
      Object.entries(record)
        .map(([tag, values]) => `${tag}  - ${values.join(' ')}`)
        .join('\n'),
      'ris',
      labels.length ? [] : ['Missing keywords'],
      usedIds,
    );
  });
}

function parseNbib(text: string): BibliographyEntry[] {
  const usedIds = new Map<string, number>();
  const records = text
    .split(/\r?\n\s*\r?\n/)
    .map((record) => record.trim())
    .filter(Boolean);
  return records.flatMap((record, index) => {
    const fields = new Map<string, string[]>();
    let lastTag = '';
    for (const line of record.split(/\r?\n/)) {
      const match = /^([A-Z]{2,4})\s*-\s?(.*)$/.exec(line);
      if (match) {
        lastTag = match[1];
        if (!fields.has(lastTag)) fields.set(lastTag, []);
        fields.get(lastTag)!.push(match[2]);
      } else if (lastTag) {
        fields.get(lastTag)![fields.get(lastTag)!.length - 1] += ` ${line.trim()}`;
      }
    }
    if (!fields.size || !['PMID', 'TI', 'AU', 'JT', 'TA'].some((tag) => fields.has(tag))) {
      return [];
    }
    const first = (tag: string) => fields.get(tag)?.[0] ?? '';
    const all = (...tags: string[]) => tags.flatMap((tag) => fields.get(tag) ?? []);
    const lid = [...all('LID'), ...all('AID')].find((value) => /\[doi\]$/i.test(value));
    const doi = lid?.replace(/\s*\[doi\]$/i, '') ?? '';
    const typeMap: Record<string, string> = {
      'Journal Article': 'article',
      Review: 'article',
      Book: 'book',
      'Book Chapter': 'incollection',
      'Conference Paper': 'inproceedings',
      Dataset: 'dataset',
      Software: 'software',
      Thesis: 'thesis',
      'Technical Report': 'techreport',
    };
    const paperType = first('PT');
    const type = typeMap[paperType] ?? 'article';
    const pages = first('PG');
    const authors = all('FAU').length ? all('FAU') : all('AU');
    return [
      createEntry(
        type,
        first('PMID') || `NBIB${index + 1}`,
        {
          author: authors.join(' and '),
          pmid: first('PMID'),
          pmc: first('PMC'),
          title: first('TI'),
          journal: first('JT') || first('TA'),
          year: first('DP'),
          date: first('DP'),
          volume: first('VI'),
          number: first('IP'),
          pages,
          doi,
          abstract: first('AB'),
          keywords: all('OT').join('; '),
          note: first('SO'),
          language: first('LA'),
        },
        record,
        'nbib',
        [],
        usedIds,
      ),
    ];
  });
}

function parseEndNote(text: string): BibliographyEntry[] {
  const usedIds = new Map<string, number>();
  const records = text
    .split(/\r?\n\s*\r?\n/)
    .map((record) => record.trim())
    .filter(Boolean);
  return records.flatMap((record, index) => {
    const fields = new Map<string, string[]>();
    for (const line of record.split(/\r?\n/)) {
      const match = /^%([A-Z0-9@])\s*(.*)$/.exec(line);
      if (!match) continue;
      if (!fields.has(match[1])) fields.set(match[1], []);
      fields.get(match[1])!.push(match[2]);
    }
    if (!fields.size || !['0', 'T', 'A'].some((tag) => fields.has(tag))) return [];
    const first = (tag: string) => fields.get(tag)?.[0] ?? '';
    const all = (...tags: string[]) => tags.flatMap((tag) => fields.get(tag) ?? []);
    const typeMap: Record<string, string> = {
      'Journal Article': 'article',
      Book: 'book',
      'Book Section': 'incollection',
      'Conference Paper': 'inproceedings',
      Thesis: 'thesis',
      Report: 'techreport',
      'Web Page': 'online',
      Dataset: 'dataset',
      Computer: 'software',
    };
    const type = typeMap[first('0')] ?? 'misc';
    return [
      createEntry(
        type,
        `EN${index + 1}`,
        {
          author: all('A').join(' and '),
          editor: all('E').join(' and '),
          title: first('T'),
          journal: first('J') || first('B'),
          year: first('D'),
          date: first('D'),
          volume: first('V'),
          number: first('N'),
          pages: first('P'),
          doi: first('R'),
          url: first('U'),
          abstract: first('X'),
          keywords: all('K').join('; '),
          publisher: first('I'),
          address: first('C'),
          isbn: first('@'),
          language: first('G'),
        },
        record,
        'endnote',
        [],
        usedIds,
      ),
    ];
  });
}

function cslAuthors(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((author) => {
      if (!author || typeof author !== 'object') return '';
      const record = author as { family?: unknown; given?: unknown; literal?: unknown };
      if (typeof record.literal === 'string') return latexToText(record.literal);
      const family = typeof record.family === 'string' ? record.family : '';
      const given = typeof record.given === 'string' ? record.given : '';
      return latexToText(normalizeSpace(`${given} ${family}`));
    })
    .filter(Boolean);
}

function parseCslJson(text: string): BibliographyEntry[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const items = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items)
      ? (data as { items: unknown[] }).items
      : data && typeof data === 'object' && ('title' in data || 'author' in data)
        ? [data]
        : [];
  const usedIds = new Map<string, number>();
  return items.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const title = typeof record.title === 'string' ? latexToText(record.title) : '';
    const authors = cslAuthors(record.author);
    const editors = cslAuthors(record.editor);
    if (!title && !authors.length && !record.DOI) return [];
    const issued = record.issued as { 'date-parts'?: unknown[][] } | undefined;
    const year = Number(issued?.['date-parts']?.[0]?.[0]);
    const keyword = record.keyword;
    const keywords = Array.isArray(keyword)
      ? keyword.filter((value): value is string => typeof value === 'string')
      : typeof keyword === 'string'
        ? parseKeywords(keyword)
        : [];
    const type = typeof record.type === 'string' ? record.type : 'misc';
    const fields: Record<string, string> = {
      author: authors.join(' and '),
      editor: editors.join(' and '),
      title,
      journal: typeof record['container-title'] === 'string' ? record['container-title'] : '',
      year: Number.isFinite(year) ? String(year) : '',
      date: Number.isFinite(year) ? String(year) : '',
      volume: typeof record.volume === 'string' ? record.volume : '',
      number: typeof record.issue === 'string' ? record.issue : '',
      pages: typeof record.page === 'string' ? record.page : '',
      doi: typeof record.DOI === 'string' ? record.DOI : '',
      url: typeof record.URL === 'string' ? record.URL : '',
      isbn: typeof record.ISBN === 'string' ? record.ISBN : '',
      issn: typeof record.ISSN === 'string' ? record.ISSN : '',
      abstract: typeof record.abstract === 'string' ? record.abstract : '',
      keywords: keywords.join('; '),
      publisher: typeof record.publisher === 'string' ? record.publisher : '',
      address: typeof record['publisher-place'] === 'string' ? record['publisher-place'] : '',
      language: typeof record.language === 'string' ? record.language : '',
      note: typeof record.note === 'string' ? record.note : '',
    };
    const key =
      typeof record.id === 'string' && record.id.trim()
        ? record.id.trim()
        : makeKey(
            {
              type: normalizeType(type),
              typeLabel: typeLabel(type),
              title,
              authors,
              editors,
              year: Number.isFinite(year) ? year : null,
              date: fields.date,
              container: fields.journal,
              volume: fields.volume,
              issue: fields.number,
              pages: fields.pages,
              publisher: fields.publisher,
              place: fields.address,
              doi: fields.doi,
              url: fields.url,
              isbn: fields.isbn,
              issn: fields.issn,
              abstract: fields.abstract,
              keywords,
              note: fields.note,
              language: fields.language,
              raw: JSON.stringify(item),
              fields,
              format: 'csl-json',
            } as Omit<BibliographyEntry, 'id' | 'key' | 'warnings'>,
            `CSL${index + 1}`,
          );
    return [createEntry(type, key, fields, JSON.stringify(item, null, 2), 'csl-json', [], usedIds)];
  });
}

/** Detect the bibliography format from its extension and content. */
export function detectBibliographyFormat(text: string, path = ''): BibliographyFormat {
  const extension = path.slice(path.lastIndexOf('.') + 1).toLocaleLowerCase();
  if (extension === 'ris') return 'ris';
  if (extension === 'nbib') return 'nbib';
  if (extension === 'enw') return 'endnote';
  if (extension === 'json' || extension === 'csljson') return 'csl-json';
  if (extension === 'bib' || extension === 'bibtex') return 'bibtex';
  if (/^\s*TY\s+-/m.test(text)) return 'ris';
  if (/^\s*PMID-/m.test(text)) return 'nbib';
  if (/^\s*%0\s+/m.test(text)) return 'endnote';
  const trimmed = text.trimStart();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) return 'csl-json';
  return 'bibtex';
}

/** Check whether a text actually contains the signature of a format. */
function looksLikeFormat(format: BibliographyFormat, text: string): boolean {
  switch (format) {
    case 'ris':
      return /^\s*TY\s+-/m.test(text);
    case 'nbib':
      return /^\s*PMID-/m.test(text);
    case 'endnote':
      return /^\s*%0\s+/m.test(text);
    case 'csl-json': {
      const trimmed = text.trimStart();
      return trimmed.startsWith('[') || trimmed.startsWith('{');
    }
    case 'bibtex':
      return /^\s*@/m.test(text);
  }
}

/** Parse a bibliography file, trying other formats when the extension is ambiguous. */
export function parseBibliography(text: string, path = ''): BibliographyDocument {
  const detected = detectBibliographyFormat(text, path);
  const parsers: Record<BibliographyFormat, (value: string) => BibliographyEntry[]> = {
    bibtex: parseBibtex,
    ris: parseRis,
    nbib: parseNbib,
    endnote: parseEndNote,
    'csl-json': parseCslJson,
  };
  let entries: BibliographyEntry[] = [];
  let format = detected;
  try {
    entries = parsers[detected](text);
  } catch {
    // Leave entries empty and fall through to the other parsers.
  }
  if (!entries.length) {
    for (const candidate of Object.keys(parsers) as BibliographyFormat[]) {
      if (candidate === detected || !looksLikeFormat(candidate, text)) continue;
      try {
        const parsed = parsers[candidate](text);
        if (parsed.length > entries.length) {
          entries = parsed;
          format = candidate;
        }
      } catch {
        // Keep trying the other formats.
      }
    }
  }
  const warnings: string[] = [];
  if (!entries.length) warnings.push('No bibliography entries could be parsed.');
  const duplicateChecks = new Map<string, BibliographyEntry>();
  for (const entry of entries) {
    if (!entry.title) continue;
    const signature = `${entry.title.toLocaleLowerCase()}|${entry.year ?? ''}`;
    if (duplicateChecks.has(signature)) {
      entry.warnings.push('Possible duplicate');
      duplicateChecks.get(signature)?.warnings.push('Possible duplicate');
    } else duplicateChecks.set(signature, entry);
  }
  return {
    format,
    formatLabel: formatLabels[format],
    entries,
    warnings,
  };
}

function initials(name: string): string {
  const letters = name
    .split(/\s+/)
    .map((part) => part[0]?.toLocaleUpperCase() ?? '')
    .filter(Boolean);
  return letters.length ? `${letters.join('. ')}.` : '';
}

function surname(name: string): string {
  const parts = name.split(/\s+/);
  return parts[parts.length - 1] ?? name;
}

function apaAuthors(entry: BibliographyEntry): string {
  if (!entry.authors.length) return 'Anon.';
  const names = entry.authors.map((author) => {
    const parts = author.split(/\s+/);
    const last = parts.pop() ?? author;
    return `${last}, ${initials(parts.join(' '))}`;
  });
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')}, & ${names[names.length - 1]}`;
}

function natureAuthors(entry: BibliographyEntry): string {
  if (!entry.authors.length) return 'Anonymous';
  if (entry.authors.length <= 6) return entry.authors.join(', ');
  return `${entry.authors.slice(0, 3).join(', ')} et al.`;
}

function vancouverAuthors(entry: BibliographyEntry): string {
  if (!entry.authors.length) return 'Anonymous';
  return entry.authors
    .map((author) => {
      const parts = author.split(/\s+/);
      const last = parts.pop() ?? author;
      return `${last} ${initials(parts.join(' ')).replace(/\.\s?/g, '')}`.trim();
    })
    .join(', ');
}

function chicagoAuthors(entry: BibliographyEntry): string {
  if (!entry.authors.length) return 'Anonymous';
  if (entry.authors.length === 1) return entry.authors[0];
  return `${entry.authors[0]}${entry.authors.length === 2 ? ' and ' : ', '}${entry.authors.slice(1).join(', ')}`;
}

function pagesAndVolume(entry: BibliographyEntry): string {
  const number = entry.volume
    ? `${entry.volume}${entry.issue ? `(${entry.issue})` : ''}`
    : entry.issue
      ? `(${entry.issue})`
      : '';
  if (number && entry.pages) return `${number}, ${entry.pages}`;
  return number || entry.pages;
}

function publisherLine(entry: BibliographyEntry): string {
  return [entry.publisher, entry.place].filter(Boolean).join(', ');
}

/** Format one reference in a citation style useful for manuscripts and notes. */
export function formatCitation(entry: BibliographyEntry, style: CitationStyle): string {
  const year = entry.year ? String(entry.year) : 'n.d.';
  const details = pagesAndVolume(entry);
  const location = entry.container
    ? `${entry.container}${details ? `${entry.volume || entry.issue ? ' ' : ', '}${details}` : ''}`
    : publisherLine(entry);
  const link = entry.doi ? `https://doi.org/${entry.doi}` : entry.url;
  switch (style) {
    case 'apa':
      return `${apaAuthors(entry)} (${year}). ${entry.title}.${
        location ? ` ${location}.` : ''
      }${link ? ` ${link}` : ''}`.trim();
    case 'nature':
      return `${natureAuthors(entry)} ${entry.title}. ${
        entry.container
          ? `${entry.container} ${entry.volume ? `${entry.volume}, ` : ''}`
          : location
            ? `${location} `
            : ''
      }${entry.container && entry.pages ? `${entry.pages} ` : ''}(${year}).${
        link ? ` ${link}` : ''
      }`.trim();
    case 'vancouver':
      return `${vancouverAuthors(entry)}. ${entry.title}. ${
        location ? `${location}. ` : ''
      }${year}${entry.container && entry.volume ? `;${entry.volume}` : ''}${
        entry.container && entry.issue ? `(${entry.issue})` : ''
      }${entry.container && entry.pages ? `:${entry.pages}` : ''}.${
        entry.doi ? ` doi:${entry.doi}` : ''
      }`.trim();
    case 'chicago':
      return `${chicagoAuthors(entry)}. ${year}. “${entry.title}.” ${
        location ? `${location}. ` : ''
      }${link}`.trim();
    case 'bibtex':
      return entry.raw;
    case 'latex':
      return `\\cite{${entry.key}}`;
  }
}

export interface BibliographyStats {
  total: number;
  cited: number;
  uncited: number;
  missingDoi: number;
  missingAbstract: number;
  duplicateWarnings: number;
  years: number[];
  authors: number;
  venues: number;
  keywords: number;
  types: Map<string, number>;
}

/** Compute the summary used by the bibliography dashboard and filters. */
export function bibliographyStats(
  entries: readonly BibliographyEntry[],
  citedKeys: Record<string, number> = {},
): BibliographyStats {
  const years = new Set<number>();
  const authors = new Set<string>();
  const venues = new Set<string>();
  const keywords = new Set<string>();
  const types = new Map<string, number>();
  let cited = 0;
  let missingDoi = 0;
  let missingAbstract = 0;
  let duplicateWarnings = 0;
  for (const entry of entries) {
    if (entry.year) years.add(entry.year);
    for (const author of entry.authors) authors.add(author);
    if (entry.container) venues.add(entry.container);
    for (const keyword of entry.keywords) keywords.add(keyword);
    types.set(entry.typeLabel, (types.get(entry.typeLabel) ?? 0) + 1);
    if ((citedKeys[entry.key] ?? 0) > 0) cited++;
    if (!entry.doi) missingDoi++;
    if (!entry.abstract) missingAbstract++;
    if (entry.warnings.includes('Possible duplicate')) duplicateWarnings++;
  }
  return {
    total: entries.length,
    cited,
    uncited: entries.length - cited,
    missingDoi,
    missingAbstract,
    duplicateWarnings,
    years: [...years].sort((left, right) => left - right),
    authors: authors.size,
    venues: venues.size,
    keywords: keywords.size,
    types,
  };
}

/** Return a filename usable as a citation library title. */
export function bibliographyTitle(path: string): string {
  const name = basename(path)
    .replace(/\.(?:bib|bibtex|ris|nbib|enw|csljson|json)$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();
  if (!name) return 'Bibliography';
  return name.charAt(0).toLocaleUpperCase() + name.slice(1);
}

/** Turn a title into a compact label for charts. */
export function shortLabel(value: string, length = 24): string {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

/** A stable, readable citation key for generated formats. */
export function citationKey(entry: BibliographyEntry): string {
  const surnamePart = surname(entry.authors[0] ?? '').replace(/[^\p{L}\p{N}]/gu, '');
  const titlePart = entry.title
    .split(/\s+/)
    .filter((word) => !filterWords.has(word.toLocaleLowerCase()))
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean)[0];
  return `${surnamePart || 'ref'}${entry.year ?? ''}${titlePart ? titlePart[0].toLocaleLowerCase() : ''}`;
}

function bibtexTypeForEntry(type: string): string {
  if (type === 'article' || type === 'journal') return 'article';
  if (type === 'inproceedings' || type === 'conference' || type === 'paper-conference')
    return 'inproceedings';
  if (type === 'incollection' || type === 'inbook' || type === 'chapter') return 'incollection';
  if (type === 'phdthesis' || type === 'mastersthesis' || type === 'book') return type;
  if (type === 'techreport' || type === 'report') return 'techreport';
  return 'misc';
}

function escapeBibtexValue(value: string): string {
  return value.replace(/[\\{}&%$#_~^]/g, (character) => {
    if (character === '\\') return '\\textbackslash{}';
    if (character === '~') return '\\textasciitilde{}';
    if (character === '^') return '\\textasciicircum{}';
    return `\\${character}`;
  });
}

/** Serialize an entry into a BibTeX record, including fetched arXiv/PubMed fields. */
export function toBibtex(entry: BibliographyEntry, key = citationKey(entry)): string {
  const type = bibtexTypeForEntry(entry.type);
  const fields: [string, string][] = [];
  const add = (name: string, value: string) => {
    if (value.trim()) fields.push([name, value.trim()]);
  };
  add('author', entry.authors.join(' and '));
  add('editor', entry.editors.join(' and '));
  add('title', entry.title);
  if (entry.container) {
    if (type === 'article') add('journal', entry.container);
    else if (type === 'inproceedings' || type === 'incollection') add('booktitle', entry.container);
    else add('series', entry.container);
  }
  add('year', entry.year?.toString() ?? '');
  add('volume', entry.volume);
  add('number', entry.issue);
  add('pages', entry.pages);
  add('publisher', entry.publisher);
  add('address', entry.place);
  add('doi', entry.doi);
  add('url', entry.url);
  add('isbn', entry.isbn);
  add('issn', entry.issn);
  add('abstract', entry.abstract);
  add('keywords', entry.keywords.join('; '));
  add('pmid', entry.fields.pmid ?? '');
  add('pmc', entry.fields.pmc ?? '');
  add('language', entry.language);
  add('note', entry.note);
  if (entry.fields.eprint) {
    add('eprint', entry.fields.eprint);
    add('archivePrefix', entry.fields.archiveprefix ?? 'arXiv');
    add('primaryClass', entry.fields.primaryclass ?? '');
  }
  const safeKey = key.trim().replace(/[^A-Za-z0-9:_-]+/g, '') || citationKey(entry);
  return `@${type}{${safeKey},\n${fields
    .map(([name, value]) => `  ${name} = {${escapeBibtexValue(value)}},`)
    .join('\n')}\n}\n`;
}

/** Return a key that does not collide with any key already used in the library. */
export function uniqueCitationKey(base: string, used: Set<string>): string {
  const clean = base.replace(/[^A-Za-z0-9:_-]+/g, '') || 'reference';
  if (!used.has(clean)) return clean;
  for (let index = 0; index < 26; index++) {
    const candidate = `${clean}${String.fromCharCode(97 + index)}`;
    if (!used.has(candidate)) return candidate;
  }
  let suffix = 2;
  while (used.has(`${clean}-${suffix}`)) suffix++;
  return `${clean}-${suffix}`;
}

/** Read the citation key from a BibTeX record. */
export function bibtexKey(bibtex: string): string | null {
  const match = /^@\w+\s*\{\s*([^,\s]+)\s*,/.exec(bibtex.trim());
  return match?.[1] ?? null;
}

/** Rewrite a BibTeX record's key when it would collide with an existing entry. */
export function ensureUniqueBibtexKey(
  bibtex: string,
  entry: BibliographyEntry,
  used: Set<string>,
): string {
  const current = bibtexKey(bibtex);
  if (current && !used.has(current)) return bibtex;
  const key = uniqueCitationKey(citationKey(entry), used);
  if (!current) return bibtex.replace(/^(@\w+\s*\{\s*)/, `$1${key},`);
  return bibtex.replace(/^(@\w+\s*\{\s*)[^,\s]+(\s*,)/, `$1${key}$2`);
}

/** Some DOI exports write `month=July`; quote bare month names for BibTeX. */
export function normalizeBibtexMonthAliases(bibtex: string): string {
  const months =
    'January|February|March|April|May|June|July|August|September|October|November|December';
  return bibtex.replace(new RegExp(`(\\bmonth\\s*=\\s*)(${months})(\\s*[,}])`, 'gi'), '$1{$2}$3');
}

/** Reflow a fetched BibTeX entry into one field per line without changing values. */
export function formatBibtexEntry(raw: string): string {
  const trimmed = raw.trim();
  const header = /^(@\w+\s*\{\s*[^,]+,\s*)/.exec(trimmed);
  if (!header) return trimmed;
  const close = trimmed.lastIndexOf('}');
  if (close <= header[0].length) return trimmed;
  const fields = splitTopLevel(trimmed.slice(header[0].length, close), ',');
  if (!fields.length) return trimmed;
  const body = fields.map((field) => `  ${field.trim().replace(/\s*=\s*/, ' = ')},`).join('\n');
  return `${header[0].trimEnd()}\n${body}\n}`;
}

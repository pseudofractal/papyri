import { listDirectory } from './directories';
import { basename, isDocument, isMarkdown, isTypst, isLatex } from './paths';
import type { Source } from './types';

const MAX_DIRECTORIES = 2000;
const MAX_ENTRIES = 20000;
const DIRECTORIES_PER_BATCH = 20;
const MAX_CONTENT_FILES = 500;
const MAX_CONTENT_CHARACTERS = 4_000_000;
const MAX_FILE_CHARACTERS = 500_000;
const MAX_CONTENT_RESULTS = 100;

export interface DirectorySearch {
  paths: string[];
  inaccessible: number;
  truncated: boolean;
}
export interface PaletteCommand {
  id: string;
  label: string;
  shortcut?: string;
  keywords?: string;
  group?: string;
  run: () => void;
}

export interface ContentMatch {
  path: string;
  line: number;
  snippet: string;
}
export interface ContentSearch {
  matches: ContentMatch[];
  inaccessible: number;
  truncated: boolean;
}

/** Search source text without compiling documents, and limit total work per query. */
export async function searchContents(
  source: Source,
  paths: string[],
  query: string,
  signal: AbortSignal,
  onprogress: (result: ContentSearch) => void,
): Promise<void> {
  const needle = query.toLocaleLowerCase();
  if (!needle) return;
  const matches: ContentMatch[] = [];
  let inaccessible = 0;
  let truncated = false;
  let characters = 0;
  let scanned = 0;
  for (const path of paths) {
    if (signal.aborted) return;
    if (!(isMarkdown(path) || isTypst(path) || isLatex(path))) continue;
    if (
      scanned >= MAX_CONTENT_FILES ||
      characters >= MAX_CONTENT_CHARACTERS ||
      matches.length >= MAX_CONTENT_RESULTS
    ) {
      truncated = true;
      break;
    }
    scanned++;
    try {
      const file = await (source.readSource ? source.readSource(path) : source.read(path));
      if (signal.aborted) return;
      if (
        file.text.length > MAX_FILE_CHARACTERS ||
        characters + file.text.length > MAX_CONTENT_CHARACTERS
      ) {
        truncated = true;
        continue;
      }
      characters += file.text.length;
      const offset = file.text.toLocaleLowerCase().indexOf(needle);
      if (offset !== -1) {
        const start = file.text.lastIndexOf('\n', offset - 1) + 1;
        const end = file.text.indexOf('\n', offset);
        const line = file.text.slice(0, start).split('\n').length;
        const snippet = file.text
          .slice(
            Math.max(start, offset - 80),
            Math.min(end === -1 ? file.text.length : end, offset + needle.length + 120),
          )
          .trim();
        matches.push({ path, line, snippet });
      }
    } catch {
      if (signal.aborted) return;
      inaccessible++;
    }
    if (scanned % DIRECTORIES_PER_BATCH === 0) {
      onprogress({ matches: [...matches], inaccessible, truncated });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  if (!signal.aborted) onprogress({ matches, inaccessible, truncated });
}

/** Traverse the selected directory without following symbolic links or leaving a search running. */
export async function scanDocuments(
  source: Source,
  root: string,
  signal: AbortSignal,
  onprogress: (result: DirectorySearch) => void,
): Promise<void> {
  const directories = [root];
  const paths: string[] = [];
  let scanned = 0;
  let entriesSeen = 0;
  let inaccessible = 0;
  let truncated = false;
  while (scanned < directories.length && !signal.aborted) {
    if (scanned >= MAX_DIRECTORIES || entriesSeen >= MAX_ENTRIES) {
      truncated = true;
      break;
    }
    const directory = directories[scanned++];
    try {
      const entries = await listDirectory(source, directory);
      if (signal.aborted) return;
      for (const entry of entries) {
        if (entriesSeen++ >= MAX_ENTRIES) {
          truncated = true;
          break;
        }
        if (entry.symlink) continue;
        if (entry.directory) directories.push(entry.path);
        else if (!entry.directory && isDocument(entry.path)) paths.push(entry.path);
      }
    } catch {
      if (signal.aborted) return;
      inaccessible++;
    }
    if (scanned % DIRECTORIES_PER_BATCH === 0) {
      onprogress({ paths: [...paths], inaccessible, truncated });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (truncated) break;
  }
  if (!signal.aborted) onprogress({ paths, inaccessible, truncated });
}

/** Score a case-insensitive subsequence, preferring adjacent matches and word starts. */
export function fuzzyScore(query: string, value: string): number | null {
  const text = value.toLocaleLowerCase();
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  let score = 0;
  for (const term of terms) {
    let previous = -1;
    for (const character of term) {
      const position = text.indexOf(character, previous + 1);
      if (position < 0) return null;
      score += position === previous + 1 ? 8 : 1;
      if (position === 0 || /[\s/_.-]/.test(text[position - 1])) score += 6;
      score -= position * 0.01;
      previous = position;
    }
  }
  return score;
}

export function fileScore(query: string, path: string): number | null {
  const full = fuzzyScore(query, path);
  const name = fuzzyScore(query, basename(path));
  return name === null ? full : name + 20;
}

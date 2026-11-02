const MAX_DICTIONARY_WORDS = 6000;
const MAX_CORRECTIONS = 3;
const MIN_DICTIONARY_WORD_LENGTH = 3;
const MIN_QUERY_WORD_LENGTH = 4;
const MAX_WORD_LENGTH = 64;
const WORD_PATTERN = /[\p{L}\p{N}]+/gu;
const COMMON_WORDS =
  `welcome gallery markdown mathematics math equation equations gaussian integral integrals matrix matrices vector vectors proof theorem lemma definition diagram diagrams chart charts mermaid graphviz vega lite plantuml typst latex pdf sample paper readme reference references bibliography citation citations settings preferences appearance reading documents compilers interface font fonts palette command commands search folder folders workspace parent recent pages page heading headings tabs file files open close import export snapshot explorer outline panel panels split view theme light dark network external resources allow block zoom reset fit width height keyboard shortcuts help trust document documents preview source compile compiler error errors showcase parts section sections notes research journal papers project projects linked broken scripts password protected disabled figures tables code syntax highlighting media image images asset assets orbit notes work home user config cache log logs file markdown html css javascript typescript python rust shell terminal window dialog menu button toggle select choose move next previous first last start end top bottom left right title header footer list table text word words line lines`.split(
    /\s+/,
  );

export type SpellingDictionary = ReadonlyMap<string, number>;
export interface SpellingSuggestion {
  /** The full corrected query, including any leading search prefix. */
  corrected: string;
  /** The corrected search text without the prefix, suitable for display. */
  display: string;
}

function wordsIn(text: string): string[] {
  return text.toLocaleLowerCase().match(WORD_PATTERN) ?? [];
}

/**
 * Build a small vocabulary from searchable local names. Common application
 * terms come first, then commands, headings, recent places, and file paths.
 */
export function buildSpellingDictionary(groups: Iterable<string>[]): SpellingDictionary {
  const dictionary = new Map<string, number>();
  const add = (text: string) => {
    for (const word of wordsIn(text)) {
      if (dictionary.size >= MAX_DICTIONARY_WORDS) return;
      if (
        word.length < MIN_DICTIONARY_WORD_LENGTH ||
        word.length > MAX_WORD_LENGTH ||
        /\d/.test(word)
      )
        continue;
      dictionary.set(word, (dictionary.get(word) ?? 0) + 1);
    }
  };
  for (const word of COMMON_WORDS) add(word);
  for (const group of groups) for (const text of group) add(text);
  return dictionary;
}

function maxDistance(length: number): number {
  return length <= 4 ? 1 : 2;
}

/** Optimal string alignment distance, including adjacent transpositions. */
function editDistance(left: string, right: string): number {
  const rows = left.length + 1;
  const columns = right.length + 1;
  const distances = Array.from({ length: rows }, () => new Array<number>(columns).fill(0));
  for (let row = 0; row < rows; row++) distances[row][0] = row;
  for (let column = 0; column < columns; column++) distances[0][column] = column;
  for (let row = 1; row < rows; row++) {
    for (let column = 1; column < columns; column++) {
      const substitution = left[row - 1] === right[column - 1] ? 0 : 1;
      let value = Math.min(
        distances[row - 1][column] + 1,
        distances[row][column - 1] + 1,
        distances[row - 1][column - 1] + substitution,
      );
      if (
        row > 1 &&
        column > 1 &&
        left[row - 1] === right[column - 2] &&
        left[row - 2] === right[column - 1]
      )
        value = Math.min(value, distances[row - 2][column - 2] + 1);
      distances[row][column] = value;
    }
  }
  return distances[left.length][right.length];
}

function closestWord(
  token: string,
  dictionary: SpellingDictionary,
  maximum: number,
): string | undefined {
  let best: { word: string; distance: number; count: number } | undefined;
  for (const [word, count] of dictionary) {
    if (Math.abs(word.length - token.length) > maximum) continue;
    const distance = editDistance(token, word);
    if (distance > maximum) continue;
    if (
      !best ||
      distance < best.distance ||
      (distance === best.distance &&
        (count > best.count || (count === best.count && word < best.word)))
    )
      best = { word, distance, count };
  }
  return best?.word;
}

function applyCase(original: string, replacement: string): string {
  if (original === original.toLocaleUpperCase()) return replacement.toLocaleUpperCase();
  if (original[0] === original[0].toLocaleUpperCase())
    return replacement[0].toLocaleUpperCase() + replacement.slice(1);
  return replacement;
}

/**
 * Suggest one corrected query for nearby misspelled words. The caller presents
 * the result as an option; this function never changes the active query.
 */
export function suggestSpelling(
  query: string,
  dictionary: SpellingDictionary,
): SpellingSuggestion | null {
  if (!query.trim() || !dictionary.size) return null;
  const replacements: { start: number; length: number; text: string }[] = [];
  for (const match of [...query.matchAll(WORD_PATTERN)].reverse()) {
    const token = match[0];
    if (token.length < MIN_QUERY_WORD_LENGTH || token.length > MAX_WORD_LENGTH || /\d/.test(token))
      continue;
    const lower = token.toLocaleLowerCase();
    if (dictionary.has(lower)) continue;
    const candidate = closestWord(lower, dictionary, maxDistance(token.length));
    if (!candidate) continue;
    replacements.push({
      start: match.index,
      length: token.length,
      text: applyCase(token, candidate),
    });
    if (replacements.length >= MAX_CORRECTIONS) break;
  }
  if (!replacements.length) return null;
  let corrected = query;
  for (const replacement of replacements)
    corrected =
      corrected.slice(0, replacement.start) +
      replacement.text +
      corrected.slice(replacement.start + replacement.length);
  const prefix = /^[>@%?~#]\s*/.exec(corrected);
  const display = (prefix ? corrected.slice(prefix[0].length) : corrected).trim();
  return display ? { corrected, display } : null;
}

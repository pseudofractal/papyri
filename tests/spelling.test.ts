import { expect, it } from 'vitest';
import { buildSpellingDictionary, suggestSpelling } from '../src/lib/spelling';

const dictionary = buildSpellingDictionary([
  ['markdown settings welcome open gaussian integral paper typst latex'],
]);

it('suggests nearby words and preserves query prefixes and case', () => {
  expect(suggestSpelling('markdwon', dictionary)).toEqual({
    corrected: 'markdown',
    display: 'markdown',
  });
  expect(suggestSpelling('settngs', dictionary)).toEqual({
    corrected: 'settings',
    display: 'settings',
  });
  expect(suggestSpelling('>settngs', dictionary)).toEqual({
    corrected: '>settings',
    display: 'settings',
  });
  expect(suggestSpelling('Settngs', dictionary)).toEqual({
    corrected: 'Settings',
    display: 'Settings',
  });
  expect(suggestSpelling('? gausian intergral', dictionary)).toEqual({
    corrected: '? gaussian integral',
    display: 'gaussian integral',
  });
});

it('does not rewrite exact, short, numeric, or unrelated queries', () => {
  expect(suggestSpelling('markdown', dictionary)).toBeNull();
  expect(suggestSpelling('stg', dictionary)).toBeNull();
  expect(suggestSpelling('page 12', dictionary)).toBeNull();
  expect(suggestSpelling('zzzzzz', dictionary)).toBeNull();
  expect(suggestSpelling('', dictionary)).toBeNull();
  expect(suggestSpelling('markdwon', new Map())).toBeNull();
});

it('builds vocabulary from local names and common application terms', () => {
  const local = buildSpellingDictionary([['/notes/papr.typ'], ['showcase'], ['Open preferences']]);
  expect(local.has('papr')).toBe(true);
  expect(local.has('showcase')).toBe(true);
  expect(local.has('preferences')).toBe(true);
  expect(local.has('markdown')).toBe(true);
  expect(suggestSpelling('shwcase', local)).toEqual({
    corrected: 'showcase',
    display: 'showcase',
  });
});

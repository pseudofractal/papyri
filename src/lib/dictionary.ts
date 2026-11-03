import type { SpellCheckerLike } from './spelling';

let english: Promise<SpellCheckerLike> | undefined;

async function fetchText(path: string): Promise<string> {
  const response = await fetch(new URL(import.meta.env.BASE_URL + path, location.href));
  if (!response.ok) throw new Error(`Could not load ${path}: ${response.status}`);
  return response.text();
}

/** Load the bundled English dictionary once, on demand. */
export function loadEnglishSpellchecker(): Promise<SpellCheckerLike> {
  return (english ??= Promise.all([
    fetchText('dictionaries/en.aff'),
    fetchText('dictionaries/en.dic'),
    import('nspell'),
  ])
    .then(([aff, dic, module]) => module.default(aff, dic))
    .catch((error) => {
      english = undefined;
      throw error;
    }));
}

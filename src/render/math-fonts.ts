import type { Delimiter } from '../lib/types';

/** Identify likely math early enough to overlap font loading with parsing. */
export function mayContainMath(text: string, delimiters: Delimiter[]): boolean {
  return delimiters.some(({ left, right, display }) => {
    if (display && left === '[' && right === ']')
      return /(?:^|\n)[\t ]*\[(?:[\t ]|\\|$)/.test(text);
    const start = text.indexOf(left);
    return start !== -1 && text.indexOf(right, start + left.length) !== -1;
  });
}

let warming: Promise<void> | undefined;

/** Warm the bundled KaTeX fonts in the host while the document is being parsed. */
export async function warmMathFonts(css: string): Promise<void> {
  if (warming) return warming;
  if (!document.fonts?.load) return Promise.resolve();
  const faces = [...css.matchAll(/@font-face\s*\{[^}]+\}/g)]
    .map(([face]) => {
      const family = /font-family:\s*([^;}]+)/.exec(face)?.[1].trim();
      const weight = /font-weight:\s*(\d+)/.exec(face)?.[1] || '400';
      const style = /font-style:\s*(normal|italic)/.exec(face)?.[1] || 'normal';
      return family && /^KaTeX_[A-Za-z0-9]+$/.test(family)
        ? { css: face, font: `${style} ${weight} 16px ${family}` }
        : null;
    })
    .filter((face) => face !== null);
  if (!faces.length) return Promise.resolve();
  const style = document.createElement('style');
  style.textContent = faces.map((face) => face.css).join('');
  document.head.append(style);
  warming = Promise.resolve()
    .then(() => Promise.all(faces.map((face) => document.fonts.load(face.font))))
    .then(() => undefined)
    .catch((error) => {
      style.remove();
      warming = undefined;
      throw error;
    });
  return warming;
}

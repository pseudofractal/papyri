import { describe, expect, it } from 'vitest';
import { defaults, mergePreferences } from '../src/lib/preferences';

describe('preference updates', () => {
  it('merges validated settings without mutating the current object', () => {
    const current = structuredClone(defaults);
    const next = mergePreferences(current, {
      theme: 'latte',
      network: true,
      fitWidth: true,
      documentZoom: 120,
      pdfZoom: 150,
      uiZoom: 110,
      sidebarWidth: 300,
      typstPath: '/opt/typst',
      latexEngine: 'xelatex',
      latexPaths: { xelatex: '/opt/xelatex' },
    });
    expect(next).toMatchObject({
      theme: 'latte',
      network: true,
      fitWidth: true,
      documentZoom: 120,
      pdfZoom: 150,
      uiZoom: 110,
      sidebarWidth: 300,
      typstPath: '/opt/typst',
      latexEngine: 'xelatex',
      latexPaths: { lualatex: '', pdflatex: '', xelatex: '/opt/xelatex' },
    });
    expect(current).toEqual(defaults);
  });

  it('clamps zooms and sidebar width to their supported ranges', () => {
    const next = mergePreferences(structuredClone(defaults), {
      documentZoom: 1,
      pdfZoom: 5000,
      uiZoom: 999,
      sidebarWidth: 10,
    });
    expect(next.documentZoom).toBe(50);
    expect(next.pdfZoom).toBe(1000);
    expect(next.uiZoom).toBe(200);
    expect(next.sidebarWidth).toBe(180);
  });

  it('validates delimiters through the shared delimiter rules', () => {
    const next = mergePreferences(structuredClone(defaults), {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '\\(', right: '\\)', display: false },
      ],
    });
    expect(next.delimiters.map((pair) => pair.left)).toEqual(['$$', '\\(']);
    expect(() =>
      mergePreferences(structuredClone(defaults), {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$$', right: '\\]', display: false },
        ],
      }),
    ).toThrow('Duplicate opening delimiter');
  });

  it('rejects unknown keys, invalid types, and unknown engines', () => {
    expect(() => mergePreferences(structuredClone(defaults), { unknown: true })).toThrow(
      'Unknown preference',
    );
    expect(() => mergePreferences(structuredClone(defaults), { theme: 'dark' })).toThrow('latte');
    expect(() => mergePreferences(structuredClone(defaults), { documentZoom: '120' })).toThrow(
      'finite number',
    );
    expect(() =>
      mergePreferences(structuredClone(defaults), { latexPaths: { tectonic: '/bin/tectonic' } }),
    ).toThrow('Unknown LaTeX engine');
    expect(() => mergePreferences(structuredClone(defaults), { latexPaths: [] })).toThrow(
      'must be an object',
    );
  });
});

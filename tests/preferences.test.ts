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
      paletteWidth: 85,
      paletteHeight: 80,
      paletteMaxWidth: 1100,
      paletteMaxHeight: 900,
      uiFont: "'Noto Sans', sans-serif",
      textFont: "'Noto Serif', serif",
      codeFont: "'JetBrains Mono', monospace",
      mathFont: "'STIX Two Math', serif",
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
      paletteWidth: 85,
      paletteHeight: 80,
      paletteMaxWidth: 1100,
      paletteMaxHeight: 900,
      uiFont: "'Noto Sans', sans-serif",
      textFont: "'Noto Serif', serif",
      codeFont: "'JetBrains Mono', monospace",
      mathFont: "'STIX Two Math', serif",
      typstPath: '/opt/typst',
      latexEngine: 'xelatex',
      latexPaths: { lualatex: '', pdflatex: '', xelatex: '/opt/xelatex' },
    });
    expect(current).toEqual(defaults);
  });

  it('clamps zooms, sidebar width, and palette bounds to their supported ranges', () => {
    const next = mergePreferences(structuredClone(defaults), {
      documentZoom: 1,
      pdfZoom: 5000,
      uiZoom: 999,
      sidebarWidth: 10,
      paletteWidth: 1,
      paletteHeight: 999,
      paletteMaxWidth: 10,
      paletteMaxHeight: 5000,
    });
    expect(next.documentZoom).toBe(50);
    expect(next.pdfZoom).toBe(1000);
    expect(next.uiZoom).toBe(200);
    expect(next.sidebarWidth).toBe(180);
    expect(next.paletteWidth).toBe(40);
    expect(next.paletteHeight).toBe(100);
    expect(next.paletteMaxWidth).toBe(320);
    expect(next.paletteMaxHeight).toBe(1600);
  });

  it('accepts custom font lists, normalizes whitespace, and allows an empty math font', () => {
    const next = mergePreferences(structuredClone(defaults), {
      uiFont: '  Inter,   system-ui,  sans-serif ',
      textFont: "'Source Serif 4', Georgia, serif",
      codeFont: 'Iosevka, ui-monospace, monospace',
      mathFont: '',
    });
    expect(next.uiFont).toBe('Inter, system-ui, sans-serif');
    expect(next.textFont).toBe("'Source Serif 4', Georgia, serif");
    expect(next.codeFont).toBe('Iosevka, ui-monospace, monospace');
    expect(next.mathFont).toBe('');
    expect(() =>
      mergePreferences(structuredClone(defaults), { uiFont: 'serif; color: red' }),
    ).toThrow('unsupported characters');
    expect(() => mergePreferences(structuredClone(defaults), { textFont: '' })).toThrow(
      'must not be empty',
    );
    expect(() => mergePreferences(structuredClone(defaults), { codeFont: 12 })).toThrow(
      'must be a string',
    );
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
    expect(() =>
      mergePreferences(structuredClone(defaults), { latexPaths: { toString: '/bin/tectonic' } }),
    ).toThrow('Unknown LaTeX engine');
    expect(() => mergePreferences(structuredClone(defaults), { latexPaths: [] })).toThrow(
      'must be an object',
    );
  });
});

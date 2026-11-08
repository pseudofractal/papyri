import { describe, expect, it } from 'vitest';
import { defaults, mergePreferences, withoutConfiguredPreferences } from '../src/lib/preferences';

describe('preference updates', () => {
  it('preserves saved values under declarative overrides while saving other edits', () => {
    const saved = mergePreferences(defaults, {
      theme: 'latte',
      languageServerPaths: { typst: '/old' },
    });
    const configured = { theme: 'mocha', languageServerPaths: { typst: '/nix/store/tinymist' } };
    const current = mergePreferences(mergePreferences(saved, configured), {
      network: true,
      languageServerPaths: { markdown: '/marksman' },
    });
    const persisted = withoutConfiguredPreferences(current, saved, configured);
    expect(persisted).toMatchObject({
      theme: 'latte',
      network: true,
      languageServerPaths: { typst: '/old', markdown: '/marksman' },
    });
    expect(current.theme).toBe('mocha');
  });

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
      languageServerPaths: { markdown: '/opt/marksman' },
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
      languageServerPaths: { markdown: '/opt/marksman', typst: '', latex: '' },
      latexEngine: 'xelatex',
      latexPaths: { lualatex: '', pdflatex: '', xelatex: '/opt/xelatex' },
    });
    expect(current).toEqual(defaults);
  });

  it('rejects unknown language servers and invalid paths', () => {
    expect(() =>
      mergePreferences(structuredClone(defaults), { languageServerPaths: { rust: '/bin/server' } }),
    ).toThrow('Invalid language server');
    expect(() =>
      mergePreferences(structuredClone(defaults), { languageServerPaths: { typst: 42 } }),
    ).toThrow('Invalid language server');
  });

  it('clamps zooms, sidebar width, and palette bounds to their supported ranges', () => {
    const next = mergePreferences(structuredClone(defaults), {
      documentZoom: 1,
      pdfZoom: 5000,
      uiZoom: 999,
      sidebarWidth: 10,
      browserWidth: 50000,
      paletteWidth: 1,
      paletteHeight: 999,
      paletteMaxWidth: 10,
      paletteMaxHeight: 5000,
    });
    expect(next.documentZoom).toBe(50);
    expect(next.pdfZoom).toBe(1000);
    expect(next.uiZoom).toBe(200);
    expect(next.sidebarWidth).toBe(180);
    expect(next.browserWidth).toBe(10000);
    expect(next.paletteWidth).toBe(40);
    expect(next.paletteHeight).toBe(100);
    expect(next.paletteMaxWidth).toBe(320);
    expect(next.paletteMaxHeight).toBe(1600);
  });

  it('validates the remembered browser address and width', () => {
    const next = mergePreferences(structuredClone(defaults), {
      browserWidth: 10,
      browserUrl: 'https://chatgpt.com/c/example',
    });
    expect(next.browserWidth).toBe(280);
    expect(next.browserUrl).toBe('https://chatgpt.com/c/example');
    expect(() =>
      mergePreferences(structuredClone(defaults), { browserUrl: 'file:///etc/passwd' }),
    ).toThrow('HTTP(S)');
    expect(() =>
      mergePreferences(structuredClone(defaults), { browserUrl: 'javascript:alert(1)' }),
    ).toThrow('HTTP(S)');
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

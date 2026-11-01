import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaults } from '../src/lib/preferences';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('math font warming', () => {
  it('detects math delimiters without treating ordinary Markdown links as bracket math', async () => {
    const { mayContainMath } = await import('../src/render/math-fonts');
    expect(mayContainMath('[Link](other.md)', defaults.delimiters)).toBe(false);
    expect(mayContainMath('A formula $$x^2$$', defaults.delimiters)).toBe(true);
    expect(mayContainMath('[ \\begin{matrix}x\\end{matrix} ]', defaults.delimiters)).toBe(true);
    expect(mayContainMath('%%x%%', [{ left: '%%', right: '%%', display: false }])).toBe(true);
    expect(mayContainMath('An unmatched $$', defaults.delimiters)).toBe(false);
  });

  it('loads bundled KaTeX faces once and retries if loading fails', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue([]);
    const append = vi.fn();
    const remove = vi.fn();
    vi.stubGlobal('document', {
      fonts: { load },
      createElement: () => ({ textContent: '', remove }),
      head: { append },
    });
    const { warmMathFonts } = await import('../src/render/math-fonts');
    const css =
      '@font-face{font-family:KaTeX_Main;font-style:normal;font-weight:400;src:url(data:font/woff2;base64,AA)}';
    await expect(warmMathFonts(css)).rejects.toThrow('unavailable');
    expect(remove).toHaveBeenCalledOnce();
    await Promise.all([warmMathFonts(css), warmMathFonts(css)]);
    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenLastCalledWith('normal 400 16px KaTeX_Main');
    expect(append).toHaveBeenCalledTimes(2);
  });
});

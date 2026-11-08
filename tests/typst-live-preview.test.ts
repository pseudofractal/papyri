import { describe, expect, it } from 'vitest';
import { previewLocation, previewPort } from '../src/lib/typst-live-preview';

describe('Tinymist preview boundaries', () => {
  it('accepts source positions within the project and rejects invalid or escaping locations', () => {
    const main = '/work/paper/main.typ';
    expect(previewLocation({ filepath: '/work/paper/parts/a.typ', start: [3, 4] }, main)).toEqual({
      path: '/work/paper/parts/a.typ',
      line: 3,
      character: 4,
    });
    for (const filepath of [
      '/work/paper/../secret.typ',
      '/work/paper-other/x.typ',
      'relative.typ',
      '/work/paper/x.pdf',
    ])
      expect(previewLocation({ filepath, start: [0, 0] }, main)).toBeNull();
    expect(previewLocation({ filepath: main, start: [-1, 0] }, main)).toBeNull();
    expect(previewLocation({ filepath: main, start: [1, 0.5] }, main)).toBeNull();
  });
  it('only accepts valid TCP ports', () => {
    expect(previewPort({ staticServerPort: 12345 })).toBe(12345);
    for (const port of [0, 65536, -1, '1234', null])
      expect(() => previewPort({ staticServerPort: port })).toThrow();
  });
});

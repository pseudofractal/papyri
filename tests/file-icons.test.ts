import { describe, expect, it } from 'vitest';
import { fileIcon, fileIconName } from '../src/lib/file-icons';

describe('Catppuccin file icons', () => {
  it('distinguishes common document and asset types', () => {
    const names = [
      'draft.md',
      'paper.typ',
      'paper.tex',
      'paper.pdf',
      'refs.bib',
      'figure.svg',
      'photo.png',
    ];
    const variants = names.map((name) => fileIconName(name, false));
    expect(new Set(variants).size).toBe(names.length);
    for (const name of names)
      expect(fileIcon(name, false)).not.toBe(fileIcon('unknown.zzz', false));
    expect(fileIconName('README.MD', false)).toBe('readme');
    expect(fileIconName('UNKNOWN.xyz', false)).toBe('_file');
    expect(fileIconName('sample.constructor', false)).toBe('_file');
  });
  it('uses named and open folder icons with a generic fallback', () => {
    expect(fileIconName('images', true)).toBe('folder_images');
    expect(fileIconName('images', true, true)).toBe('folder_images_open');
    expect(fileIconName('unknown', true)).toBe('_folder');
    expect(fileIconName('constructor', true)).toBe('_folder');
    expect(fileIconName('unknown', true, true)).toBe('_folder_open');
    expect(fileIcon('images', true, true)).not.toBe(fileIcon('images', true));
    for (const folder of [
      'docs',
      'images',
      'assets',
      'src',
      'tests',
      'examples',
      'config',
      'scripts',
      'fonts',
    ]) {
      expect(fileIcon(folder, true)).not.toBe(fileIcon('unknown', true));
      expect(fileIcon(folder, true, true)).not.toBe(fileIcon('unknown', true, true));
    }
  });
});

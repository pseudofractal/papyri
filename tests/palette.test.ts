import { expect, it, vi } from 'vitest';
import { fileScore, fuzzyScore, scanDocuments, searchContents } from '../src/lib/palette';
import type { Entry, Source } from '../src/lib/types';

it('matches subsequences and favors file names over matching parent folders', () => {
  expect(fuzzyScore('stg', 'Settings')).not.toBeNull();
  expect(fuzzyScore('xyz', 'Settings')).toBeNull();
  expect(fileScore('readme', 'notes/readme.md')).toBeGreaterThan(
    fileScore('readme', 'readme/notes.md')!,
  );
  expect(fileScore('parts ltsec', 'parts/latex-section.tex')).not.toBeNull();
});

it('searches nested documents, skips symbolic links and reports inaccessible folders', async () => {
  const folders: Record<string, Entry[]> = {
    '/root': [
      { name: 'notes', path: '/root/notes', directory: true },
      { name: 'loop', path: '/root/loop', directory: true, symlink: true },
      { name: 'private', path: '/root/private', directory: true },
      { name: 'a.md', path: '/root/a.md', directory: false },
      { name: 'asset.png', path: '/root/asset.png', directory: false },
    ],
    '/root/notes': [{ name: 'paper.tex', path: '/root/notes/paper.tex', directory: false }],
  };
  const list = vi.fn(async (path: string) => {
    if (!folders[path]) throw new Error('Permission denied');
    return folders[path];
  });
  const source = { list } as unknown as Source;
  const progress = vi.fn();
  await scanDocuments(source, '/root', new AbortController().signal, progress);
  expect(progress).toHaveBeenLastCalledWith({
    paths: ['/root/a.md', '/root/notes/paper.tex'],
    inaccessible: 1,
    truncated: false,
  });
  expect(list).not.toHaveBeenCalledWith('/root/loop');
});

it('does not publish results after cancellation', async () => {
  let finish!: (entries: Entry[]) => void;
  const source = {
    list: () => new Promise<Entry[]>((resolve) => (finish = resolve)),
  } as unknown as Source;
  const progress = vi.fn();
  const controller = new AbortController();
  const scan = scanDocuments(source, '/', controller.signal, progress);
  controller.abort();
  finish([{ name: 'a.md', path: '/a.md', directory: false }]);
  await scan;
  expect(progress).not.toHaveBeenCalled();
});

it('reports when the entry limit prevents a complete search', async () => {
  const entries = Array.from({ length: 20001 }, (_, index) => ({
    name: `${index}.md`,
    path: `/${index}.md`,
    directory: false,
  }));
  const source = { list: async () => entries } as unknown as Source;
  const progress = vi.fn();
  await scanDocuments(source, '/', new AbortController().signal, progress);
  expect(progress.mock.lastCall?.[0]).toMatchObject({ truncated: true });
  expect(progress.mock.lastCall?.[0].paths).toHaveLength(20000);
});

it('searches raw source text without compiling and reports inaccessible files', async () => {
  const readSource = vi.fn(async (path: string) => {
    if (path.endsWith('broken.tex')) throw new Error('Permission denied');
    return { text: 'First line\nA special Needle here\nMore', stamp: '1' };
  });
  const read = vi.fn();
  const source = { readSource, read } as unknown as Source;
  const progress = vi.fn();
  await searchContents(
    source,
    ['/a.typ', '/broken.tex', '/paper.pdf'],
    'needle',
    new AbortController().signal,
    progress,
  );
  expect(progress).toHaveBeenLastCalledWith({
    matches: [{ path: '/a.typ', line: 2, snippet: 'A special Needle here' }],
    inaccessible: 1,
    truncated: false,
  });
  expect(read).not.toHaveBeenCalled();
  expect(readSource).not.toHaveBeenCalledWith('/paper.pdf');
});

it('stops content search and avoids publishing stale results on cancellation', async () => {
  let finish!: (value: { text: string; stamp: string }) => void;
  const source = { read: () => new Promise((resolve) => (finish = resolve)) } as unknown as Source;
  const controller = new AbortController();
  const progress = vi.fn();
  const pending = searchContents(source, ['/a.md'], 'hello', controller.signal, progress);
  controller.abort();
  finish({ text: 'hello', stamp: '1' });
  await pending;
  expect(progress).not.toHaveBeenCalled();
});

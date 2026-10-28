import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MAX_DOCUMENT_BYTES } from '../src/lib/limits';

beforeEach(() => vi.stubGlobal('window', {}));
afterEach(() => vi.unstubAllGlobals());

async function documentSources(file: File) {
  const { importedSource, browserDirectory } = await import('../src/lib/sources');
  Object.defineProperty(file, 'webkitRelativePath', { value: '', configurable: true });
  vi.stubGlobal('window', {
    showDirectoryPicker: async () => ({
      name: 'Test folder',
      getFileHandle: async () => ({ getFile: async () => file }),
    }),
  });
  return [importedSource([file]), await browserDirectory()];
}

it('rejects oversized documents in both browser modes without reading their bytes', async () => {
  const file = new File(['small fixture'], 'large.md');
  Object.defineProperty(file, 'size', { value: MAX_DOCUMENT_BYTES + 1 });
  const read = vi.spyOn(file, 'arrayBuffer');
  for (const source of await documentSources(file))
    await expect(source.read('/large.md')).rejects.toThrow('8 MiB');
  expect(read).not.toHaveBeenCalled();
});

it('retains the byte limit after reading and rejects malformed UTF-8', async () => {
  const file = new File(['small fixture'], 'document.md');
  const read = vi.spyOn(file, 'arrayBuffer');
  read.mockResolvedValue(new ArrayBuffer(MAX_DOCUMENT_BYTES + 1));
  for (const source of await documentSources(file))
    await expect(source.read('/document.md')).rejects.toThrow('8 MiB');
  read.mockResolvedValue(Uint8Array.of(0xff).buffer);
  for (const source of await documentSources(file))
    await expect(source.read('/document.md')).rejects.toThrow();
});

it('reads an in-limit UTF-8 document with its change stamp in both browser modes', async () => {
  const file = new File(['# Mathematics: κ'], 'document.md', { lastModified: 1234 });
  for (const source of await documentSources(file))
    await expect(source.read('/document.md')).resolves.toEqual({
      text: '# Mathematics: κ',
      stamp: `1234:${file.size}`,
    });
});

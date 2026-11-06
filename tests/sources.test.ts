import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MAX_DOCUMENT_BYTES, MAX_PDF_BYTES } from '../src/lib/limits';

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

it('reads PDFs as binary without UTF-8 decoding and enforces the PDF allocation budget', async () => {
  const file = new File([Uint8Array.of(0x25, 0x50, 0x44, 0x46, 0xff)], 'paper.PDF');
  for (const source of await documentSources(file)) {
    const result = await source.read('/paper.PDF');
    expect(result.bytes).toEqual(Uint8Array.of(0x25, 0x50, 0x44, 0x46, 0xff));
    expect(result.text).toBe('');
  }
  Object.defineProperty(file, 'size', { value: MAX_PDF_BYTES + 1 });
  const read = vi.spyOn(file, 'arrayBuffer');
  for (const source of await documentSources(file))
    await expect(source.read('/paper.PDF')).rejects.toThrow('64 MiB');
  expect(read).not.toHaveBeenCalled();
});

it('rejects PDF buffers that grow beyond the limit', async () => {
  const pdf = new File(['small'], 'paper.pdf');
  vi.spyOn(pdf, 'arrayBuffer').mockResolvedValue(new ArrayBuffer(MAX_PDF_BYTES + 1));
  for (const source of await documentSources(pdf))
    await expect(source.read('/paper.pdf')).rejects.toThrow('64 MiB');
});

it.each([
  ['paper.typ', '= Heading'],
  ['paper.tex', '\\section{Heading}'],
])('opens %s as source in both browser modes', async (name, text) => {
  const file = new File([text], name);
  for (const source of await documentSources(file))
    await expect(source.read('/' + name)).resolves.toMatchObject({
      text,
      compilationError: expect.stringContaining('requires the Linux app'),
    });
});

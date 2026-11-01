import { afterEach, expect, it, vi } from 'vitest';
import { defaults } from '../src/lib/preferences';

const invokeHost = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/native', () => ({ invokeHost }));

afterEach(() => {
  vi.unstubAllGlobals();
  invokeHost.mockReset();
});

it('does not accept a PDF compiled using superseded engine settings', async () => {
  vi.stubGlobal('window', {});
  let complete!: (bytes: ArrayBuffer) => void;
  invokeHost.mockImplementation(async (command: string) => {
    if (command === 'initial_path') return { path: '/', directory: true };
    if (command === 'document_stamp') return 'source-stamp';
    if (command === 'read_pdf') return new Promise<ArrayBuffer>((resolve) => (complete = resolve));
    if (command === 'read_document') return { text: 'source', stamp: 'source-stamp' };
    throw new Error(`Unexpected command: ${command}`);
  });
  const { desktopSource } = await import('../src/lib/sources');
  const preferences = structuredClone(defaults);
  const { source } = await desktopSource(() => preferences);
  const read = source.read('/paper.tex');
  await vi.waitFor(() => expect(complete).toBeDefined());
  preferences.latexEngine = 'xelatex';
  complete(Uint8Array.of(37, 80, 68, 70).buffer);
  await expect(read).resolves.toMatchObject({
    text: 'source',
    compilationError: expect.stringContaining('settings changed during compilation'),
  });
});

it('uses the selected engine and changes the live stamp when compiler settings change', async () => {
  vi.stubGlobal('window', {});
  invokeHost.mockImplementation(async (command: string) => {
    if (command === 'initial_path') return { path: '/', directory: true };
    if (command === 'document_stamp') return 'source-stamp';
    if (command === 'read_pdf') return Uint8Array.of(37, 80, 68, 70).buffer;
    throw new Error(`Unexpected command: ${command}`);
  });
  const { desktopSource } = await import('../src/lib/sources');
  const preferences = structuredClone(defaults);
  const { source } = await desktopSource(() => preferences);
  const first = await source.read('/paper.tex');
  expect(invokeHost).toHaveBeenCalledWith('read_pdf', {
    path: '/paper.tex',
    engine: 'lualatex',
    compilerPath: '',
  });
  expect(await source.stamp!('/paper.tex')).toBe(first.stamp);
  preferences.latexEngine = 'xelatex';
  preferences.latexPaths.xelatex = '/opt/tex/bin/xelatex';
  expect(await source.stamp!('/paper.tex')).not.toBe(first.stamp);
  await source.read('/paper.tex');
  expect(invokeHost).toHaveBeenLastCalledWith('document_stamp', { path: '/paper.tex' });
  expect(invokeHost).toHaveBeenCalledWith('read_pdf', {
    path: '/paper.tex',
    engine: 'xelatex',
    compilerPath: '/opt/tex/bin/xelatex',
  });
});

it('uses the configured Typst binary and refreshes when its path changes', async () => {
  vi.stubGlobal('window', {});
  invokeHost.mockImplementation(async (command: string) => {
    if (command === 'initial_path') return { path: '/', directory: true };
    if (command === 'document_stamp') return 'source-stamp';
    if (command === 'read_pdf') return Uint8Array.of(37, 80, 68, 70).buffer;
    throw new Error(`Unexpected command: ${command}`);
  });
  const { desktopSource } = await import('../src/lib/sources');
  const preferences = structuredClone(defaults);
  const { source } = await desktopSource(() => preferences);
  const first = await source.read('/paper.typ');
  expect(await source.stamp!('/paper.typ')).toBe(first.stamp);
  preferences.typstPath = '/opt/typst/bin/typst';
  expect(await source.stamp!('/paper.typ')).not.toBe(first.stamp);
  await source.read('/paper.typ');
  expect(invokeHost).toHaveBeenCalledWith('read_pdf', {
    path: '/paper.typ',
    engine: 'lualatex',
    compilerPath: '/opt/typst/bin/typst',
  });
});

it('rejects a Typst preview compiled with an outdated path', async () => {
  vi.stubGlobal('window', {});
  let complete!: (bytes: ArrayBuffer) => void;
  invokeHost.mockImplementation(async (command: string) => {
    if (command === 'initial_path') return { path: '/', directory: true };
    if (command === 'document_stamp') return 'source-stamp';
    if (command === 'read_pdf') return new Promise<ArrayBuffer>((resolve) => (complete = resolve));
    if (command === 'read_document') return { text: 'source', stamp: 'source-stamp' };
    throw new Error(`Unexpected command: ${command}`);
  });
  const { desktopSource } = await import('../src/lib/sources');
  const preferences = structuredClone(defaults);
  const { source } = await desktopSource(() => preferences);
  const read = source.read('/paper.typ');
  await vi.waitFor(() => expect(complete).toBeDefined());
  preferences.typstPath = '/opt/typst/bin/typst';
  complete(Uint8Array.of(37, 80, 68, 70).buffer);
  await expect(read).resolves.toMatchObject({
    text: 'source',
    compilationError: expect.stringContaining('Typst compiler settings changed'),
  });
});

it.each(['/paper.typ', '/paper.tex'])(
  'rejects %s when its source changes during compilation',
  async (path) => {
    vi.stubGlobal('window', {});
    let sourceStamp = 'old';
    invokeHost.mockImplementation(async (command: string) => {
      if (command === 'initial_path') return { path: '/', directory: true };
      if (command === 'document_stamp') return sourceStamp;
      if (command === 'read_document') return { text: 'new source', stamp: sourceStamp };
      if (command === 'read_pdf') {
        sourceStamp = 'new';
        return Uint8Array.of(37, 80, 68, 70).buffer;
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    const { desktopSource } = await import('../src/lib/sources');
    const { source } = await desktopSource(() => structuredClone(defaults));
    await expect(source.read(path)).resolves.toMatchObject({
      text: 'new source',
      compilationError: expect.stringContaining('Document changed during compilation'),
    });
  },
);

it('accepts a build when the discovered dependency list changes but the source does not', async () => {
  vi.stubGlobal('window', {});
  let stamp = 'source';
  invokeHost.mockImplementation(async (command: string) => {
    if (command === 'initial_path') return { path: '/', directory: true };
    if (command === 'document_stamp') return stamp;
    if (command === 'read_pdf') {
      stamp = 'source|dependency:stamp';
      return Uint8Array.of(37, 80, 68, 70).buffer;
    }
    throw new Error(`Unexpected command: ${command}`);
  });
  const { desktopSource } = await import('../src/lib/sources');
  const { source } = await desktopSource(() => structuredClone(defaults));
  await expect(source.read('/paper.typ')).resolves.toMatchObject({
    stamp: 'source|dependency:stamp|',
  });
});

it.each(['/paper.typ', '/paper.tex'])('shows %s source when compilation fails', async (path) => {
  vi.stubGlobal('window', {});
  invokeHost.mockImplementation(async (command: string) => {
    if (command === 'initial_path') return { path: '/', directory: true };
    if (command === 'document_stamp') return 'stamp';
    if (command === 'read_pdf') throw new Error('Compiler unavailable');
    if (command === 'read_document') return { text: 'source text', stamp: 'stamp' };
    throw new Error(`Unexpected command: ${command}`);
  });
  const { desktopSource } = await import('../src/lib/sources');
  const { source } = await desktopSource(() => structuredClone(defaults));
  await expect(source.read(path)).resolves.toMatchObject({
    text: 'source text',
    compilationError: expect.stringContaining('Compiler unavailable'),
    retryCompilation: true,
  });
});

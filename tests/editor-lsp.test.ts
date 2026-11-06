import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectEditorLanguageServer, fileUri } from '../src/lib/editor-lsp';

afterEach(() => vi.unstubAllGlobals());

describe('language-server file URIs', () => {
  it('encodes spaces, fragments, percent signs, and Unicode in paths', () => {
    expect(fileUri('/work/a #1/数学%.typ')).toBe('file:///work/a%20%231/%E6%95%B0%E5%AD%A6%25.typ');
  });

  it('rejects relative paths', () => {
    expect(() => fileUri('relative.md')).toThrow('absolute');
  });
});

it('stops a server before waiting for a blocked write', async () => {
  let releaseWrite: (() => void) | undefined;
  const invoke = vi.fn((command: string) => {
    if (command === 'lsp_start') return Promise.resolve(1);
    if (command === 'lsp_send') return new Promise<void>((resolve) => (releaseWrite = resolve));
    if (command === 'lsp_stop') {
      releaseWrite?.();
      return Promise.resolve();
    }
    throw new Error(`Unexpected command: ${command}`);
  });
  vi.stubGlobal('window', {
    __PAPYRI_HOST_TOKEN__: 'test',
    __TAURI_INTERNALS__: { invoke, transformCallback: () => 1 },
  });
  const connection = await connectEditorLanguageServer('markdown', '/project', () => {});
  await vi.waitFor(() =>
    expect(invoke.mock.calls.some(([command]) => command === 'lsp_send')).toBe(true),
  );
  await expect(connection.close()).resolves.toBeUndefined();
  expect(invoke.mock.calls.some(([command]) => command === 'lsp_stop')).toBe(true);
});

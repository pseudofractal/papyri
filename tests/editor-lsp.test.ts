import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  connectEditorLanguageServer,
  fileUri,
  parseDiagnosticsMessage,
} from '../src/lib/editor-lsp';

afterEach(() => vi.unstubAllGlobals());

describe('language-server file URIs', () => {
  it('encodes spaces, fragments, percent signs, and Unicode in paths', () => {
    expect(fileUri('/work/a #1/数学%.typ')).toBe('file:///work/a%20%231/%E6%95%B0%E5%AD%A6%25.typ');
  });

  it('rejects relative paths', () => {
    expect(() => fileUri('relative.md')).toThrow('absolute');
  });

  it('round-trips Windows drive paths without a leading slash', () => {
    const uri = fileUri('C:/papers/paper.tex');
    expect(uri).toBe('file:///C%3A/papers/paper.tex');
    const message = JSON.stringify({
      method: 'textDocument/publishDiagnostics',
      params: {
        uri,
        diagnostics: [{ range: { start: { line: 1, character: 0 } }, message: 'Missing brace' }],
      },
    });
    expect(parseDiagnosticsMessage(message)?.path).toBe('C:/papers/paper.tex');
  });
});

describe('language-server diagnostics', () => {
  it('parses publishDiagnostics ranges and severity', () => {
    const message = JSON.stringify({
      method: 'textDocument/publishDiagnostics',
      params: {
        uri: fileUri('/work/paper.tex'),
        diagnostics: [
          {
            range: {
              start: { line: 3, character: 2 },
              end: { line: 3, character: 8 },
            },
            severity: 1,
            message: 'Undefined control sequence',
            source: 'texlab',
          },
          {
            range: { start: { line: 5, character: 0 } },
            message: 'Missing brace',
          },
          { message: 'No range' },
        ],
      },
    });
    expect(parseDiagnosticsMessage(message)).toEqual({
      path: '/work/paper.tex',
      diagnostics: [
        {
          path: '/work/paper.tex',
          line: 3,
          character: 2,
          endLine: 3,
          endCharacter: 8,
          severity: 1,
          message: 'Undefined control sequence',
          source: 'texlab',
        },
        {
          path: '/work/paper.tex',
          line: 5,
          character: 0,
          endLine: 5,
          endCharacter: 0,
          severity: 3,
          message: 'Missing brace',
        },
      ],
    });
  });

  it('ignores other messages and malformed JSON', () => {
    expect(parseDiagnosticsMessage('not json')).toBeNull();
    expect(
      parseDiagnosticsMessage(JSON.stringify({ method: 'textDocument/publishDiagnostics' })),
    ).toBeNull();
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
  const connection = await connectEditorLanguageServer(
    'markdown',
    '/project',
    '/opt/marksman',
    () => {},
  );
  expect(invoke).toHaveBeenCalledWith(
    'lsp_start',
    expect.objectContaining({
      language: 'markdown',
      directory: '/project',
      serverPath: '/opt/marksman',
    }),
    undefined,
  );
  await vi.waitFor(() =>
    expect(invoke.mock.calls.some(([command]) => command === 'lsp_send')).toBe(true),
  );
  await expect(connection.close()).resolves.toBeUndefined();
  expect(invoke.mock.calls.some(([command]) => command === 'lsp_stop')).toBe(true);
});

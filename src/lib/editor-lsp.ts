import { Channel } from '@tauri-apps/api/core';
import {
  LSPClient,
  findReferencesKeymap,
  formatKeymap,
  hoverTooltips,
  jumpToDefinitionKeymap,
  renameKeymap,
  serverDiagnostics,
  signatureHelp,
  type Transport,
} from '@codemirror/lsp-client';
import { keymap } from '@codemirror/view';
import type { CompletionSource } from '@codemirror/autocomplete';
import { completionSource } from './completion-details';
import DOMPurify from 'dompurify';
import { invokeHost } from './native';
import { isAbsolutePath } from './paths';

export type EditorLanguage = 'markdown' | 'typst' | 'latex';
export interface LspDiagnostic {
  path: string;
  line: number;
  character: number;
  endLine: number;
  endCharacter: number;
  severity: 1 | 2 | 3 | 4;
  message: string;
  source?: string;
}
type ServerEvent = { type: 'message' | 'closed'; value: string };

/** Convert an absolute filesystem path into an encoded file URI. */
export function fileUri(path: string): string {
  if (!isAbsolutePath(path)) throw new Error('Language servers require an absolute file path.');
  const windowsDrive = /^[A-Za-z]:\//.test(path);
  return `file://${windowsDrive ? '/' : ''}${path.split('/').map(encodeURIComponent).join('/')}`;
}

/** Parse one LSP JSON-RPC message when it publishes diagnostics. */
export function parseDiagnosticsMessage(
  message: string,
): { path: string; diagnostics: LspDiagnostic[] } | null {
  try {
    const parsed = JSON.parse(message) as {
      method?: string;
      params?: {
        uri?: string;
        diagnostics?: {
          range?: {
            start?: { line?: number; character?: number };
            end?: { line?: number; character?: number };
          };
          severity?: number;
          message?: string;
          source?: string;
        }[];
      };
    };
    if (parsed.method !== 'textDocument/publishDiagnostics' || !parsed.params?.uri) return null;
    let path = decodeURIComponent(new URL(parsed.params.uri).pathname);
    if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1);
    const diagnostics: LspDiagnostic[] = [];
    for (const item of (parsed.params.diagnostics ?? []).slice(0, 2000)) {
      const severity = item.severity;
      if (
        typeof item.message !== 'string' ||
        !item.range?.start ||
        !Number.isInteger(item.range.start.line) ||
        !Number.isInteger(item.range.start.character)
      )
        continue;
      diagnostics.push({
        path,
        line: item.range.start.line!,
        character: item.range.start.character!,
        endLine: Number.isInteger(item.range.end?.line)
          ? item.range.end!.line!
          : item.range.start.line!,
        endCharacter: Number.isInteger(item.range.end?.character)
          ? item.range.end!.character!
          : item.range.start.character!,
        severity:
          severity === 1 || severity === 2 || severity === 3 || severity === 4 ? severity : 3,
        message: item.message.slice(0, 10_000),
        ...(typeof item.source === 'string' ? { source: item.source.slice(0, 200) } : {}),
      });
    }
    return { path, diagnostics };
  } catch {
    return null;
  }
}

/** Connect a local language server to CodeMirror until the returned close function is called. */
export async function connectEditorLanguageServer(
  language: EditorLanguage,
  directory: string,
  serverPath: string,
  onError: (message: string) => void,
  onPreviewJump?: (location: unknown) => void,
  onDiagnostics?: (diagnostics: LspDiagnostic[]) => void,
): Promise<{ client: LSPClient; completions: CompletionSource; close: () => Promise<void> }> {
  const handlers = new Set<(message: string) => void>();
  let closed = false;
  let closeReason = '';
  const server: { id?: number } = {};
  let queue = Promise.resolve();
  const client = new LSPClient({
    rootUri: fileUri(directory),
    ...(onPreviewJump
      ? {
          initializationOptions: { customizedShowDocument: true },
          timeout: 30000,
          notificationHandlers: {
            'tinymist/preview/scrollSource': (_client: LSPClient, value: unknown) => {
              onPreviewJump(value);
              return true;
            },
          },
        }
      : {}),
    extensions: [
      hoverTooltips(),
      keymap.of([
        ...formatKeymap,
        ...renameKeymap,
        ...jumpToDefinitionKeymap,
        ...findReferencesKeymap,
      ]),
      signatureHelp(),
      serverDiagnostics(),
    ],
    sanitizeHTML: (html) => DOMPurify.sanitize(html),
  });
  const completions = completionSource(client, language);
  const events = new Channel<ServerEvent>((event) => {
    if (closed) return;
    if (event.type === 'message') {
      if (onDiagnostics) {
        const published = parseDiagnosticsMessage(event.value);
        if (published) onDiagnostics(published.diagnostics);
      }
      for (const handler of handlers) handler(event.value);
    } else {
      closed = true;
      closeReason = event.value;
      if (client.connected) client.disconnect();
      onError(event.value);
      if (server.id !== undefined)
        void invokeHost('lsp_stop', { id: server.id }).catch((error: unknown) =>
          onError(String(error)),
        );
    }
  });
  const id = await invokeHost<number>('lsp_start', { language, directory, serverPath, events });
  server.id = id;
  if (closed) {
    await invokeHost('lsp_stop', { id });
    throw new Error(closeReason);
  }
  const transport: Transport = {
    send(message) {
      if (closed) throw new Error('The language server is disconnected.');
      queue = queue
        .then(() => invokeHost<void>('lsp_send', { id, message }))
        .catch((error: unknown) => {
          if (!closed) {
            closed = true;
            client.disconnect();
            onError(String(error));
            void invokeHost('lsp_stop', { id }).catch((stopError: unknown) =>
              onError(String(stopError)),
            );
          }
        });
    },
    subscribe(handler) {
      handlers.add(handler);
    },
    unsubscribe(handler) {
      handlers.delete(handler);
    },
  };
  client.connect(transport);
  return {
    client,
    completions,
    async close() {
      closed = true;
      client.disconnect();
      // Stop the process first: a queued write may be blocked on its stdin.
      await invokeHost('lsp_stop', { id });
      await queue;
    },
  };
}

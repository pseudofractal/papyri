import { Channel } from '@tauri-apps/api/core';
import { LSPClient, languageServerExtensions, type Transport } from '@codemirror/lsp-client';
import DOMPurify from 'dompurify';
import { invokeHost } from './native';

export type EditorLanguage = 'markdown' | 'typst' | 'latex';
type ServerEvent = { type: 'message' | 'closed'; value: string };

/** Convert an absolute filesystem path into an encoded file URI. */
export function fileUri(path: string): string {
  if (!path.startsWith('/')) throw new Error('Language servers require an absolute file path.');
  return `file://${path.split('/').map(encodeURIComponent).join('/')}`;
}

/** Connect a local language server to CodeMirror until the returned close function is called. */
export async function connectEditorLanguageServer(
  language: EditorLanguage,
  directory: string,
  onError: (message: string) => void,
): Promise<{ client: LSPClient; close: () => Promise<void> }> {
  const handlers = new Set<(message: string) => void>();
  let closed = false;
  let closeReason = '';
  const server: { id?: number } = {};
  let queue = Promise.resolve();
  const client = new LSPClient({
    rootUri: fileUri(directory),
    extensions: languageServerExtensions(),
    sanitizeHTML: (html) => DOMPurify.sanitize(html),
  });
  const events = new Channel<ServerEvent>((event) => {
    if (closed) return;
    if (event.type === 'message') {
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
  const id = await invokeHost<number>('lsp_start', { language, directory, events });
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
    async close() {
      closed = true;
      client.disconnect();
      // Stop the process first: a queued write may be blocked on its stdin.
      await invokeHost('lsp_stop', { id });
      await queue;
    },
  };
}

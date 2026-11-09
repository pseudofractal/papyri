import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { createMutationQueue } from './control-queue';
import { invokeHost } from './native';

interface ControlRequest {
  id: number;
  method: string;
  params?: Record<string, unknown>;
  deadline?: number;
}

export type ControlExecutor = (method: string, params: Record<string, unknown>) => Promise<unknown>;

/**
 * Receive control requests from the native socket and answer them. The listener
 * is installed before `control_ready`, so startup requests cannot be lost.
 */
export async function installControl(execute: ControlExecutor): Promise<UnlistenFn> {
  const readOnly = new Set([
    'state',
    'headings',
    'commands',
    'editor.get',
    'explorer.list',
    'note.get',
    'selection.get',
    'dom.query',
    'dom.get',
    'screenshot',
    'clipboard.get',
    'window.list',
    'window.capture',
  ]);
  const viewMethods = new Set([
    'theme',
    'zoom',
    'fit-width',
    'decorationless',
    'preferences.set',
    'search',
    'panel',
    'note.set',
    'trust',
    'right.tab',
    'browser.navigate',
    'browser.back',
    'browser.forward',
    'browser.reload',
    'browser.stop',
    'browser.zoom',
    'browser.window',
    'browser.quote',
    'browser.search',
    'live-preview',
    'live-preview.zoom',
    'live-preview.fit',
    'selection.copy',
    'document.copy',
    'settings.tab',
    'clipboard.set',
    'window.focus',
  ]);
  const toolMethods = new Set(['tools.install', 'tools.texlive']);
  const documentMethods = new Set([
    'open',
    'close',
    'focus',
    'tab.next',
    'tab.previous',
    'tab.activate',
    'tab.close',
    'scroll.to',
    'scroll.by',
    'scroll.top',
    'scroll.bottom',
    'heading',
    'page',
    'pdf.password',
    'command',
    'refresh',
    'editor.open',
    'editor.close',
    'editor.toggle',
    'editor.save',
    'editor.reload',
    'editor.discard',
    'editor.set',
    'editor.reveal',
    'editor.sync',
    'explorer.cwd',
    'explorer.expand',
    'explorer.collapse',
    'explorer.select',
    'explorer.create',
    'explorer.rename',
    'explorer.delete',
    'search.next',
    'search.previous',
    'dom.focus',
    'dom.click',
    'dom.type',
    'input.move',
    'input.click',
    'input.drag',
    'input.scroll',
    'input.key',
    'input.type',
  ]);
  // Document and view mutations use separate queues: opening a slow document
  // must not block theme, zoom, settings, or panel changes.
  const enqueueDocument = createMutationQueue();
  const enqueueView = createMutationQueue();
  const enqueueTool = createMutationQueue();
  const dispatch = (method: string, params: Record<string, unknown>, deadline?: number) => {
    if (readOnly.has(method)) return execute(method, params);
    const isDocument =
      documentMethods.has(method) ||
      (method === 'panel' && params.name === 'split') ||
      (!viewMethods.has(method) && !toolMethods.has(method) && method !== 'panel');
    const enqueue = toolMethods.has(method)
      ? enqueueTool
      : isDocument
        ? enqueueDocument
        : enqueueView;
    return enqueue(() => execute(method, params), deadline);
  };
  return listen<ControlRequest>('papyri-control-request', (event) => {
    const { id, method, params, deadline } = event.payload;
    void (async () => {
      try {
        const result = await dispatch(method, params ?? {}, deadline);
        await invokeHost('control_respond', { id, ok: true, result: result ?? null });
      } catch (error) {
        await invokeHost('control_respond', {
          id,
          ok: false,
          result: null,
          error: error instanceof Error ? error.message : String(error),
        }).catch(() => {});
      }
    })();
  });
}

/** Mark the host ready for control requests after startup has settled. */
export async function markControlReady() {
  await invokeHost('control_ready');
}

/** Publish a state change to subscribed control clients. */
export function publishControlEvent(event: string, data: unknown) {
  void invokeHost('control_emit', { event, data }).catch(() => {});
}

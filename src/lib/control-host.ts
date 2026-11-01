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
  const readOnly = new Set(['state', 'headings', 'commands']);
  const viewMethods = new Set(['theme', 'zoom', 'fit-width', 'preferences.set', 'search']);
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
    'command',
    'refresh',
  ]);
  // Document and view mutations use separate queues: opening a slow document
  // must not block theme, zoom, settings, or panel changes.
  const enqueueDocument = createMutationQueue();
  const enqueueView = createMutationQueue();
  const dispatch = (method: string, params: Record<string, unknown>, deadline?: number) => {
    if (readOnly.has(method)) return execute(method, params);
    const isDocument =
      documentMethods.has(method) ||
      (method === 'panel' && params.name === 'split') ||
      (!viewMethods.has(method) && method !== 'panel');
    const enqueue = isDocument ? enqueueDocument : enqueueView;
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

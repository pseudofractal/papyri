import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invokeHost } from './native';

interface ControlRequest {
  id: number;
  method: string;
  params?: Record<string, unknown>;
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
  let documentMutations = Promise.resolve();
  let viewMutations = Promise.resolve();
  const enqueue = (queue: 'document' | 'view', operation: () => Promise<unknown>) => {
    const current = queue === 'document' ? documentMutations : viewMutations;
    const task = current.then(operation);
    const settled = task.then(
      () => undefined,
      () => undefined,
    );
    if (queue === 'document') documentMutations = settled;
    else viewMutations = settled;
    return task;
  };
  const dispatch = (method: string, params: Record<string, unknown>) => {
    if (readOnly.has(method)) return execute(method, params);
    const isDocument =
      documentMethods.has(method) ||
      (method === 'panel' && params.name === 'split') ||
      (!viewMethods.has(method) && method !== 'panel');
    return enqueue(isDocument ? 'document' : 'view', () => execute(method, params));
  };
  return listen<ControlRequest>('papyri-control-request', (event) => {
    const { id, method, params } = event.payload;
    void (async () => {
      try {
        const result = await dispatch(method, params ?? {});
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

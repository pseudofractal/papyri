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
  return listen<ControlRequest>('papyri-control-request', (event) => {
    const { id, method, params } = event.payload;
    void (async () => {
      try {
        const result = await execute(method, params ?? {});
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

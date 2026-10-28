import { RenderCache } from './cache';
const cache = new RenderCache();
import type { Delimiter, Rendered } from '../lib/types';
/** A fresh worker bounds memory and lets navigation cancel pathological parsing. */
export function parseDocument(
  text: string,
  signal: AbortSignal,
  delimiters: Delimiter[],
): Promise<Rendered> {
  if (signal.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
  const key = JSON.stringify(delimiters) + '\0' + text;
  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./markdown.worker.ts', import.meta.url), { type: 'module' });
    const finish = () => {
      clearTimeout(timeout);
      worker.terminate();
      signal.removeEventListener('abort', abort);
    };
    const abort = () => {
      finish();
      reject(new DOMException('Cancelled', 'AbortError'));
    };
    const timeout = setTimeout(() => {
      finish();
      reject(new Error('Rendering exceeded 15 seconds. Try a smaller document.'));
    }, 15_000);
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event) => {
      finish();
      if (event.data.error) reject(new Error(event.data.error));
      else {
        cache.set(key, event.data.result);
        resolve(event.data.result);
      }
    };
    worker.onerror = (event) => {
      finish();
      reject(new Error(event.message));
    };
    worker.postMessage({ text, delimiters });
    if (signal.aborted) abort();
  });
}

import { RenderCache } from './cache';
const cache = new RenderCache();
import type { Delimiter, Rendered } from '../lib/types';
const PREWARM_TIMEOUT_MS = 15_000;
let prewarmedWorker: Worker | undefined;
let prewarmTimeout: ReturnType<typeof setTimeout> | undefined;

function newParserWorker() {
  return new Worker(new URL('./markdown.worker.ts', import.meta.url), { type: 'module' });
}

/** Start loading the parser while the initial Markdown file is being opened. */
export function prewarmDocumentParser() {
  if (prewarmedWorker) return;
  try {
    const worker = newParserWorker();
    prewarmedWorker = worker;
    const discard = () => {
      if (prewarmedWorker !== worker) return;
      clearTimeout(prewarmTimeout);
      prewarmedWorker = undefined;
      worker.terminate();
    };
    worker.onerror = discard;
    prewarmTimeout = setTimeout(discard, PREWARM_TIMEOUT_MS);
  } catch (error) {
    console.error('Could not prewarm the Markdown parser:', error);
  }
}

function takeParserWorker() {
  const worker = prewarmedWorker;
  prewarmedWorker = undefined;
  clearTimeout(prewarmTimeout);
  return worker || newParserWorker();
}
/** A fresh worker bounds memory and lets navigation cancel pathological parsing. */
export function parseDocument(
  text: string,
  signal: AbortSignal,
  delimiters: Delimiter[],
  language?: 'typst' | 'latex',
): Promise<Rendered> {
  if (signal.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
  const key = (language || 'markdown') + '\0' + JSON.stringify(delimiters) + '\0' + text;
  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve, reject) => {
    const worker = takeParserWorker();
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
    worker.postMessage({ text, delimiters, language });
    if (signal.aborted) abort();
  });
}

import type { ScrollTarget } from './control';
import {
  PREVIEW_POLL_MS,
  PREVIEW_READY_TIMEOUT_MS,
  PREVIEW_RETRY_DELAY_MS,
  PREVIEW_RETRY_TIMEOUT_MS,
} from './control-timings';
import { MAX_SCROLL_POSITION } from './view';

/** Raised when the preview frame exists but is not ready to accept a scroll. */
export class PreviewNotReadyError extends Error {
  constructor(message = 'The preview is not ready yet.') {
    super(message);
    this.name = 'PreviewNotReadyError';
  }
}

export interface PreviewControls {
  scrollTo(y: number): Promise<number>;
  scrollBy(dy: number): Promise<number>;
  revealSource(line: number, align?: 'center' | 'top'): Promise<number>;
  documentPath(): string;
}

/** Wait until the mounted preview belongs to the requested pane document. */
export async function waitForPreview(
  expectedPath: () => string,
  candidate: () => PreviewControls | undefined,
  emptyMessage: string,
): Promise<PreviewControls> {
  const deadline = Date.now() + PREVIEW_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const expected = expectedPath();
    if (!expected) throw new Error(emptyMessage);
    const preview = candidate();
    if (preview?.documentPath() === expected) return preview;
    await new Promise((resolve) => setTimeout(resolve, PREVIEW_POLL_MS));
  }
  throw new Error('The preview is not ready yet.');
}

/** Retry a preview operation while its frame reports that it is not ready. */
async function retryWhileNotReady<T>(operation: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + PREVIEW_RETRY_TIMEOUT_MS;
  for (;;) {
    try {
      return await operation();
    } catch (error) {
      const waiting = error instanceof PreviewNotReadyError;
      if (!waiting || Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, PREVIEW_RETRY_DELAY_MS));
    }
  }
}

/** Scroll a preview, retrying while its frame finishes rendering. */
export async function scrollPreview(
  preview: PreviewControls,
  target: ScrollTarget,
): Promise<number> {
  return retryWhileNotReady(async () => {
    if ('y' in target) return preview.scrollTo(target.y);
    if ('dy' in target) return preview.scrollBy(target.dy);
    if ('top' in target) return preview.scrollTo(0);
    return preview.scrollTo(MAX_SCROLL_POSITION);
  });
}

/** Reveal a source line, retrying while the preview frame re-renders. */
export async function revealPreview(
  preview: PreviewControls,
  line: number,
  align: 'center' | 'top',
): Promise<number> {
  return retryWhileNotReady(() => preview.revealSource(line, align));
}

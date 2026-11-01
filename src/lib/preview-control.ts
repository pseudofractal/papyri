import type { ScrollTarget } from './control';
import {
  PREVIEW_POLL_MS,
  PREVIEW_READY_TIMEOUT_MS,
  SCROLL_RETRY_DELAY_MS,
  SCROLL_RETRY_TIMEOUT_MS,
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

/** Scroll a preview, retrying while its frame finishes rendering. */
export async function scrollPreview(
  preview: PreviewControls,
  target: ScrollTarget,
): Promise<number> {
  const deadline = Date.now() + SCROLL_RETRY_TIMEOUT_MS;
  for (;;) {
    try {
      if ('y' in target) return await preview.scrollTo(target.y);
      if ('dy' in target) return await preview.scrollBy(target.dy);
      if ('top' in target) return await preview.scrollTo(0);
      return await preview.scrollTo(MAX_SCROLL_POSITION);
    } catch (error) {
      const waiting = error instanceof PreviewNotReadyError;
      if (!waiting || Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, SCROLL_RETRY_DELAY_MS));
    }
  }
}

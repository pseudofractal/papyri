import { describe, expect, it, vi } from 'vitest';
import {
  PreviewNotReadyError,
  revealPreview,
  scrollPreview,
  waitForPreview,
  type PreviewControls,
} from '../src/lib/preview-control';
import { MAX_SCROLL_POSITION } from '../src/lib/view';

function preview(overrides: Partial<PreviewControls> = {}): PreviewControls {
  return {
    documentPath: () => '/notes.md',
    scrollTo: vi.fn(async (y: number) => y),
    scrollBy: vi.fn(async (dy: number) => dy),
    revealSource: vi.fn(async () => 12),
    ...overrides,
  };
}

describe('preview control retries', () => {
  it('retries a reveal while the frame is re-rendering', async () => {
    const revealSource = vi
      .fn<PreviewControls['revealSource']>()
      .mockRejectedValueOnce(new PreviewNotReadyError())
      .mockResolvedValueOnce(42);
    await expect(revealPreview(preview({ revealSource }), 7, 'top')).resolves.toBe(42);
    expect(revealSource).toHaveBeenNthCalledWith(1, 7, 'top');
    expect(revealSource).toHaveBeenNthCalledWith(2, 7, 'top');
  });

  it('does not retry unrelated reveal failures', async () => {
    const revealSource = vi
      .fn<PreviewControls['revealSource']>()
      .mockRejectedValue(new Error('broken frame'));
    await expect(revealPreview(preview({ revealSource }), 7, 'center')).rejects.toThrow(
      'broken frame',
    );
    expect(revealSource).toHaveBeenCalledTimes(1);
  });

  it('maps scroll targets and retries readiness', async () => {
    const scrollTo = vi
      .fn<PreviewControls['scrollTo']>()
      .mockRejectedValueOnce(new PreviewNotReadyError())
      .mockResolvedValue(300);
    const controls = preview({ scrollTo });
    await expect(scrollPreview(controls, { top: true })).resolves.toBe(300);
    expect(scrollTo).toHaveBeenNthCalledWith(1, 0);
    expect(scrollTo).toHaveBeenNthCalledWith(2, 0);

    const scrollBy = vi.fn(async (dy: number) => dy);
    await expect(scrollPreview(preview({ scrollBy }), { dy: -40 })).resolves.toBe(-40);
    expect(scrollBy).toHaveBeenCalledWith(-40);

    const bottomTo = vi.fn(async (y: number) => y);
    await expect(scrollPreview(preview({ scrollTo: bottomTo }), { bottom: true })).resolves.toBe(
      MAX_SCROLL_POSITION,
    );
    expect(bottomTo).toHaveBeenCalledWith(MAX_SCROLL_POSITION);
  });

  it('does not retry unrelated scroll failures', async () => {
    const scrollTo = vi
      .fn<PreviewControls['scrollTo']>()
      .mockRejectedValueOnce(new Error('frame detached'));
    await expect(scrollPreview(preview({ scrollTo }), { y: 10 })).rejects.toThrow('frame detached');
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it('waits for the expected document and reports empty panes', async () => {
    const controls = preview();
    await expect(
      waitForPreview(
        () => '/notes.md',
        () => controls,
        'empty pane',
      ),
    ).resolves.toBe(controls);
    await expect(
      waitForPreview(
        () => '',
        () => undefined,
        'empty pane',
      ),
    ).rejects.toThrow('empty pane');

    let candidate: PreviewControls | undefined;
    const pending = waitForPreview(
      () => '/notes.md',
      () => candidate,
      'empty pane',
    );
    setTimeout(() => {
      candidate = preview();
    }, 30);
    const resolved = await pending;
    expect(resolved).toBe(candidate);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn();

  constructor() {
    FakeWorker.instances.push(this);
  }
}

afterEach(() => {
  FakeWorker.instances = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('parser prewarming', () => {
  it('uses the prewarmed worker once and still terminates it after parsing', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const { prewarmDocumentParser, parseDocument } = await import('../src/render/client');
    prewarmDocumentParser();
    prewarmDocumentParser();
    const result = { html: '<p>hello</p>', headings: [], elapsed: 1 };
    const parsing = parseDocument('hello', new AbortController().signal, []);
    expect(FakeWorker.instances).toHaveLength(1);
    const worker = FakeWorker.instances[0];
    worker.onmessage?.({ data: { result } });
    await expect(parsing).resolves.toEqual(result);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('discards a failed or unused warm worker and creates a fresh worker on demand', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('Worker', FakeWorker);
    const { prewarmDocumentParser, parseDocument } = await import('../src/render/client');
    prewarmDocumentParser();
    FakeWorker.instances[0].onerror?.({ message: 'failed' });
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
    prewarmDocumentParser();
    vi.advanceTimersByTime(15_000);
    expect(FakeWorker.instances[1].terminate).toHaveBeenCalledOnce();
    const controller = new AbortController();
    const parsing = parseDocument('hello', controller.signal, []);
    const assertion = expect(parsing).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeWorker.instances).toHaveLength(3);
    controller.abort();
    await assertion;
    expect(FakeWorker.instances[2].terminate).toHaveBeenCalledOnce();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('bundled PDF resources', () => {
  it('allows only manifest entries and shares successful resource loads', async () => {
    const fetchResource = vi.fn(async (url: URL) =>
      url.pathname.endsWith('pdf-resources.json')
        ? { ok: true, json: async () => ['Example.bcmap'] }
        : { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer },
    );
    vi.stubGlobal('location', { href: 'http://localhost/app/' });
    vi.stubGlobal('fetch', fetchResource);
    const { loadPdfResource } = await import('../src/render/pdf-resources');
    await expect(loadPdfResource('../secret')).rejects.toThrow('not bundled');
    expect(fetchResource).not.toHaveBeenCalled();
    await expect(loadPdfResource('unknown.bcmap')).rejects.toThrow('not bundled');
    const [first, second] = await Promise.all([
      loadPdfResource('Example.bcmap'),
      loadPdfResource('Example.bcmap'),
    ]);
    expect(first).toEqual(new Uint8Array([1, 2, 3]));
    expect(second).toEqual(first);
    expect(fetchResource).toHaveBeenCalledTimes(2);
  });

  it('retries failed manifest and resource requests', async () => {
    let manifestAttempts = 0;
    let resourceAttempts = 0;
    vi.stubGlobal('location', { href: 'http://localhost/' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL) => {
        if (url.pathname.endsWith('pdf-resources.json')) {
          manifestAttempts++;
          return manifestAttempts === 1
            ? { ok: false, status: 503 }
            : { ok: true, json: async () => ['Example.pfb'] };
        }
        resourceAttempts++;
        return resourceAttempts === 1
          ? { ok: false, status: 503 }
          : { ok: true, arrayBuffer: async () => new Uint8Array([42]).buffer };
      }),
    );
    const { loadPdfResource } = await import('../src/render/pdf-resources');
    await expect(loadPdfResource('Example.pfb')).rejects.toThrow('503');
    await expect(loadPdfResource('Example.pfb')).rejects.toThrow('503');
    await expect(loadPdfResource('Example.pfb')).resolves.toEqual(new Uint8Array([42]));
  });
});

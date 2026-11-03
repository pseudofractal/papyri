import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaults } from '../src/lib/preferences';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('renderer loading', () => {
  it('permits PDF link previews only when requested while keeping PDF fetches restricted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, text: async () => '' })),
    );
    vi.stubGlobal('location', { href: 'http://localhost/' });
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', { querySelector: () => null });
    const { buildPdfFrame } = await import('../src/render/sandbox');
    const blocked = await buildPdfFrame({ ...defaults, network: false }, 0, 'channel', '/test.pdf');
    const allowed = await buildPdfFrame({ ...defaults, network: true }, 0, 'channel', '/test.pdf');
    expect(blocked).toContain("frame-src 'none'");
    expect(allowed).toContain('frame-src https: http:');
    expect(allowed).toContain('img-src data: blob: https: http:');
    expect(allowed).toContain('connect-src data: blob:');
    expect(allowed).not.toContain('connect-src https:');
  });
  it.each(['renderer.js', 'diagrams.js', 'pdf.js'])(
    'retries a failed %s load on the next preview',
    async (failedFile) => {
      let failed = false;
      const fetchAsset = vi.fn(async (url: URL) => {
        if (url.pathname.endsWith(failedFile) && !failed) {
          failed = true;
          return { ok: false, status: 503, text: async () => '' };
        }
        return { ok: true, status: 200, text: async () => '' };
      });
      vi.stubGlobal('fetch', fetchAsset);
      vi.stubGlobal('location', { href: 'http://localhost/' });
      vi.stubGlobal('window', {});
      vi.stubGlobal('document', { querySelector: () => null });
      const { buildFrame, buildPdfFrame, loadDiagramRuntime } =
        await import('../src/render/sandbox');
      const build = () =>
        failedFile === 'pdf.js'
          ? buildPdfFrame(defaults, 0, 'channel', '/test.pdf')
          : failedFile === 'diagrams.js'
            ? loadDiagramRuntime()
            : buildFrame('diagram-source', defaults, false, 0, 'channel', '# Source');

      await expect(build()).rejects.toThrow('503');
      await expect(build()).resolves.toEqual(expect.any(String));
      expect(
        fetchAsset.mock.calls.filter(([url]) => url.pathname.endsWith(failedFile)),
      ).toHaveLength(2);
    },
  );
});

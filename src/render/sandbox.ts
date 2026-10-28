import type { Source, Preferences } from '../lib/types';
import { resolveLink } from '../lib/paths';
const IMAGE_MIMES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
};
export function framePolicy(network: boolean) {
  return `default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval' ${network ? 'https: http:' : ''}; style-src 'unsafe-inline' ${network ? 'https: http:' : ''}; img-src data: blob: ${network ? 'https: http:' : ''}; font-src data: ${network ? 'https: http:' : ''}; connect-src ${network ? 'https: http:' : "'none'"}; worker-src blob:; frame-src 'none'; form-action 'none'; base-uri 'none';`;
}
let runtime: Promise<[string, string]> | undefined;
let diagramRuntime: Promise<string> | undefined;
async function loadAsset(file: string): Promise<string> {
  const response = await fetch(new URL(import.meta.env.BASE_URL + file, location.href));
  if (!response.ok) throw new Error(`Could not load bundled renderer: ${response.status}`);
  return response.text();
}
function loadRuntime() {
  return (runtime ??= Promise.all(['renderer.js', 'renderer.css'].map(loadAsset)) as Promise<
    [string, string]
  >);
}
/** Only static image references trigger host reads; the frame cannot request file bytes. */
export async function prepareAssets(html: string, source: Source, path: string): Promise<string> {
  const template = document.createElement('template');
  template.innerHTML = html;
  const fragment = template.content;
  const images = [...fragment.querySelectorAll('img')];
  let remainingBytes = 32 * 1024 * 1024;
  // Sequential and bounded: hostile documents cannot start thousands of parallel reads.
  for (const [index, image] of images.entries()) {
    image.removeAttribute('srcset');
    image.setAttribute('loading', 'lazy');
    const href = image.getAttribute('src') || '';
    const target = resolveLink(path, href);
    if (target.kind !== 'local') {
      if (target.kind !== 'external') image.removeAttribute('src');
      continue;
    }
    const extension = target.path.split('.').pop()?.toLowerCase() || '';
    const mime = IMAGE_MIMES[extension];
    if (!mime || index >= 100 || remainingBytes <= 0) {
      image.removeAttribute('src');
      image.setAttribute('alt', 'Local asset skipped: unsupported format or asset budget exceeded');
      continue;
    }
    try {
      const bytes = await source.asset(target.path);
      remainingBytes -= bytes.length;
      if (remainingBytes < 0) throw new Error('Document image budget exceeds 32 MiB.');
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(new Blob([bytes as BlobPart], { type: mime }));
      });
      image.setAttribute('src', data);
    } catch (error) {
      image.removeAttribute('src');
      image.setAttribute('alt', `Image unavailable: ${String(error)}`);
    }
  }
  return template.innerHTML;
}
export async function buildFrame(
  html: string,
  prefs: Preferences,
  trusted: boolean,
  scroll: number,
  channel: string,
): Promise<string> {
  const [script, css] = await loadRuntime();
  const native = '__TAURI_INTERNALS__' in window;
  const candidate =
    document.querySelector<HTMLMetaElement>('meta[name="mdview-script-nonce"]')?.nonce || '';
  const nonce =
    native && /^[a-zA-Z0-9+/_=-]+$/.test(candidate) && !candidate.startsWith('__TAURI_')
      ? candidate
      : '';
  if (native && import.meta.env.PROD && !nonce)
    throw new Error(
      'The native CSP nonce is unavailable. Rebuild mdview with the pinned Tauri toolchain.',
    );
  const diagrams = html.includes('diagram-source')
    ? await (diagramRuntime ??= loadAsset('diagrams.js'))
    : '';
  const data = JSON.stringify({
    html,
    trusted,
    network: prefs.network,
    theme: prefs.theme,
    documentZoom: prefs.documentZoom,
    uiZoom: prefs.uiZoom,
    fitWidth: prefs.fitWidth,
    scroll,
    channel,
  }).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="en" data-theme="${prefs.theme}" style="background:${prefs.theme === 'latte' ? '#eff1f5' : '#1e1e2e'};color-scheme:${prefs.theme === 'latte' ? 'light' : 'dark'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${framePolicy(prefs.network)}"><style>${css.replace(/<\/style/gi, '<\\/style')}</style></head><body><main id="document"></main><script id="payload" type="application/json">${data}</script><script id="diagram-runtime" type="text/plain">${diagrams.replace(/<\/script/gi, '<\\/script')}</script><script nonce="${nonce}">${script.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
}

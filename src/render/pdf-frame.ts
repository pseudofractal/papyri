import {
  AnnotationEditorType,
  AnnotationMode,
  GlobalWorkerOptions,
  getDocument,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  EventBus,
  PDFFindController,
  PDFLinkService,
  PDFViewer,
} from 'pdfjs-dist/legacy/web/pdf_viewer.mjs';
import workerSource from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
import { viewShortcut } from '../lib/view';
import { installLinkPreviews } from './link-preview';
import type { Heading, Preferences } from '../lib/types';
import 'pdfjs-dist/web/pdf_viewer.css';
import './pdf.css';
import './link-preview.css';

interface Payload {
  channel: string;
  path: string;
  scroll: number;
  theme: Preferences['theme'];
  pdfZoom: number;
  fitWidth: boolean;
  network: boolean;
}
const payload: Payload = JSON.parse(document.getElementById('payload')!.textContent!);
const send = (data: Record<string, unknown>) =>
  parent.postMessage({ ...data, channel: payload.channel }, '*');
const container = document.getElementById('viewer-container') as HTMLDivElement;
const pageInput = document.getElementById('page-number') as HTMLInputElement;
const previous = document.getElementById('previous-page') as HTMLButtonElement;
const next = document.getElementById('next-page') as HTMLButtonElement;
const pageCount = document.getElementById('page-count')!;
const matchCount = document.getElementById('match-count')!;
const passwordPanel = document.getElementById('password-panel')!;
const passwordInput = document.getElementById('pdf-password') as HTMLInputElement;
const eventBus = new EventBus();
const LOCAL_LINK_ORIGIN = 'https://papyri.invalid';
class HostLinkService extends PDFLinkService {
  override addLinkAttributes(link: HTMLAnchorElement, url: string) {
    // Never give a PDF a browser navigation or filesystem protocol of its own.
    const parsed = new URL(url);
    const local = parsed.origin === LOCAL_LINK_ORIGIN;
    const href = local ? parsed.pathname + parsed.hash : url;
    link.href = '#';
    if (!local) link.dataset.previewHref = href;
    link.title = local ? decodeURI(href) : url;
    link.addEventListener('click', (event) => {
      event.preventDefault();
      send({ type: 'navigate', href });
    });
  }
}
const linkService = new HostLinkService({ eventBus, ignoreDestinationZoom: true });
installLinkPreviews(container, payload.network);
const findController = new PDFFindController({ eventBus, linkService });
const viewer = new PDFViewer({
  container,
  eventBus,
  linkService,
  findController,
  annotationMode: AnnotationMode.ENABLE,
  annotationEditorMode: AnnotationEditorType.DISABLE,
  maxCanvasPixels: 8 * 1024 * 1024,
});
linkService.setViewer(viewer);
let loaded = false;
let opened = false;
let passwordCallback: ((password: string) => void) | undefined;
let pendingAnchor = '';
let pendingQuery = '';
let destinations: (string | unknown[])[] = [];
let resourceRequest = 0;
const pendingResources = new Map<
  number,
  { resolve: (bytes: Uint8Array) => void; reject: (error: Error) => void }
>();

/** PDF.js requests only its own bundled fonts, CMaps, and image decoders. */
class BundledBinaryDataFactory {
  async fetch({ filename }: { filename: string }): Promise<Uint8Array> {
    if (typeof filename !== 'string' || !filename || filename.length > 128)
      throw new Error('Invalid bundled PDF resource name.');
    const request = ++resourceRequest;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingResources.delete(request);
        const error = `PDF resource request timed out: ${filename}`;
        send({ type: 'pdf-error', error });
        reject(new Error(error));
      }, 15_000);
      pendingResources.set(request, {
        resolve: (bytes) => {
          clearTimeout(timeout);
          resolve(bytes);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
      send({ type: 'pdf-resource-request', name: filename, request });
    });
  }
}
function presentation() {
  document.documentElement.dataset.theme = payload.theme;
  document.documentElement.style.colorScheme = payload.theme === 'latte' ? 'light' : 'dark';
  if (!loaded) return;
  if (payload.fitWidth) {
    viewer.currentScaleValue = 'page-width';
    send({ type: 'pdf-scale', value: Math.round(viewer.currentScale * 100) });
  } else viewer.currentScale = payload.pdfZoom / 100;
}
function search(query: string) {
  pendingQuery = query;
  if (!loaded) return;
  matchCount.textContent = '';
  eventBus.dispatch('find', {
    source: viewer,
    type: '',
    query,
    caseSensitive: false,
    entireWord: false,
    highlightAll: true,
    findPrevious: false,
    matchDiacritics: false,
  });
}
function navigate(id: string) {
  if (!loaded) {
    pendingAnchor = id;
    return;
  }
  const index = /^pdf-outline-(\d+)$/.exec(id);
  if (index && destinations[Number(index[1])])
    void linkService.goToDestination(destinations[Number(index[1])]);
  else if (/^(page=|nameddest=|zoom=)/.test(id)) linkService.setHash(id);
  else if (id) void linkService.goToDestination(id);
}
async function outline(pdf: PDFDocumentProxy) {
  const headings: Heading[] = [];
  type Outline = NonNullable<Awaited<ReturnType<PDFDocumentProxy['getOutline']>>>;
  const visit = (items: Outline, level: number) => {
    for (const item of items) {
      if (headings.length >= 1000) return;
      if (item.dest) {
        const id = `pdf-outline-${destinations.length}`;
        destinations.push(item.dest);
        headings.push({ id, text: item.title, level });
      }
      visit(item.items, Math.min(level + 1, 6));
    }
  };
  destinations = [];
  visit((await pdf.getOutline()) || [], 1);
  send({ type: 'headings', headings });
}
eventBus.on('pagesinit', () => {
  loaded = true;
  send({ type: 'pdf-page', page: viewer.currentPageNumber, total: viewer.pagesCount });
  presentation();
  container.scrollTop = payload.scroll;
  if (pendingQuery) search(pendingQuery);
  if (pendingAnchor) navigate(pendingAnchor);
  send({ type: 'ready' });
});
let firstPageRendered = false;
eventBus.on('pagerendered', ({ error }: { error?: unknown }) => {
  if (!error && !firstPageRendered) {
    firstPageRendered = true;
    send({ type: 'pdf-rendered' });
  }
});
eventBus.on('pagechanging', ({ pageNumber }: { pageNumber: number }) => {
  pageInput.value = String(pageNumber);
  previous.disabled = pageNumber <= 1;
  next.disabled = pageNumber >= viewer.pagesCount;
  send({ type: 'pdf-page', page: pageNumber, total: viewer.pagesCount });
});
eventBus.on('updatefindmatchescount', ({ matchesCount }: { matchesCount: { total: number } }) => {
  matchCount.textContent = `${matchesCount.total} matches`;
});
previous.onclick = () => {
  viewer.currentPageNumber = Math.max(1, viewer.currentPageNumber - 1);
};
next.onclick = () => {
  viewer.currentPageNumber = Math.min(viewer.pagesCount, viewer.currentPageNumber + 1);
};
pageInput.onchange = () => linkService.goToPage(pageInput.value);
function unlockPdf() {
  if (!passwordInput.reportValidity()) return;
  passwordCallback?.(passwordInput.value);
  passwordInput.value = '';
  passwordPanel.hidden = true;
}
document.getElementById('unlock-pdf')!.onclick = unlockPdf;
passwordInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    unlockPdf();
  }
});
container.addEventListener('scroll', () => send({ type: 'scroll', y: container.scrollTop }), {
  passive: true,
});
new ResizeObserver(() => {
  if (payload.fitWidth) presentation();
}).observe(container);
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    send({ type: 'dismiss' });
    return;
  }
  const command = viewShortcut(event);
  if (command) {
    event.preventDefault();
    send({ type: 'view-command', ...command });
  }
});
window.addEventListener('message', (event) => {
  if (event.source !== parent || !event.data) return;
  const data = event.data;
  if (data.type === 'scroll' && Number.isSafeInteger(data.request)) {
    const request = data.request;
    const top = Number.isFinite(data.y)
      ? data.y
      : Number.isFinite(data.dy)
        ? container.scrollTop + data.dy
        : container.scrollTop;
    container.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
    send({ type: 'scroll-done', request, y: container.scrollTop });
    return;
  }
  if (data.type === 'wheel' && Number.isFinite(data.deltaX) && Number.isFinite(data.deltaY)) {
    const scale = Number.isFinite(data.scale) && data.scale > 0 ? data.scale : 1;
    container.scrollBy({ left: data.deltaX * scale, top: data.deltaY * scale });
    return;
  }
  if (data.type === 'pdf-resource-result' && Number.isSafeInteger(data.request)) {
    const pending = pendingResources.get(data.request);
    if (pending) {
      pendingResources.delete(data.request);
      if (data.bytes instanceof Uint8Array) pending.resolve(data.bytes);
      else {
        const error =
          typeof data.error === 'string' ? data.error : 'Invalid PDF resource response.';
        send({ type: 'pdf-error', error });
        pending.reject(new Error(error));
      }
    }
    return;
  }
  if (data.type === 'search' && typeof data.query === 'string') search(data.query);
  if (data.type === 'anchor' && typeof data.id === 'string') navigate(data.id);
  if (data.type === 'presentation') {
    payload.theme = data.theme;
    payload.pdfZoom = data.pdfZoom;
    payload.fitWidth = data.fitWidth;
    presentation();
  }
  if (data.type === 'pdf-data' && !opened && data.bytes instanceof Uint8Array) {
    opened = true;
    void openPdf(data.bytes);
  }
});
async function openPdf(bytes: Uint8Array) {
  try {
    const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
    const worker = new Worker(workerUrl);
    worker.addEventListener('error', (event) =>
      send({
        type: 'pdf-error',
        error: `PDF worker failed: ${event.message || 'worker initialization error'}`,
      }),
    );
    GlobalWorkerOptions.workerPort = worker;
    const task = getDocument({
      data: bytes,
      docBaseUrl: LOCAL_LINK_ORIGIN + payload.path.split('/').map(encodeURIComponent).join('/'),
      enableXfa: false,
      useWorkerFetch: false,
      BinaryDataFactory: BundledBinaryDataFactory,
      isOffscreenCanvasSupported: false,
      isImageDecoderSupported: false,
    });
    task.onPassword = (callback: (password: string) => void, reason: number) => {
      passwordCallback = callback;
      passwordPanel.querySelector('label')!.textContent =
        reason === 2 ? 'Incorrect password. Try again.' : 'This PDF requires a password';
      passwordPanel.hidden = false;
      passwordInput.focus();
      send({ type: 'ready' });
    };
    const pdf = await task.promise;
    URL.revokeObjectURL(workerUrl);
    pageInput.max = String(pdf.numPages);
    pageCount.textContent = `of ${pdf.numPages}`;
    linkService.setDocument(pdf);
    viewer.setDocument(pdf);
    void outline(pdf).catch(() => send({ type: 'headings', headings: [] }));
  } catch (error) {
    send({ type: 'pdf-error', error: String(error) });
  }
}
presentation();
send({ type: 'pdf-request' });

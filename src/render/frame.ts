import DOMPurify from 'dompurify';
import 'katex/dist/katex.min.css';
import './highlighting.css';
import './reading.css';
import './link-preview.css';
import { syncViewportSize } from './viewport';
import { viewShortcut } from '../lib/view';
import { createDiagramViewer } from './diagram-view';
import { installImageViewers } from './image-view';
import { resolveReferenceTargets } from './reference-targets';
import { installLinkPreviews } from './link-preview';
const runtimeNonce = (document.currentScript as HTMLScriptElement | null)?.nonce || '';
const payload = JSON.parse(document.getElementById('payload')!.textContent!);
const root = document.getElementById('document')!;
// Capture host scrolling before trusted document scripts can replace it.
const scrollWindowTo = window.scrollTo.bind(window);
const scrollWindowBy = window.scrollBy.bind(window);
const notifyHost = (message: Record<string, unknown>) =>
  parent.postMessage({ ...message, channel: payload.channel }, '*');
let exportRequest = 0;
const pendingExports = new Map<
  number,
  { resolve: (message: string) => void; reject: (reason: Error) => void }
>();
async function exportDiagram(action: 'download' | 'copy', blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const request = ++exportRequest;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingExports.delete(request);
      reject(new Error('The export request timed out.'));
    }, 120_000);
    pendingExports.set(request, {
      resolve: (message) => {
        clearTimeout(timeout);
        resolve(message);
      },
      reject: (reason) => {
        clearTimeout(timeout);
        reject(reason);
      },
    });
    parent.postMessage(
      { type: 'diagram-export', action, mime: blob.type, bytes, request, channel: payload.channel },
      '*',
      [bytes.buffer],
    );
  });
}
export function sanitize(html: string) {
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ['math', 'semantics', 'annotation'],
    ADD_ATTR: ['data-format', 'target'],
    FORBID_TAGS: ['style', 'iframe', 'object', 'embed', 'base', 'meta', 'link', 'form'],
    FORBID_ATTR: ['srcdoc', 'srcset', 'action', 'formaction'],
    ALLOW_DATA_ATTR: true,
  });
}
let mathOverflowFrame = 0;

/** Keep overflow only on inline math wider than the reading column. */
function updateMathOverflow() {
  mathOverflowFrame = 0;
  for (const element of root.querySelectorAll<HTMLElement>('.math')) {
    element.classList.toggle('scrollable', element.scrollWidth > element.clientWidth + 1);
  }
}

function scheduleMathOverflowUpdate() {
  if (mathOverflowFrame) return;
  mathOverflowFrame = requestAnimationFrame(updateMathOverflow);
}

function applyPresentation(presentation: Record<string, unknown>) {
  const { theme, documentZoom, uiZoom, fitWidth, textFont, codeFont, mathFont } = presentation;
  const page = document.documentElement;
  if (typeof textFont === 'string' && textFont) page.style.setProperty('--reading-font', textFont);
  else page.style.removeProperty('--reading-font');
  if (typeof codeFont === 'string' && codeFont) page.style.setProperty('--code-font', codeFont);
  else page.style.removeProperty('--code-font');
  if (typeof mathFont === 'string' && mathFont) {
    page.dataset.mathFont = 'custom';
    page.style.setProperty('--math-font', mathFont);
  } else {
    delete page.dataset.mathFont;
    page.style.removeProperty('--math-font');
  }
  if (theme === 'latte' || theme === 'mocha') {
    page.dataset.theme = theme;
    page.style.background = theme === 'latte' ? '#eff1f5' : '#1e1e2e';
    page.style.colorScheme = theme === 'latte' ? 'light' : 'dark';
    for (const diagram of root.querySelectorAll<HTMLElement>('.diagram')) {
      const rendered = diagram.querySelector<HTMLElement>('[data-render-theme]');
      const button = diagram.querySelector('button');
      if (rendered && rendered.dataset.renderTheme !== theme && button) {
        button.disabled = false;
        button.textContent = 'Update diagram theme';
      }
    }
  }
  if (
    typeof documentZoom === 'number' &&
    Number.isFinite(documentZoom) &&
    typeof uiZoom === 'number' &&
    Number.isFinite(uiZoom) &&
    documentZoom >= 50 &&
    documentZoom <= 200 &&
    uiZoom >= 50 &&
    uiZoom <= 200
  ) {
    const baseFontSize = 16;
    const readingWidth = 860;
    page.style.fontSize = `${(baseFontSize * documentZoom) / 100}px`;
    page.style.setProperty('--document-width', `${readingWidth}px`);
  }
  if (typeof fitWidth === 'boolean') page.dataset.fitWidth = String(fitWidth);
  syncViewportSize();
  scheduleMathOverflowUpdate();
}
applyPresentation(payload);
root.innerHTML = payload.trusted ? payload.html : sanitize(payload.html);
resolveReferenceTargets(root);
updateMathOverflow();
document.fonts?.ready.then(updateMathOverflow);

type MathSelection = { tex: string; display: boolean };

function nearestMath(node: Node): Element | null {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return element?.closest('.katex') ?? null;
}

function mathFor(element: Element): MathSelection | null {
  const annotation = element.querySelector('annotation[encoding="application/x-tex"]');
  const tex = annotation?.textContent?.trim();
  if (!tex) return null;
  const display =
    element.classList.contains('katex-display') ||
    !!element.closest('.katex-display') ||
    annotation?.closest('math')?.getAttribute('display') === 'block';
  return { tex, display };
}

function mathMarkdown({ tex, display }: MathSelection): string {
  return display ? `\n\n$$\n${tex}\n$$\n\n` : `$${tex}$`;
}

function expandedSelectionRange(selection: Selection): Range {
  const range = selection.getRangeAt(0);
  const expanded = range.cloneRange();
  const startMath = nearestMath(range.startContainer);
  if (startMath) expanded.setStartBefore(startMath);
  const endMath = nearestMath(range.endContainer);
  if (endMath) expanded.setEndAfter(endMath);
  return expanded;
}

/** Replace KaTeX's rendered DOM with its TeX annotation for copied text. */
function selectionText(selection: Selection): string {
  const holder = document.createElement('div');
  holder.append(expandedSelectionRange(selection).cloneContents());
  for (const math of holder.querySelectorAll('.katex')) {
    const source = mathFor(math);
    if (source) math.replaceWith(document.createTextNode(mathMarkdown(source)));
  }
  const measure = document.createElement('div');
  measure.style.cssText =
    'position:fixed;left:-10000px;top:0;width:10000px;opacity:0;pointer-events:none;white-space:pre-wrap;';
  measure.append(holder);
  document.body.append(measure);
  const text = measure.innerText.replace(/\n{3,}/g, '\n\n').trim();
  measure.remove();
  return text || selection.toString().trim();
}

function hasTopLevel(holder: Element, tag: string): boolean {
  return [...holder.children].some((child) => child.tagName === tag);
}

function wrapPreview(holder: Element, shell: Element) {
  while (holder.firstChild) shell.append(holder.firstChild);
  holder.append(shell);
}

/** Restore block structure that cloneContents omits for partial selections. */
function wrapPreviewStructure(holder: Element, selection: Selection) {
  const startBlock = nearestSourceBlock(selection.getRangeAt(0).startContainer);
  if (!startBlock) return;
  if (!['TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH'].includes(startBlock.tagName)) {
    if (!hasTopLevel(holder, startBlock.tagName))
      wrapPreview(holder, startBlock.cloneNode(false) as Element);
  }
  const item = startBlock.closest('li');
  const list = startBlock.closest('ul, ol');
  if (list) {
    if (item && startBlock.tagName !== 'LI' && !hasTopLevel(holder, 'LI'))
      wrapPreview(holder, item.cloneNode(false) as Element);
    if (!hasTopLevel(holder, list.tagName)) wrapPreview(holder, list.cloneNode(false) as Element);
  }
  const quote = startBlock.closest('blockquote');
  if (quote && !hasTopLevel(holder, 'BLOCKQUOTE'))
    wrapPreview(holder, quote.cloneNode(false) as Element);
}

/** Render a safe, bounded HTML preview of the selected content. */
function selectionPreview(selection: Selection): string {
  const holder = document.createElement('div');
  holder.append(expandedSelectionRange(selection).cloneContents());
  wrapPreviewStructure(holder, selection);
  for (const element of holder.querySelectorAll('[id]')) element.removeAttribute('id');
  for (const anchor of holder.querySelectorAll('a')) anchor.removeAttribute('href');
  const html = DOMPurify.sanitize(holder.innerHTML, {
    FORBID_TAGS: [
      'img',
      'picture',
      'source',
      'video',
      'audio',
      'iframe',
      'object',
      'embed',
      'form',
      'input',
      'button',
      'textarea',
      'select',
      'option',
      'style',
      'link',
      'meta',
      'base',
    ],
    FORBID_ATTR: ['id', 'srcset'],
  });
  return html.length <= 20_000 ? html : '';
}

let selectionHighlightFrame = 0;

function updateMathSelectionHighlight() {
  const selection = window.getSelection();
  const highlighted = root.querySelectorAll('.katex.selection-highlight');
  if (!selection || selection.isCollapsed) {
    for (const element of highlighted) element.classList.remove('selection-highlight');
    return;
  }
  const range = selection.getRangeAt(0);
  const next = new Set<Element>();
  for (const element of root.querySelectorAll('.katex')) {
    if (range.intersectsNode(element)) next.add(element);
  }
  for (const element of highlighted)
    if (!next.has(element)) element.classList.remove('selection-highlight');
  for (const element of next) element.classList.add('selection-highlight');
}

function scheduleMathSelectionHighlight() {
  if (selectionHighlightFrame) return;
  selectionHighlightFrame = requestAnimationFrame(() => {
    selectionHighlightFrame = 0;
    updateMathSelectionHighlight();
  });
}

document.addEventListener('selectionchange', scheduleMathSelectionHighlight);

let lastSelectionStats = '';
let selectionStatsTimer: ReturnType<typeof setTimeout> | undefined;

function publishSelectionStats() {
  if (payload.trusted) return;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) {
    if (lastSelectionStats !== '0:0') {
      lastSelectionStats = '0:0';
      notifyHost({ type: 'selection-stats', words: 0, characters: 0 });
    }
    return;
  }
  const text = selectionText(selection);
  const words = text.trim() ? text.trim().split(/\s+/).filter(Boolean).length : 0;
  const characters = text.length;
  const key = `${words}:${characters}`;
  if (key === lastSelectionStats) return;
  lastSelectionStats = key;
  notifyHost({ type: 'selection-stats', words, characters });
}

function scheduleSelectionStats() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) {
    if (selectionStatsTimer) clearTimeout(selectionStatsTimer);
    selectionStatsTimer = undefined;
    publishSelectionStats();
    return;
  }
  if (selectionStatsTimer) clearTimeout(selectionStatsTimer);
  selectionStatsTimer = setTimeout(() => {
    selectionStatsTimer = undefined;
    publishSelectionStats();
  }, 90);
}

document.addEventListener('selectionchange', scheduleSelectionStats);

function nearestSourceBlock(node: Node): Element | null {
  let element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  for (; element; element = element.parentElement) {
    const start = Number((element as HTMLElement).dataset.sourceStart);
    const end = Number((element as HTMLElement).dataset.sourceEnd);
    if (Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start)
      return element;
  }
  return null;
}

function sourceSlice(markdown: string, start: number, end: number): string {
  const lines = markdown.split(/\r?\n/);
  if (end > lines.length) return '';
  return lines.slice(start, end).join('\n').trim().slice(0, 100_000);
}

function sourceForSelection(selection: Selection, fallback: string): string {
  const markdown = typeof payload.markdown === 'string' ? payload.markdown : '';
  if (!markdown) return fallback;
  const range = selection.getRangeAt(0);
  const startBlock = nearestSourceBlock(range.startContainer);
  const endBlock = nearestSourceBlock(range.endContainer);
  if (startBlock && endBlock) {
    const source = sourceSlice(
      markdown,
      Number((startBlock as HTMLElement).dataset.sourceStart),
      Number((endBlock as HTMLElement).dataset.sourceEnd),
    );
    if (source) return source;
  }
  // Selections that begin or end between blocks (select-all, for example)
  // still cover whole line-mapped blocks.
  const blocks = [...root.querySelectorAll<HTMLElement>('[data-source-start]')]
    .filter((element) => range.intersectsNode(element))
    .map((element) => ({
      start: Number(element.dataset.sourceStart),
      end: Number(element.dataset.sourceEnd),
    }))
    .filter(({ start, end }) => Number.isInteger(start) && Number.isInteger(end) && end > start);
  if (blocks.length) {
    const source = sourceSlice(
      markdown,
      Math.min(...blocks.map(({ start }) => start)),
      Math.max(...blocks.map(({ end }) => end)),
    );
    if (source) return source;
  }
  return fallback;
}

// The preview never exposes WebKit's navigation menu. Editable controls keep
// their native editing menu; safe previews route selections to the host.
document.addEventListener('contextmenu', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('input, textarea, [contenteditable]:not([contenteditable="false"])')) return;
  event.preventDefault();
  if (payload.trusted) return;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) {
    notifyHost({ type: 'context-menu', x: event.clientX, y: event.clientY });
    return;
  }
  const text = selectionText(selection);
  if (!text) return;
  notifyHost({
    type: 'selection-menu',
    text: text.slice(0, 50_000),
    source: sourceForSelection(selection, text).slice(0, 100_000),
    preview: selectionPreview(selection),
    x: event.clientX,
    y: event.clientY,
  });
});
if (!payload.trusted) {
  document.addEventListener('keydown', (event) => {
    const modifier = event.ctrlKey || event.metaKey;
    const copyKey = event.key.toLowerCase() === 'c' || event.code === 'KeyC';
    if (!modifier || event.altKey || !copyKey) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('input, textarea, [contenteditable]:not([contenteditable="false"])'))
      return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;
    const text = selectionText(selection);
    if (!text) return;
    event.preventDefault();
    event.stopPropagation();
    notifyHost({
      type: 'selection-copy',
      kind: event.shiftKey ? 'text' : 'source',
      text: text.slice(0, 50_000),
      source: sourceForSelection(selection, text).slice(0, 100_000),
    });
  });
}
installLinkPreviews(root, payload.network);
installImageViewers(root, notifyHost);
if (payload.trusted) {
  for (const old of root.querySelectorAll('script')) {
    const script = document.createElement('script');
    for (const attr of old.attributes) script.setAttribute(attr.name, attr.value);
    if (runtimeNonce) script.nonce = runtimeNonce;
    script.textContent = old.textContent;
    old.replaceWith(script);
  }
}
let diagrams: Promise<typeof import('./diagrams')> | undefined;
function loadDiagrams() {
  return (diagrams ??= new Promise<typeof import('./diagrams')>((resolve, reject) => {
    const timeout = setTimeout(() => {
      window.removeEventListener('message', receive);
      reject(new Error('The diagram runtime request timed out.'));
    }, 30_000);
    function receive(event: MessageEvent) {
      if (event.source !== parent || event.data?.type !== 'diagram-runtime-result') return;
      clearTimeout(timeout);
      window.removeEventListener('message', receive);
      try {
        const source = event.data.source;
        if (event.data.error) throw new Error(event.data.error);
        if (!source) throw new Error('Bundled diagram runtime is unavailable.');
        const script = document.createElement('script');
        if (runtimeNonce) script.nonce = runtimeNonce;
        script.textContent = source;
        document.head.append(script);
        const runtime = (window as unknown as { papyriDiagrams?: typeof import('./diagrams') })
          .papyriDiagrams;
        if (!runtime) throw new Error('The diagram runtime could not start.');
        resolve(runtime);
      } catch (error) {
        reject(error);
      }
    }
    window.addEventListener('message', receive);
    notifyHost({ type: 'diagram-runtime-request' });
  }).catch((error) => {
    diagrams = undefined;
    throw error;
  }));
}
for (const block of root.querySelectorAll<HTMLElement>('pre.diagram-source')) {
  const format = block.dataset.format!;
  const code = block.textContent || '';
  const container = document.createElement('section');
  container.className = 'diagram';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = `Render ${format} diagram`;
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const output = document.createElement('div');
  const { viewport, expandButton } = createDiagramViewer(
    output,
    format,
    (expanded) => notifyHost({ type: 'diagram-expanded', expanded }),
    exportDiagram,
    !payload.trusted,
  );
  const actions = document.createElement('div');
  actions.className = 'diagram-actions';
  actions.append(button, expandButton);
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = 'Diagram source';
  block.before(container);
  details.append(summary, block);
  container.append(actions, status, viewport, details);
  button.onclick = async () => {
    button.disabled = true;
    status.textContent = 'Rendering locally…';
    try {
      const runtime = await loadDiagrams();
      const renderTheme = document.documentElement.dataset.theme || 'mocha';
      await runtime.renderDiagram(format, code, output, renderTheme);
      output.dataset.renderTheme = renderTheme;
      output.classList.add('diagram-output');
      expandButton.disabled = false;
      status.textContent = '';
      const themeChanged = renderTheme !== document.documentElement.dataset.theme;
      button.disabled = !themeChanged;
      button.textContent = themeChanged ? 'Update diagram theme' : 'Rendered locally';
    } catch (error) {
      status.textContent = String(error);
      button.disabled = false;
      button.textContent = 'Retry diagram';
    }
  };
}
{
  document.addEventListener('click', (event) => {
    const anchor = (event.target as Element).closest('a');
    if (!anchor) return;
    event.preventDefault();
    const href = anchor.getAttribute('href') || anchor.getAttribute('xlink:href') || '';
    if (href.startsWith('#')) {
      try {
        document
          .getElementById(decodeURIComponent(href.slice(1)))
          ?.scrollIntoView({ behavior: 'smooth' });
      } catch {
        /* Invalid anchors are inert. */
      }
    } else if (!payload.trusted) notifyHost({ type: 'navigate', href });
  });
}
function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
/** Scroll the element under a forwarded pointer, falling back to the document. */
function scrollFromWheel(
  xRatio: number,
  yRatio: number,
  deltaX: number,
  deltaY: number,
  scale: number,
) {
  const x = Math.min(Math.max(xRatio, 0), 0.999) * window.innerWidth;
  const y = Math.min(Math.max(yRatio, 0), 0.999) * window.innerHeight;
  const scrollX = deltaX * scale;
  const scrollY = deltaY * scale;
  for (let node = document.elementFromPoint(x, y); node; node = node.parentElement) {
    const style = getComputedStyle(node);
    const canScrollY =
      scrollY !== 0 &&
      /^(auto|scroll)$/.test(style.overflowY) &&
      (scrollY > 0
        ? node.scrollTop + node.clientHeight < node.scrollHeight - 1
        : node.scrollTop > 0);
    const canScrollX =
      scrollX !== 0 &&
      /^(auto|scroll)$/.test(style.overflowX) &&
      (scrollX > 0
        ? node.scrollLeft + node.clientWidth < node.scrollWidth - 1
        : node.scrollLeft > 0);
    if (canScrollY || canScrollX) {
      node.scrollBy({ left: canScrollX ? scrollX : 0, top: canScrollY ? scrollY : 0 });
      return;
    }
    const containsY = scrollY !== 0 && /^(contain|none)$/.test(style.overscrollBehaviorY);
    const containsX = scrollX !== 0 && /^(contain|none)$/.test(style.overscrollBehaviorX);
    if (containsX || containsY) return;
  }
  scrollWindowBy({ left: scrollX, top: scrollY });
}
window.addEventListener('message', (event) => {
  if (event.source !== parent) return;
  if (event.data?.type === 'scroll' && Number.isSafeInteger(event.data.request)) {
    const request = event.data.request;
    const y = finiteNumber(event.data.y)
      ? event.data.y
      : finiteNumber(event.data.dy)
        ? window.scrollY + event.data.dy
        : window.scrollY;
    scrollWindowTo({ top: Math.max(0, y), behavior: 'auto' });
    notifyHost({ type: 'scroll-done', request, y: window.scrollY });
    return;
  }
  if (event.data?.type === 'wheel') {
    const { x, y, deltaX, deltaY, scale } = event.data;
    if ([x, y, deltaX, deltaY].every(finiteNumber))
      scrollFromWheel(x, y, deltaX, deltaY, finiteNumber(scale) && scale > 0 ? scale : 1);
    return;
  }
  if (event.data?.type === 'diagram-export-result' && Number.isSafeInteger(event.data.request)) {
    const pending = pendingExports.get(event.data.request);
    if (pending) {
      pendingExports.delete(event.data.request);
      if (typeof event.data.error === 'string') pending.reject(new Error(event.data.error));
      else pending.resolve(typeof event.data.message === 'string' ? event.data.message : 'Done.');
    }
    return;
  }
  if (event.data.type === 'presentation') applyPresentation(event.data);
  if (event.data.type === 'anchor' && typeof event.data.id === 'string')
    document.getElementById(event.data.id)?.scrollIntoView();
  if (event.data.type === 'search' && typeof event.data.query === 'string') {
    const marks = root.querySelectorAll('mark[data-search]');
    if (!event.data.query.trim() && !marks.length) return;
    for (const mark of marks) mark.replaceWith(document.createTextNode(mark.textContent || ''));
    root.normalize();
    const query = event.data.query.trim().toLowerCase();
    if (!query) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        node.parentElement?.closest('script,style,mark,svg,math,.katex,.image-expand')
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    });
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    let matches = 0;
    for (const node of nodes) {
      const text = node.textContent || '';
      const lowerText = text.toLowerCase();
      let offset = 0;
      let index: number;
      const fragment = document.createDocumentFragment();
      while (matches < 2000 && (index = lowerText.indexOf(query, offset)) !== -1) {
        fragment.append(text.slice(offset, index));
        const mark = document.createElement('mark');
        mark.dataset.search = '';
        mark.textContent = text.slice(index, index + query.length);
        fragment.append(mark);
        offset = index + query.length;
        matches++;
      }
      fragment.append(text.slice(offset));
      node.replaceWith(fragment);
    }
    root.querySelector('mark[data-search]')?.scrollIntoView({ block: 'center' });
    notifyHost({ type: 'matches', count: matches });
  }
});
window.addEventListener('scroll', () => notifyHost({ type: 'scroll', y: window.scrollY }), {
  passive: true,
});
window.addEventListener('resize', scheduleMathOverflowUpdate, { passive: true });
// Hidden loading frames can suspend animation callbacks. Styles and DOM are ready here.
setTimeout(() => {
  scrollWindowTo(0, payload.scroll);
  notifyHost({ type: 'ready' });
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    notifyHost({ type: 'dismiss' });
    return;
  }
  const command = viewShortcut(event);
  if (!command) return;
  event.preventDefault();
  notifyHost({ type: 'view-command', ...command });
});

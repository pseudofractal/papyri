import DOMPurify from 'dompurify';
import 'katex/dist/katex.min.css';
import './highlighting.css';
import './reading.css';
import { syncViewportSize } from './viewport';
import { viewShortcut } from '../lib/view';
import { createDiagramViewer } from './diagram-view';
import { resolveReferenceTargets } from './reference-targets';
const runtimeNonce = (document.currentScript as HTMLScriptElement | null)?.nonce || '';
const payload = JSON.parse(document.getElementById('payload')!.textContent!);
const root = document.getElementById('document')!;
const diagramSource = document.getElementById('diagram-runtime')?.textContent;
const notifyHost = (message: Record<string, unknown>) =>
  parent.postMessage({ ...message, channel: payload.channel }, '*');
export function sanitize(html: string) {
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ['math', 'semantics', 'annotation'],
    ADD_ATTR: ['data-format', 'target'],
    FORBID_TAGS: ['style', 'iframe', 'object', 'embed', 'base', 'meta', 'link', 'form'],
    FORBID_ATTR: ['srcdoc', 'srcset', 'action', 'formaction'],
    ALLOW_DATA_ATTR: true,
  });
}
function applyPresentation(presentation: Record<string, unknown>) {
  const { theme, documentZoom, uiZoom, fitWidth } = presentation;
  const page = document.documentElement;
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
}
applyPresentation(payload);
root.innerHTML = payload.trusted ? payload.html : sanitize(payload.html);
resolveReferenceTargets(root);
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
  return (diagrams ??= new Promise((resolve, reject) => {
    try {
      const source = diagramSource;
      if (!source) throw new Error('Bundled diagram runtime is unavailable.');
      const script = document.createElement('script');
      if (runtimeNonce) script.nonce = runtimeNonce;
      script.textContent = source;
      document.head.append(script);
      const runtime = (window as unknown as { mdviewDiagrams?: typeof import('./diagrams') })
        .mdviewDiagrams;
      if (!runtime) throw new Error('The diagram runtime could not start.');
      resolve(runtime);
    } catch (error) {
      reject(error);
    }
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
  const { viewport, expandButton } = createDiagramViewer(output, format, (expanded) =>
    notifyHost({ type: 'diagram-expanded', expanded }),
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
window.addEventListener('message', (event) => {
  if (event.source !== parent) return;
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
        node.parentElement?.closest('script,style,mark,svg,math,.katex')
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
let scrollTimer: ReturnType<typeof setTimeout>;
window.addEventListener(
  'scroll',
  () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => notifyHost({ type: 'scroll', y: window.scrollY }), 100);
  },
  { passive: true },
);
// Hidden loading frames can suspend animation callbacks. Styles and DOM are ready here.
setTimeout(() => {
  window.scrollTo(0, payload.scroll);
  notifyHost({ type: 'ready' });
});

window.addEventListener('keydown', (event) => {
  const command = viewShortcut(event);
  if (!command) return;
  event.preventDefault();
  notifyHost({ type: 'view-command', ...command });
});

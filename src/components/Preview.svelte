<script lang="ts">
  import { untrack } from 'svelte';
  import type { ViewCommand } from '../lib/view';
  import { parseDocument } from '../render/client';
  import {
    prepareAssets,
    buildFrame,
    buildPdfFrame,
    loadRuntime,
    loadDiagramRuntime,
  } from '../render/sandbox';
  import type { Preferences, Source, Heading } from '../lib/types';
  import type { AnchorTarget, Tab } from '../lib/workspace.svelte';
  import { isTypst, isLatex } from '../lib/paths';
  import { exportDiagram } from '../lib/diagram-export';
  import { traceStartup, traceStartupPaint } from '../lib/startup-trace';
  import { native } from '../lib/sources';
  import { mayContainMath, warmMathFonts } from '../render/math-fonts';
  import { loadPdfResource } from '../render/pdf-resources';
  let {
    tab,
    scrollPosition,
    source,
    preferences,
    trusted,
    query,
    anchor,
    onanchorconsumed,
    onlink,
    onheadings,
    onscroll,
    oncommand,
    onpdfscale,
    onpdfpage,
    onrendererror,
  }: {
    tab: Tab;
    scrollPosition?: number;
    source: Source;
    preferences: Preferences;
    trusted: boolean;
    query: string;
    anchor: AnchorTarget | null;
    onanchorconsumed?: (request: number) => void;
    onlink: (href: string) => void;
    onheadings: (headings: Heading[]) => void;
    onscroll: (path: string, y: number) => void;
    oncommand: (command: ViewCommand) => void;
    onpdfscale?: (value: number) => void;
    onpdfpage?: (path: string, page: number, total: number) => void;
    onrendererror?: (path: string, error: string) => void;
  } = $props();
  let frame = $state<HTMLIFrameElement>();
  let srcdoc = $state('');
  let error = $state('');
  let loading = $state(true);
  let elapsed = $state(0);
  let frameReady = $state(false);
  let expanded = $state(false);
  let retryRequest = $state(0);
  const networkAllowed = $derived(preferences.network);
  const presentationKey = $derived(
    JSON.stringify({
      theme: preferences.theme,
      documentZoom: preferences.documentZoom,
      pdfZoom: preferences.pdfZoom,
      uiZoom: preferences.uiZoom,
      fitWidth: preferences.fitWidth,
    }),
  );
  const delimiterKey = $derived(JSON.stringify(preferences.delimiters));
  let activeChannel = '';
  let allowsMessages = false;
  $effect(() => {
    const text = tab.text;
    const bytes = tab.bytes;
    const path = tab.path;
    const initialScroll = untrack(() => scrollPosition ?? tab.scroll);
    void tab.revision;
    void retryRequest;
    const delimiters = bytes ? [] : JSON.parse(delimiterKey);
    const network = networkAllowed;
    const prefs = untrack(() => ({ ...$state.snapshot(preferences), delimiters, network }));
    const language = isTypst(path) ? 'typst' : isLatex(path) ? 'latex' : undefined;
    const trust = bytes || language ? false : trusted;
    const currentSource = source;
    const controller = new AbortController();
    const channelEntropyWords = 4;
    const channel = crypto.getRandomValues(new Uint32Array(channelEntropyWords)).join('-');
    frameReady = false;
    expanded = false;
    allowsMessages = false;
    activeChannel = '';
    loading = true;
    error = '';
    (async () => {
      try {
        traceStartup('preview-start');
        let document: string;
        let headings: Heading[] = [];
        if (bytes) {
          document = await buildPdfFrame(prefs, initialScroll, channel, path);
          elapsed = 0;
        } else {
          const [result] = await Promise.all([
            parseDocument(text, controller.signal, prefs.delimiters, language).then((result) => {
              if (!controller.signal.aborted) traceStartup('parser-ready');
              return result;
            }),
            loadRuntime().then((runtime) => {
              if (
                !controller.signal.aborted &&
                native &&
                !language &&
                mayContainMath(text, delimiters)
              )
                void warmMathFonts(runtime[1]).catch((error) =>
                  console.error('Could not warm math fonts:', error),
                );
              if (!controller.signal.aborted) traceStartup('renderer-ready');
              return runtime;
            }),
          ]);
          const html = await prepareAssets(result.html, currentSource, path);
          if (!controller.signal.aborted) traceStartup('assets-ready');
          document = await buildFrame(html, prefs, trust, initialScroll, channel);
          headings = result.headings;
          elapsed = Math.round(result.elapsed);
        }
        if (controller.signal.aborted) return;
        traceStartup('frame-built');
        activeChannel = channel;
        allowsMessages = !trust;
        srcdoc = document;
        onheadings(headings);
        loading = false;
      } catch (reason) {
        if (!controller.signal.aborted) {
          error = String(reason);
          loading = false;
          if (bytes && language) onrendererror?.(path, error);
        }
      }
    })();
    return () => controller.abort();
  });
  $effect(() => {
    if (frame && frameReady) frame?.contentWindow?.postMessage({ type: 'search', query }, '*');
  });
  $effect(() => {
    if (frame && frameReady && anchor) {
      frame.contentWindow?.postMessage({ type: 'anchor', id: anchor.id }, '*');
      onanchorconsumed?.(anchor.request);
    }
  });
  $effect(() => {
    const presentation = JSON.parse(presentationKey);
    if (frameReady)
      frame?.contentWindow?.postMessage({ type: 'presentation', ...presentation }, '*');
  });
  function message(event: MessageEvent) {
    if (
      event.source !== frame?.contentWindow ||
      !event.data ||
      !activeChannel ||
      event.data.channel !== activeChannel
    )
      return;
    const data = event.data;
    if (data.type === 'diagram-runtime-request' && !tab.bytes) {
      const channel = activeChannel;
      const sender = event.source;
      const respond = (result: { source?: string; error?: string }) => {
        if (channel === activeChannel && sender === frame?.contentWindow)
          frame.contentWindow?.postMessage({ type: 'diagram-runtime-result', ...result }, '*');
      };
      void loadDiagramRuntime()
        .then((source) => respond({ source }))
        .catch((reason) => respond({ error: String(reason) }));
      return;
    }
    if (
      data.type === 'pdf-page' &&
      tab.bytes &&
      Number.isInteger(data.page) &&
      Number.isInteger(data.total) &&
      data.page >= 1 &&
      data.page <= data.total &&
      data.total <= 1_000_000
    ) {
      onpdfpage?.(tab.path, data.page, data.total);
      return;
    }
    if (data.type === 'pdf-scale' && tab.bytes && Number.isFinite(data.value)) {
      onpdfscale?.(data.value);
      return;
    }
    if (data.type === 'pdf-request' && tab.bytes && allowsMessages) {
      const bytes = tab.bytes.slice();
      frame?.contentWindow?.postMessage({ type: 'pdf-data', bytes }, '*', [bytes.buffer]);
      return;
    }
    if (
      data.type === 'pdf-resource-request' &&
      tab.bytes &&
      allowsMessages &&
      typeof data.name === 'string' &&
      data.name.length <= 128 &&
      Number.isSafeInteger(data.request) &&
      data.request > 0
    ) {
      const channel = activeChannel;
      const sender = event.source;
      const respond = (result: { bytes?: Uint8Array; error?: string }) => {
        if (channel !== activeChannel || sender !== frame?.contentWindow) return;
        const transfer = result.bytes ? [result.bytes.buffer as ArrayBuffer] : [];
        frame.contentWindow?.postMessage(
          { type: 'pdf-resource-result', request: data.request, ...result },
          '*',
          transfer,
        );
      };
      void loadPdfResource(data.name)
        .then((bytes) => respond({ bytes: bytes.slice() }))
        .catch((reason) => respond({ error: String(reason) }));
      return;
    }
    if (data.type === 'pdf-error' && tab.bytes && typeof data.error === 'string') {
      error = data.error.slice(0, 8192);
      loading = false;
      if (isTypst(tab.path) || isLatex(tab.path)) onrendererror?.(tab.path, error);
      return;
    }
    if (data.type === 'headings' && tab.bytes && Array.isArray(data.headings)) {
      onheadings(
        data.headings
          .slice(0, 1000)
          .filter(
            (heading: Heading) =>
              typeof heading.id === 'string' &&
              typeof heading.text === 'string' &&
              Number.isInteger(heading.level) &&
              heading.level >= 1 &&
              heading.level <= 6,
          ),
      );
      return;
    }
    if (data.type === 'ready') {
      frameReady = true;
      if (!tab.bytes) traceStartupPaint('document');
      return;
    }
    if (data.type === 'pdf-rendered' && tab.bytes) {
      traceStartupPaint('pdf-page');
      return;
    }
    if (
      data.type === 'view-command' &&
      ((['document', 'ui'].includes(data.target) && ['in', 'out', 'reset'].includes(data.action)) ||
        (data.target === 'palette' && data.action === 'open') ||
        (data.target === 'document' && data.action === 'fit-width') ||
        (data.target === 'tabs' && ['next', 'previous'].includes(data.action)))
    ) {
      oncommand({ target: data.target, action: data.action } as ViewCommand);
      return;
    }
    if (data.type === 'diagram-expanded' && typeof data.expanded === 'boolean') {
      expanded = data.expanded;
      return;
    }
    if (!allowsMessages) return;
    if (
      data.type === 'diagram-export' &&
      expanded &&
      !tab.bytes &&
      (data.action === 'download' || data.action === 'copy') &&
      (data.mime === 'image/png' || data.mime === 'image/svg+xml') &&
      data.bytes instanceof Uint8Array &&
      data.bytes.length > 0 &&
      data.bytes.length <= 16 * 1024 * 1024 &&
      Number.isSafeInteger(data.request) &&
      data.request > 0
    ) {
      const channel = activeChannel;
      const sender = event.source;
      const respond = (result: { message?: string; error?: string }) => {
        if (channel === activeChannel && sender === frame?.contentWindow && expanded)
          frame.contentWindow?.postMessage(
            { type: 'diagram-export-result', request: data.request, ...result },
            '*',
          );
      };
      void exportDiagram(data.action, data.mime, data.bytes)
        .then((message) => respond({ message }))
        .catch((reason) => respond({ error: String(reason) }));
      return;
    }
    if (data.type === 'navigate' && typeof data.href === 'string' && data.href.length < 8192)
      onlink(data.href);
    if (data.type === 'scroll' && Number.isFinite(data.y))
      onscroll(tab.path, Math.max(0, Math.min(data.y, 100_000_000)));
  }
</script>

<svelte:window onmessage={message} />
<div class="preview-pane" class:expanded aria-busy={!error && (loading || !frameReady)}>
  {#if !error && (loading || !frameReady)}<div class="preview-status" role="status">
      <span class="loading loading-spinner loading-sm"></span> Loading document…
    </div>{/if}
  {#if error}<div class="preview-status error" role="alert">
      <span>{error}</span>
      <button class="btn btn-ghost btn-sm" onclick={() => retryRequest++}>Retry preview</button>
    </div>{/if}
  {#if srcdoc}<iframe
      bind:this={frame}
      class:pending={!frameReady}
      title="{tab.bytes
        ? 'PDF'
        : isTypst(tab.path) || isLatex(tab.path)
          ? 'Source'
          : 'Markdown'} preview: {tab.path}"
      sandbox="allow-scripts"
      referrerpolicy="no-referrer"
      {srcdoc}
    ></iframe>{/if}
  <span class="render-time"
    >{tab.bytes
      ? 'PDF.js · Read-only'
      : isTypst(tab.path) || isLatex(tab.path)
        ? 'Source · Read-only'
        : `${elapsed} ms parse · ${trusted ? 'Scripts enabled' : 'Isolated preview'}`}</span
  >
</div>

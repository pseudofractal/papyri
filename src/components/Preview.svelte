<script module lang="ts">
  const buildModeStore = new Map<string, 'inline' | 'inspector'>();
</script>

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
  import { displayPath, displayPathMessage, isTypst, isLatex } from '../lib/paths';
  import { exportDiagram } from '../lib/diagram-export';
  import { traceStartup, traceStartupPaint } from '../lib/startup-trace';
  import { native } from '../lib/sources';
  import { mayContainMath, warmMathFonts } from '../render/math-fonts';
  import { loadPdfResource } from '../render/pdf-resources';
  import { parseBuildFailure } from '../lib/build-diagnostics';
  import { SCROLL_ACK_TIMEOUT_MS } from '../lib/control-timings';
  import { PreviewNotReadyError } from '../lib/preview-control';
  import { MAX_SCROLL_POSITION } from '../lib/view';
  let {
    tab,
    scrollPosition,
    source,
    preferences,
    trusted,
    query,
    anchor,
    onanchorconsumed,
    onselection,
    onselectioncopy,
    onpagecontext,
    onselectionstats,
    onmatches,
    onpdfpassword,
    onlink,
    onheadings,
    onscroll,
    oncommand,
    onpdfscale,
    onpdfpage,
    onrendererror,
    ondismiss,
    onsourcejump,
    onbuildjump,
    onbuildretry,
    onbuildcopy,
    buildView = true,
    retainDuringUpdate = false,
    onrendered,
    showRenderInfo = true,
    onpdfsourcejump,
  }: {
    tab: Tab;
    scrollPosition?: number;
    source: Source;
    preferences: Preferences;
    trusted: boolean;
    query: string;
    anchor: AnchorTarget | null;
    onanchorconsumed?: (request: number) => void;
    onselection?: (info: {
      text: string;
      source: string;
      preview: string;
      x: number;
      y: number;
    }) => void;
    onselectioncopy?: (info: { kind: 'source' | 'text'; text: string; source: string }) => void;
    onpagecontext?: (info: { x: number; y: number }) => void;
    onselectionstats?: (info: { words: number; characters: number }) => void;
    onmatches?: (count: number) => void;
    onpdfpassword?: (required: boolean) => void;
    onlink: (href: string) => void;
    onheadings: (headings: Heading[]) => void;
    onscroll: (path: string, y: number) => void;
    oncommand: (command: ViewCommand) => void;
    onpdfscale?: (value: number) => void;
    onpdfpage?: (path: string, page: number, total: number) => void;
    onrendererror?: (path: string, error: string) => void;
    ondismiss?: () => void;
    onsourcejump?: (line: number) => void;
    onbuildjump?: (line: number) => void;
    onbuildretry?: () => void;
    onbuildcopy?: (text: string) => void;
    buildView?: boolean;
    retainDuringUpdate?: boolean;
    onrendered?: () => void;
    showRenderInfo?: boolean;
    onpdfsourcejump?: (location: { page: number; x: number; y: number }) => void;
  } = $props();
  let frame = $state<HTMLIFrameElement>();
  let frames = $state<
    { channel: string; document: string; trusted: boolean; bytes?: Uint8Array }[]
  >([]);
  const frameElements = new Map<string, HTMLIFrameElement>();
  let pendingChannel = '';
  function registerFrame(element: HTMLIFrameElement, channel: string) {
    frameElements.set(channel, element);
    if (channel === activeChannel) frame = element;
    return { destroy: () => frameElements.delete(channel) };
  }
  let error = $state('');
  let loading = $state(true);
  let elapsed = $state(0);
  let frameReady = $state(false);
  let expanded = $state(false);
  let expandedKind = $state<'diagram' | 'image' | null>(null);
  let retryRequest = $state(0);
  let scrollRequest = 0;
  const pendingScrolls = new Map<
    number,
    {
      resolve: (y: number) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
  const pendingSelections = new Map<
    number,
    {
      resolve: (value: { text: string; source: string; preview: string }) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
  let selectionRequest = 0;
  let domRequest = 0;
  const pendingDom = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
  export function frameRect() {
    const rect = frame?.getBoundingClientRect();
    return rect ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height } : null;
  }
  export function dom(action: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (!frame || !frameReady) return Promise.reject(new Error('The preview is not ready.'));
    const request = ++domRequest;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingDom.delete(request);
        reject(new Error('The preview did not answer the DOM request.'));
      }, SCROLL_ACK_TIMEOUT_MS);
      pendingDom.set(request, { resolve, reject, timeout });
      frame?.contentWindow?.postMessage({ type: 'dom-request', request, action, params }, '*');
    });
  }
  let selectionSetRequest = 0;
  let selectionClearRequest = 0;
  const pendingSelectionClears = new Map<
    number,
    { resolve: () => void; timeout: ReturnType<typeof setTimeout> }
  >();
  const pendingSelectionSets = new Map<
    number,
    {
      resolve: (found: boolean) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
  export function requestSelection(): Promise<{ text: string; source: string; preview: string }> {
    if (!frame || !frameReady || trusted)
      return Promise.reject(new Error('The preview has no selectable text right now.'));
    const request = ++selectionRequest;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingSelections.delete(request);
        reject(new Error('The preview did not answer the selection request.'));
      }, SCROLL_ACK_TIMEOUT_MS);
      pendingSelections.set(request, { resolve, reject, timeout });
      frame?.contentWindow?.postMessage({ type: 'selection-request', request }, '*');
    });
  }
  export function selectText(text: string): Promise<boolean> {
    if (!frame || !frameReady || trusted)
      return Promise.reject(new Error('The preview is not ready for selection.'));
    if (tab.bytes)
      return Promise.reject(new Error('Setting a selection in PDF previews is not supported.'));
    if (!text) return Promise.reject(new Error('Selection text must not be empty.'));
    const request = ++selectionSetRequest;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingSelectionSets.delete(request);
        reject(new Error('The preview did not answer the selection request.'));
      }, SCROLL_ACK_TIMEOUT_MS);
      pendingSelectionSets.set(request, { resolve, reject, timeout });
      frame?.contentWindow?.postMessage({ type: 'selection-set', request, text }, '*');
    });
  }
  export function clearSelection(): Promise<void> {
    if (!frame || !frameReady)
      return Promise.reject(new Error('The preview is not ready for selection.'));
    const request = ++selectionClearRequest;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingSelectionClears.delete(request);
        reject(new Error('The preview did not answer the selection request.'));
      }, SCROLL_ACK_TIMEOUT_MS);
      pendingSelectionClears.set(request, { resolve, timeout });
      frame?.contentWindow?.postMessage({ type: 'selection-clear', request }, '*');
    });
  }
  export function searchNext(previous = false): void {
    frame?.contentWindow?.postMessage({ type: 'search-next', previous }, '*');
  }
  export function unlockPdf(password: string): void {
    frame?.contentWindow?.postMessage({ type: 'pdf-password', password }, '*');
  }
  export function scrollTo(y: number): Promise<number> {
    if (!Number.isFinite(y)) return Promise.reject(new Error('Scroll position must be finite.'));
    return requestScroll({ y: Math.max(0, y) });
  }
  export function scrollBy(dy: number): Promise<number> {
    if (!Number.isFinite(dy)) return Promise.reject(new Error('Scroll delta must be finite.'));
    return requestScroll({ dy });
  }
  export function documentPath() {
    return tab.path;
  }
  export function revealSource(line: number) {
    if (frameReady) frame?.contentWindow?.postMessage({ type: 'source-reveal', line }, '*');
  }
  export function revealPdf(location: { page: number; x: number; y: number }) {
    if (frameReady)
      frame?.contentWindow?.postMessage({ type: 'pdf-source-reveal', ...location }, '*');
  }
  function requestScroll(payload: { y?: number; dy?: number }): Promise<number> {
    if (!frame || !frameReady) return Promise.reject(new PreviewNotReadyError());
    const request = ++scrollRequest;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingScrolls.delete(request);
        reject(new Error('The preview did not acknowledge the scroll.'));
      }, SCROLL_ACK_TIMEOUT_MS);
      pendingScrolls.set(request, { resolve, reject, timeout });
      frame?.contentWindow?.postMessage({ type: 'scroll', request, ...payload }, '*');
    });
  }
  function cancelScrolls(reason: string) {
    for (const pending of pendingScrolls.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(reason));
    }
    pendingScrolls.clear();
  }
  const networkAllowed = $derived(preferences.network);
  const presentationKey = $derived(
    JSON.stringify({
      theme: preferences.theme,
      documentZoom: preferences.documentZoom,
      pdfZoom: preferences.pdfZoom,
      uiZoom: preferences.uiZoom,
      fitWidth: preferences.fitWidth,
      textFont: preferences.textFont,
      codeFont: preferences.codeFont,
      mathFont: preferences.mathFont,
      uiFont: preferences.uiFont,
    }),
  );
  const delimiterKey = $derived(JSON.stringify(preferences.delimiters));
  let activeChannel = $state('');
  let allowsMessages = false;
  let buildModes = $state<Record<string, 'inline' | 'inspector'>>({});
  const buildLanguage = $derived(
    isTypst(tab.path) ? 'typst' : isLatex(tab.path) ? 'latex' : undefined,
  );
  const buildFailure = $derived(
    buildView &&
      buildLanguage &&
      tab.compilationError &&
      /compilation failed/i.test(tab.compilationError)
      ? parseBuildFailure(tab.compilationError, buildLanguage, tab.path)
      : null,
  );
  const failedSource = $derived(!!buildFailure && !tab.bytes);
  const buildMode = $derived(buildModes[tab.path] ?? buildModeStore.get(tab.path) ?? 'inline');
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
    const build =
      failedSource && buildFailure
        ? {
            path,
            failure: buildFailure,
            mode: untrack(() => buildMode),
          }
        : undefined;
    const trust = bytes || language ? false : trusted;
    const currentSource = source;
    const controller = new AbortController();
    const channelEntropyWords = 4;
    const channel = crypto.getRandomValues(new Uint32Array(channelEntropyWords)).join('-');
    expanded = false;
    expandedKind = null;
    const keepVisible = (!!onsourcejump || retainDuringUpdate) && untrack(() => frameReady);
    if (!keepVisible) {
      frameReady = false;
      allowsMessages = false;
      activeChannel = '';
    } else {
      pendingChannel = '';
      frames = untrack(() => frames.filter((item) => item.channel === activeChannel));
    }
    loading = !keepVisible;
    error = '';
    cancelScrolls('The preview changed.');
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
            parseDocument(text, controller.signal, prefs.delimiters, language, build).then(
              (result) => {
                if (!controller.signal.aborted) traceStartup('parser-ready');
                return result;
              },
            ),
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
          document = await buildFrame(html, prefs, trust, initialScroll, channel, text);
          headings = result.headings;
          elapsed = Math.round(result.elapsed);
        }
        if (controller.signal.aborted) return;
        traceStartup('frame-built');
        if (keepVisible) {
          pendingChannel = channel;
          frames = [
            ...frames.filter((item) => item.channel === activeChannel),
            { channel, document, trusted: trust, bytes },
          ];
        } else {
          pendingChannel = '';
          activeChannel = channel;
          allowsMessages = !trust;
          frames = [{ channel, document, trusted: trust, bytes }];
        }
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
    const pending = frames.find((item) => item.channel === pendingChannel);
    const pendingFrame = pending && frameElements.get(pending.channel)?.contentWindow;
    if (
      pending &&
      event.source === pendingFrame &&
      event.data?.channel === pending.channel &&
      pending.bytes
    ) {
      if (event.data.type === 'pdf-request') {
        const bytes = pending.bytes.slice();
        pendingFrame?.postMessage({ type: 'pdf-data', bytes }, '*', [bytes.buffer]);
        return;
      }
      if (
        event.data.type === 'pdf-resource-request' &&
        typeof event.data.name === 'string' &&
        event.data.name.length <= 128 &&
        Number.isSafeInteger(event.data.request) &&
        event.data.request > 0
      ) {
        const request = event.data.request;
        void loadPdfResource(event.data.name)
          .then((bytes) => {
            if (pendingChannel === pending.channel)
              pendingFrame?.postMessage({ type: 'pdf-resource-result', request, bytes }, '*', [
                bytes.buffer as ArrayBuffer,
              ]);
          })
          .catch((reason: unknown) => {
            if (pendingChannel === pending.channel)
              pendingFrame?.postMessage(
                { type: 'pdf-resource-result', request, error: String(reason) },
                '*',
              );
          });
        return;
      }
      if (event.data.type === 'pdf-error') {
        error =
          typeof event.data.error === 'string'
            ? event.data.error.slice(0, 8192)
            : 'Could not render PDF.';
        pendingChannel = '';
        frames = frames.filter((item) => item.channel === activeChannel);
        onrendererror?.(tab.path, error);
        return;
      }
    }
    if (
      pending &&
      event.source === frameElements.get(pending.channel)?.contentWindow &&
      event.data?.channel === pending.channel &&
      event.data?.type === (pending.bytes ? 'pdf-rendered' : 'ready')
    ) {
      frame = frameElements.get(pending.channel);
      activeChannel = pending.channel;
      allowsMessages = !pending.trusted;
      pendingChannel = '';
      frames = [pending];
      frameReady = true;
      if (onsourcejump)
        frame?.contentWindow?.postMessage({ type: 'source-navigation', enabled: true }, '*');
      if (onpdfsourcejump)
        frame?.contentWindow?.postMessage({ type: 'pdf-source-navigation', enabled: true }, '*');
      if (!tab.bytes) traceStartupPaint('document');
      onrendered?.();
      return;
    }
    if (
      event.source !== frame?.contentWindow ||
      !event.data ||
      !activeChannel ||
      event.data.channel !== activeChannel
    )
      return;
    const data = event.data;
    if (
      data.type === 'pdf-source-jump' &&
      allowsMessages &&
      tab.bytes &&
      Number.isSafeInteger(data.page) &&
      data.page > 0 &&
      Number.isFinite(data.x) &&
      Number.isFinite(data.y) &&
      data.x >= 0 &&
      data.y >= 0
    ) {
      onpdfsourcejump?.({ page: data.page, x: data.x, y: data.y });
      return;
    }
    if (
      data.type === 'source-jump' &&
      allowsMessages &&
      Number.isSafeInteger(data.line) &&
      data.line >= 0
    ) {
      onsourcejump?.(data.line);
      return;
    }
    if (
      data.type === 'build-jump' &&
      allowsMessages &&
      Number.isSafeInteger(data.line) &&
      data.line > 0
    ) {
      onbuildjump?.(data.line);
      return;
    }
    if (data.type === 'build-action' && allowsMessages && typeof data.action === 'string') {
      if (data.action === 'retry') onbuildretry?.();
      else if (data.action === 'copy-log') onbuildcopy?.(buildFailure?.log ?? '');
      else if (data.action === 'mode' && (data.mode === 'inline' || data.mode === 'inspector')) {
        buildModeStore.set(tab.path, data.mode);
        buildModes = { ...buildModes, [tab.path]: data.mode };
      }
      return;
    }
    if (data.type === 'dismiss') {
      ondismiss?.();
      return;
    }
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
    if (
      data.type === 'matches' &&
      Number.isInteger(data.count) &&
      data.count >= 0 &&
      data.count <= 1_000_000
    ) {
      onmatches?.(data.count);
      return;
    }
    if (data.type === 'dom-result' && Number.isSafeInteger(data.request)) {
      const pending = pendingDom.get(data.request);
      if (pending) {
        pendingDom.delete(data.request);
        clearTimeout(pending.timeout);
        if (typeof data.error === 'string') pending.reject(new Error(data.error));
        else pending.resolve(data.result);
      }
      return;
    }
    if (data.type === 'selection-clear-result' && Number.isSafeInteger(data.request)) {
      const pending = pendingSelectionClears.get(data.request);
      if (pending) {
        pendingSelectionClears.delete(data.request);
        clearTimeout(pending.timeout);
        pending.resolve();
      }
      return;
    }
    if (data.type === 'selection-set-result' && Number.isSafeInteger(data.request)) {
      const pending = pendingSelectionSets.get(data.request);
      if (pending) {
        pendingSelectionSets.delete(data.request);
        clearTimeout(pending.timeout);
        pending.resolve(data.found === true);
      }
      return;
    }
    if (data.type === 'selection-result' && Number.isSafeInteger(data.request)) {
      const pending = pendingSelections.get(data.request);
      if (pending) {
        pendingSelections.delete(data.request);
        clearTimeout(pending.timeout);
        if (
          typeof data.text === 'string' &&
          typeof data.source === 'string' &&
          typeof data.preview === 'string'
        )
          pending.resolve({
            text: data.text.slice(0, 50_000),
            source: data.source.slice(0, 100_000),
            preview: data.preview.slice(0, 20_000),
          });
        else pending.reject(new Error('The preview returned an invalid selection.'));
      }
      return;
    }
    if (data.type === 'pdf-password-required' && typeof data.required === 'boolean') {
      onpdfpassword?.(data.required);
      return;
    }
    if (
      data.type === 'selection-stats' &&
      allowsMessages &&
      Number.isInteger(data.words) &&
      Number.isInteger(data.characters) &&
      data.words >= 0 &&
      data.characters >= 0
    ) {
      onselectionstats?.({
        words: Math.min(data.words, 10_000_000),
        characters: Math.min(data.characters, 100_000_000),
      });
      return;
    }
    if (
      data.type === 'context-menu' &&
      allowsMessages &&
      !tab.bytes &&
      Number.isFinite(data.x) &&
      Number.isFinite(data.y)
    ) {
      const bounds = frame?.getBoundingClientRect();
      if (bounds) onpagecontext?.({ x: bounds.left + data.x, y: bounds.top + data.y });
      return;
    }
    if (
      data.type === 'selection-copy' &&
      allowsMessages &&
      !tab.bytes &&
      (data.kind === 'source' || data.kind === 'text') &&
      typeof data.text === 'string' &&
      typeof data.source === 'string'
    ) {
      onselectioncopy?.({
        kind: data.kind,
        text: data.text.slice(0, 50_000),
        source: data.source.slice(0, 100_000),
      });
      return;
    }
    if (
      data.type === 'selection-menu' &&
      allowsMessages &&
      !tab.bytes &&
      typeof data.text === 'string' &&
      typeof data.source === 'string' &&
      typeof data.preview === 'string' &&
      Number.isFinite(data.x) &&
      Number.isFinite(data.y)
    ) {
      const bounds = frame?.getBoundingClientRect();
      if (bounds) {
        onselection?.({
          text: data.text.slice(0, 50_000),
          source: data.source.slice(0, 100_000),
          preview: data.preview.slice(0, 20_000),
          x: bounds.left + data.x,
          y: bounds.top + data.y,
        });
      }
      return;
    }
    if (data.type === 'ready') {
      frameReady = true;
      if (onsourcejump)
        frame?.contentWindow?.postMessage({ type: 'source-navigation', enabled: true }, '*');
      if (onpdfsourcejump)
        frame?.contentWindow?.postMessage({ type: 'pdf-source-navigation', enabled: true }, '*');
      if (!tab.bytes) traceStartupPaint('document');
      return;
    }
    if (data.type === 'pdf-rendered' && tab.bytes) {
      traceStartupPaint('pdf-page');
      onrendered?.();
      return;
    }
    if (
      data.type === 'view-command' &&
      ((['document', 'ui'].includes(data.target) && ['in', 'out', 'reset'].includes(data.action)) ||
        (data.target === 'palette' && data.action === 'open') ||
        (data.target === 'view' && data.action === 'decorationless') ||
        (data.target === 'document' && data.action === 'fit-width') ||
        (data.target === 'tabs' && ['next', 'previous'].includes(data.action)))
    ) {
      oncommand({ target: data.target, action: data.action } as ViewCommand);
      return;
    }
    if (
      (data.type === 'diagram-expanded' || data.type === 'image-expanded') &&
      typeof data.expanded === 'boolean'
    ) {
      expanded = data.expanded;
      expandedKind = data.expanded
        ? data.type === 'diagram-expanded'
          ? 'diagram'
          : 'image'
        : null;
      return;
    }
    if (
      data.type === 'scroll-done' &&
      Number.isSafeInteger(data.request) &&
      Number.isFinite(data.y)
    ) {
      const pending = pendingScrolls.get(data.request);
      if (pending) {
        pendingScrolls.delete(data.request);
        clearTimeout(pending.timeout);
        pending.resolve(data.y);
        // Trusted frames acknowledge control scrolling but do not update the
        // host's scroll bookmark; that policy keeps scripted documents inert.
        if (allowsMessages) onscroll(tab.path, Math.max(0, Math.min(data.y, MAX_SCROLL_POSITION)));
      }
      return;
    }
    if (!allowsMessages) return;
    if (
      data.type === 'diagram-export' &&
      expandedKind === 'diagram' &&
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
        if (
          channel === activeChannel &&
          sender === frame?.contentWindow &&
          expandedKind === 'diagram'
        )
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
      onscroll(tab.path, Math.max(0, Math.min(data.y, MAX_SCROLL_POSITION)));
  }
  // WebKitGTK retargets wheel events over an iframe to the host without scrolling
  // the frame. Forward the delta using positions relative to the frame viewport.
  function forwardWheel(event: WheelEvent) {
    if (!frame || event.target !== frame || !activeChannel) return;
    if (!Number.isFinite(event.deltaX) || !Number.isFinite(event.deltaY)) return;
    if (!event.deltaX && !event.deltaY) return;
    const bounds = frame.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    event.preventDefault();
    const lineHeight = 16;
    const multiplier = event.deltaMode === 1 ? lineHeight : 1;
    frame.contentWindow?.postMessage(
      {
        type: 'wheel',
        x: (event.clientX - bounds.left) / bounds.width,
        y: (event.clientY - bounds.top) / bounds.height,
        deltaX: event.deltaX * multiplier,
        deltaY: event.deltaY * multiplier,
        scale: preferences.uiZoom / 100,
      },
      '*',
    );
  }
</script>

<svelte:window onmessage={message} />
<div
  class="preview-pane"
  class:expanded
  aria-busy={!error && (loading || !frameReady)}
  onwheel={forwardWheel}
>
  {#if !error && (loading || !frameReady)}<div class="preview-status" role="status">
      <span class="loading loading-spinner loading-sm"></span> Loading document…
    </div>{/if}
  {#if error}<div class="preview-status error" role="alert">
      <span>{displayPathMessage(error)}</span>
      <button class="btn btn-ghost btn-sm" onclick={() => retryRequest++}>Retry preview</button>
    </div>{/if}
  {#each frames as item (item.channel)}<iframe
      use:registerFrame={item.channel}
      class:pending={item.channel !== activeChannel || !frameReady}
      class:buffered={item.channel !== activeChannel && frameReady}
      title="{tab.bytes
        ? 'PDF'
        : isTypst(tab.path) || isLatex(tab.path)
          ? 'Source'
          : 'Markdown'} preview: {displayPath(tab.path)}"
      sandbox="allow-scripts"
      referrerpolicy="no-referrer"
      srcdoc={item.document}
    ></iframe>{/each}
  {#if showRenderInfo && !failedSource}<span class="render-time"
      >{tab.bytes
        ? 'PDF.js · Read-only'
        : isTypst(tab.path) || isLatex(tab.path)
          ? 'Source · Read-only'
          : `${elapsed} ms parse · ${trusted ? 'Scripts enabled' : 'Isolated preview'}`}</span
    >{/if}
</div>

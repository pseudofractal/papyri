<script lang="ts">
  import { untrack } from 'svelte';
  import type { ViewCommand } from '../lib/view';
  import { parseDocument } from '../render/client';
  import { prepareAssets, buildFrame } from '../render/sandbox';
  import type { Preferences, Source, Heading } from '../lib/types';
  import type { AnchorTarget, Tab } from '../lib/workspace.svelte';
  let {
    tab,
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
  }: {
    tab: Tab;
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
  } = $props();
  let frame = $state<HTMLIFrameElement>();
  let srcdoc = $state('');
  let error = $state('');
  let loading = $state(true);
  let elapsed = $state(0);
  let frameReady = $state(false);
  let expanded = $state(false);
  const networkAllowed = $derived(preferences.network);
  const presentationKey = $derived(
    JSON.stringify({
      theme: preferences.theme,
      documentZoom: preferences.documentZoom,
      uiZoom: preferences.uiZoom,
      fitWidth: preferences.fitWidth,
    }),
  );
  const delimiterKey = $derived(JSON.stringify(preferences.delimiters));
  let activeChannel = '';
  let allowsMessages = false;
  $effect(() => {
    const currentTab = tab;
    const text = tab.text;
    const path = tab.path;
    void tab.revision;
    const delimiters = JSON.parse(delimiterKey);
    const network = networkAllowed;
    const prefs = untrack(() => ({ ...$state.snapshot(preferences), delimiters, network }));
    const trust = trusted;
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
        const result = await parseDocument(text, controller.signal, prefs.delimiters);
        const html = await prepareAssets(result.html, currentSource, path);
        const document = await buildFrame(html, prefs, trust, currentTab.scroll, channel);
        if (controller.signal.aborted) return;
        elapsed = Math.round(result.elapsed);
        activeChannel = channel;
        allowsMessages = !trust;
        srcdoc = document;
        onheadings(result.headings);
        loading = false;
      } catch (reason) {
        if (!controller.signal.aborted) {
          error = String(reason);
          loading = false;
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
    if (data.type === 'ready') {
      frameReady = true;
      return;
    }
    if (
      data.type === 'view-command' &&
      ((['document', 'ui'].includes(data.target) && ['in', 'out', 'reset'].includes(data.action)) ||
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
    if (trusted || !allowsMessages) return;
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
  {#if error}<div class="preview-status error" role="alert">{error}</div>{/if}
  {#if srcdoc}<iframe
      bind:this={frame}
      class:pending={!frameReady}
      title="Markdown preview: {tab.path}"
      sandbox="allow-scripts"
      referrerpolicy="no-referrer"
      {srcdoc}
    ></iframe>{/if}
  <span class="render-time"
    >{elapsed} ms parse · {trusted ? 'Scripts enabled' : 'Isolated preview'}</span
  >
</div>

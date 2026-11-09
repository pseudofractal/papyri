<script lang="ts">
  import { onMount } from 'svelte';
  import type { LSPClient } from '@codemirror/lsp-client';
  import { connectEditorLanguageServer, fileUri, type LspDiagnostic } from '../lib/editor-lsp';
  import { dirname, displayPathMessage } from '../lib/paths';
  import { previewLocation, previewPort, type PreviewLocation } from '../lib/typst-live-preview';
  import { buildFailureFromLspDiagnostics } from '../lib/build-diagnostics';
  import { Minus, Plus, Maximize2 } from '@lucide/svelte';

  let {
    path,
    serverPath,
    getDocuments,
    diagnostics = [],
    onjump,
  }: {
    path: string;
    serverPath: string;
    getDocuments: () => { path: string; text: string }[];
    diagnostics?: LspDiagnostic[];
    onjump: (location: PreviewLocation) => void;
  } = $props();

  const buildFailure = $derived(buildFailureFromLspDiagnostics(diagnostics, 'typst', path));

  let url = $state('');
  let status = $state('Starting live preview…');
  let client: LSPClient | undefined;
  let ready = false;
  let disposed = false;
  let viewport = $state<HTMLDivElement>();
  let frame = $state<HTMLIFrameElement>();
  let frameRevision = $state(0);
  let zoom = $state(100);
  const minZoom = 10;
  const maxZoom = 1000;

  function zoomPreview(action: 'in' | 'out') {
    if (url)
      frame?.contentWindow?.postMessage(
        { type: 'papyri-typst-zoom-command', action },
        new URL(url).origin,
      );
  }

  function receiveZoom(event: MessageEvent) {
    if (!url || event.origin !== new URL(url).origin || event.source !== frame?.contentWindow)
      return;
    if (event.data?.type !== 'papyri-typst-zoom' || !Number.isFinite(event.data.ratio)) return;
    zoom = Math.round(event.data.ratio * 100);
  }

  function fitWidth() {
    zoom = 100;
    if (viewport) viewport.scrollLeft = 0;
    frameRevision++;
  }
  let syncTimer: ReturnType<typeof setTimeout> | undefined;
  let positionTimer: ReturnType<typeof setTimeout> | undefined;
  const documents = new Map<
    string,
    { text: string; version: number; opened: boolean; dirty: boolean }
  >();
  const taskId = `papyri-${crypto.randomUUID()}`;

  function flush() {
    if (!client || !ready || disposed) return;
    for (const [documentPath, document] of documents) {
      if (!document.dirty) continue;
      document.version++;
      if (document.opened) {
        client.notification('textDocument/didChange', {
          textDocument: { uri: fileUri(documentPath), version: document.version },
          contentChanges: [{ text: document.text }],
        });
      } else {
        client.notification('textDocument/didOpen', {
          textDocument: {
            uri: fileUri(documentPath),
            languageId: 'typst',
            version: document.version,
            text: document.text,
          },
        });
        document.opened = true;
      }
      document.dirty = false;
    }
  }

  /** Send the latest unsaved version without writing it to disk. */
  export function updateDocument(documentPath: string, text: string) {
    const current = documents.get(documentPath);
    if (current?.text === text) return;
    documents.set(documentPath, {
      text,
      version: current?.version ?? 0,
      opened: current?.opened ?? false,
      dirty: true,
    });
    clearTimeout(syncTimer);
    syncTimer = setTimeout(flush, 80);
  }

  /** Fit the rendered preview to the available width. */
  export function fit() {
    fitWidth();
  }

  /** Change the rendered preview zoom from a control client. */
  export function zoomBy(action: 'in' | 'out') {
    zoomPreview(action);
  }

  /** Reveal an editor location in the rendered document. */
  export function reveal(documentPath: string, line: number, character: number) {
    clearTimeout(positionTimer);
    positionTimer = setTimeout(() => {
      if (!client || !url || disposed) return;
      flush();
      void client
        .request('workspace/executeCommand', {
          command: 'tinymist.scrollPreview',
          arguments: [taskId, { event: 'panelScrollTo', filepath: documentPath, line, character }],
        })
        .catch((error: unknown) => {
          if (!disposed) status = `Could not navigate preview: ${String(error)}`;
        });
    }, 100);
  }

  onMount(() => {
    let close: (() => Promise<void>) | undefined;
    for (const document of getDocuments()) updateDocument(document.path, document.text);
    void (async () => {
      try {
        const connection = await connectEditorLanguageServer(
          'typst',
          dirname(path),
          serverPath,
          (message) => {
            if (!disposed) {
              ready = false;
              url = '';
              status = message;
            }
          },
          (value) => {
            const location = previewLocation(value, path);
            if (location && !disposed) {
              clearTimeout(positionTimer);
              onjump(location);
            }
          },
        );
        close = connection.close;
        if (disposed) {
          await close();
          return;
        }
        client = connection.client;
        await client.initializing;
        if (disposed) return;
        ready = true;
        flush();
        const result = await client.request<unknown, unknown>('workspace/executeCommand', {
          command: 'tinymist.doStartPreview',
          arguments: [['--task-id', taskId, '--data-plane-host', '127.0.0.1:0', '--no-open', path]],
        });
        if (disposed) return;
        // Opening included files before the preview task exists may not invalidate
        // its initial compilation. Resend the overlays once the task is running.
        for (const document of documents.values()) document.dirty = true;
        flush();
        url = `http://127.0.0.1:${previewPort(result)}/`;
        status = '';
      } catch (error) {
        if (!disposed) status = `Live preview unavailable: ${String(error)}`;
      }
    })();
    return () => {
      disposed = true;
      clearTimeout(syncTimer);
      clearTimeout(positionTimer);
      if (close) void close().catch((error: unknown) => console.error(error));
    };
  });
</script>

<svelte:window onmessage={receiveZoom} />
<div class="typst-live-preview" aria-label="Live Typst preview">
  <div class="typst-preview-heading">
    <span>Live preview</span>
    <div class="preview-zoom" role="group" aria-label="Live preview zoom">
      <button
        class="icon-button small"
        aria-label="Zoom out live preview"
        disabled={!url || zoom <= minZoom}
        onclick={() => zoomPreview('out')}><Minus size={14} /></button
      >
      <span aria-label="Zoom level">{zoom}%</span>
      <button
        class="icon-button small"
        aria-label="Zoom in live preview"
        disabled={!url || zoom >= maxZoom}
        onclick={() => zoomPreview('in')}><Plus size={14} /></button
      >
      <button
        class="icon-button small"
        aria-label="Fit live preview to width"
        title="Fit to width"
        onclick={fitWidth}><Maximize2 size={14} /></button
      >
    </div>
  </div>
  {#if status}<div class="typst-preview-status" role="status">
      {displayPathMessage(status)}
    </div>{/if}
  {#if buildFailure}
    <div class="typst-preview-paused" role="status">
      <strong>Preview paused</strong>
      <span>Fix the error in the editor to resume the live preview.</span>
    </div>
  {:else if url}<div class="preview-viewport" bind:this={viewport}>
      {#key frameRevision}<iframe
          bind:this={frame}
          title="Live Typst preview"
          src={url}
          sandbox="allow-scripts allow-same-origin"
          referrerpolicy="no-referrer"
        ></iframe>{/key}
    </div>{/if}
</div>

<style>
  .typst-live-preview {
    display: flex;
    flex: 1;
    min-width: 0;
    min-height: 0;
    flex-direction: column;
    border-left: 1px solid var(--line);
  }
  .typst-preview-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
    padding: 5px 12px;
    color: var(--muted);
    font-size: 11px;
    border-bottom: 1px solid var(--line);
  }
  .preview-zoom {
    display: flex;
    align-items: center;
    gap: 2px;
    font-variant-numeric: tabular-nums;
  }
  .preview-zoom > span {
    min-width: 3em;
    text-align: center;
  }
  .typst-preview-status {
    padding: 12px;
    color: var(--muted);
    font-size: 12px;
    overflow-wrap: anywhere;
  }
  .typst-preview-paused {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 20px;
    color: var(--muted);
    text-align: center;
    font-size: 12px;
  }
  .typst-preview-paused strong {
    color: var(--color-base-content);
    font-size: 13px;
  }
  .preview-viewport {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: white;
  }
  iframe {
    display: block;
    zoom: calc(1 / var(--ui-scale, 1));
    width: 100%;
    height: 100%;
    border: 0;
    background: white;
  }
  @media (max-width: 700px) {
    .typst-live-preview {
      border-left: 0;
      border-top: 1px solid var(--line);
    }
  }
</style>

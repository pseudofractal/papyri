<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import { Maximize2, RefreshCw } from '@lucide/svelte';
  import Preview from './Preview.svelte';
  import ZoomControls from './ZoomControls.svelte';
  import { invokeHost } from '../lib/native';
  import { parseBuildFailure, type BuildFailure } from '../lib/build-diagnostics';
  import { displayPathMessage } from '../lib/paths';
  import { clampZoom, MIN_PDF_ZOOM, MAX_PDF_ZOOM, type ViewCommand } from '../lib/view';
  import type { Preferences, Source } from '../lib/types';
  import type { Tab } from '../lib/workspace.svelte';
  import { parseSyncPdf, parseSyncSource, type SyncPdfLocation } from '../lib/synctex';

  let {
    path,
    text,
    savedText,
    initialTab,
    source,
    preferences,
    onpreferences,
    oncommand,
    onjump,
    onbuildfailure,
    overlays,
  }: {
    path: string;
    text: string;
    savedText: string;
    initialTab: Tab;
    source: Source;
    preferences: Preferences;
    onpreferences: (value: Preferences) => void;
    oncommand: (command: ViewCommand) => void;
    onjump: (location: { path: string; line: number; character: number }) => void;
    onbuildfailure?: (failure: BuildFailure | null) => void;
    overlays: [string, string][];
  } = $props();
  const initial = untrack(() => ({
    bytes: initialTab.bytes,
    text: savedText,
    engine: preferences.latexEngine,
    compilerPath: preferences.latexPaths[preferences.latexEngine],
    error: initialTab.error,
  }));
  let bytes = $state.raw<Uint8Array | undefined>(initial.bytes);
  let compiledText = $state(initial.bytes ? initial.text : '');
  let compiledEngine = $state(initial.bytes ? initial.engine : '');
  let compiledPath = $state(initial.bytes ? initial.compilerPath : '');
  let compiledOverlays = $state('[]');
  let live = $state(false);
  let compiling = $state(false);
  let updating = $state(false);
  let renderFailed = $state(false);
  let error = $state(initial.error || '');
  let failedKey = $state('');
  let revision = $state(0);
  let scroll = $state(0);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let queued = false;
  let compileSeconds = $state(0);
  let compileStartedAt = 0;
  let compileClock: ReturnType<typeof setInterval> | undefined;
  let lastCompileSeconds = $state<number | null>(null);
  let stopping = $state(false);
  let preview = $state<{ revealPdf: (location: SyncPdfLocation) => void }>();
  let activeSyncId = '';
  let pendingSyncId = '';
  let syncRequest = 0;
  interface CompileStatus {
    id: number;
    path: string;
    engine: string;
    elapsedSeconds: number;
  }
  function releaseSync(id: string) {
    if (id)
      void invokeHost('latex_sync_release', { id }).catch((reason: unknown) =>
        console.error('Could not release SyncTeX data:', reason),
      );
  }
  const stale = $derived(
    !bytes ||
      renderFailed ||
      compiledText !== text ||
      compiledEngine !== preferences.latexEngine ||
      compiledPath !== preferences.latexPaths[preferences.latexEngine] ||
      compiledOverlays !== JSON.stringify(overlays),
  );
  const currentKey = $derived(
    JSON.stringify([
      text,
      preferences.latexEngine,
      preferences.latexPaths[preferences.latexEngine],
      overlays,
    ]),
  );
  const compileFailure = $derived(
    error && /compilation failed/i.test(error) ? parseBuildFailure(error, 'latex', path) : null,
  );
  const compileBusy = $derived(/Another LaTeX preview is compiling/.test(error));
  $effect(() => {
    onbuildfailure?.(compileFailure);
  });
  $effect(() => {
    if (disposed || bytes) return;
    const tab = initialTab;
    if (!tab.bytes || tab.path !== path) return;
    bytes = tab.bytes;
    compiledText = savedText;
    compiledEngine = preferences.latexEngine;
    compiledPath = preferences.latexPaths[preferences.latexEngine];
    compiledOverlays = '[]';
    revision++;
  });

  function startCompileClock() {
    compileStartedAt = Date.now();
    compileSeconds = 0;
    clearInterval(compileClock);
    compileClock = setInterval(() => {
      compileSeconds = Math.floor((Date.now() - compileStartedAt) / 1000);
    }, 500);
  }
  function stopCompileClock() {
    clearInterval(compileClock);
    compileClock = undefined;
  }
  async function cancelCompile(pathOnly: boolean) {
    stopping = true;
    queued = false;
    try {
      await invokeHost<boolean>('latex_cancel_compile', pathOnly ? { path } : {});
      if (!disposed) {
        error = '';
        failedKey = currentKey;
      }
    } catch (reason) {
      if (!disposed) error = String(reason);
    } finally {
      if (!disposed) stopping = false;
    }
  }
  async function stopOtherAndRetry() {
    await cancelCompile(false);
    if (!disposed) void recompile();
  }

  async function recompile() {
    clearTimeout(timer);
    if (compiling) {
      queued = true;
      return;
    }
    const snapshot = text;
    const engine = preferences.latexEngine;
    const compilerPath = preferences.latexPaths[engine];
    const overlaySnapshot = overlays.map(([file, content]) => [file, content] as [string, string]);
    const key = JSON.stringify([snapshot, engine, compilerPath, overlaySnapshot]);
    syncRequest++;
    compiling = true;
    stopping = false;
    startCompileClock();
    error = '';
    try {
      const result = await invokeHost<ArrayBuffer>('compile_latex_draft', {
        path,
        text: snapshot,
        engine,
        compilerPath,
        overlays: overlaySnapshot,
      });
      const response = new Uint8Array(result);
      const id = new TextDecoder().decode(response.subarray(0, 32));
      if (!/^[0-9a-f]{32}$/.test(id) || response.length <= 32)
        throw new Error('Invalid synchronized PDF response.');
      if (disposed) {
        releaseSync(id);
        return;
      }
      releaseSync(pendingSyncId);
      pendingSyncId = id;
      bytes = response.slice(32);
      updating = true;
      compiledText = snapshot;
      compiledEngine = engine;
      compiledPath = compilerPath;
      compiledOverlays = JSON.stringify(overlaySnapshot);
      failedKey = '';
      revision++;
      lastCompileSeconds = (Date.now() - compileStartedAt) / 1000;
    } catch (reason) {
      if (!disposed) {
        const message = String(reason);
        if (/compilation cancelled/i.test(message)) {
          error = '';
          failedKey = key;
        } else {
          error = message;
          failedKey = key;
        }
      }
    } finally {
      stopCompileClock();
      if (!disposed) {
        compiling = false;
        if (queued) {
          queued = false;
          void recompile();
        }
      }
    }
  }
  $effect(() => {
    if (!live || !stale || compiling || failedKey === currentKey) return;
    timer = setTimeout(() => void recompile(), 800);
    return () => clearTimeout(timer);
  });
  async function startInitialCompile() {
    if (!initial.bytes && initial.error) return;
    try {
      // Opening the editor can race the workspace's initial preview read by a
      // few milliseconds. Give that read a chance to register before deciding
      // that no compile is in progress.
      if (!initial.bytes && !initial.error) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      // The workspace may already be compiling this document for its initial
      // preview. Wait for that compile instead of racing it and reporting a
      // misleading "another preview is compiling" error.
      for (let attempt = 0; attempt < 350 && !disposed && !bytes; attempt++) {
        const status = await invokeHost<CompileStatus | null>('latex_compile_status');
        if (!status || status.path !== path) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } catch (reason) {
      console.error('Could not read LaTeX compile status:', reason);
    }
    if (!disposed && !bytes && stale) void recompile();
  }
  onMount(() => {
    void startInitialCompile();
  });
  export function reveal(source: string, line: number) {
    if (!activeSyncId || stale || compiling || updating) return;
    const request = ++syncRequest;
    void invokeHost<string>('latex_sync', { id: activeSyncId, source, line: line + 1 })
      .then((result) => {
        if (disposed || request !== syncRequest || stale || compiling || updating) return;
        const location = parseSyncPdf(result);
        if (location) preview?.revealPdf(location);
      })
      .catch((reason: unknown) => {
        if (!disposed && request === syncRequest) error = String(reason);
      });
  }
  function jumpFromPdf(location: SyncPdfLocation) {
    if (!activeSyncId || stale || compiling || updating) return;
    const request = ++syncRequest;
    void invokeHost<string>('latex_sync', { id: activeSyncId, ...location })
      .then((result) => {
        if (disposed || request !== syncRequest || stale || compiling || updating) return;
        const source = parseSyncSource(result);
        if (source) onjump({ path: source.path, line: source.line, character: source.column });
      })
      .catch((reason: unknown) => {
        if (!disposed && request === syncRequest) error = String(reason);
      });
  }
  onDestroy(() => {
    disposed = true;
    clearTimeout(timer);
    stopCompileClock();
    if (compiling) {
      void invokeHost('latex_cancel_compile', { path }).catch((reason: unknown) =>
        console.error('Could not cancel LaTeX compilation:', reason),
      );
    }
    releaseSync(activeSyncId);
    releaseSync(pendingSyncId);
  });
</script>

<div class="latex-live-preview">
  <div class="typst-editor-heading">
    <span
      title={lastCompileSeconds != null
        ? `Last compile: ${lastCompileSeconds.toFixed(1)}s`
        : 'PDF preview'}>PDF</span
    >
    <label class="latex-live-toggle"><input type="checkbox" bind:checked={live} /> Live</label>
    <button
      class="btn btn-ghost btn-xs"
      onclick={() => void recompile()}
      disabled={compiling}
      title="Compile the current source"><RefreshCw size={13} /> Recompile</button
    >
    {#if compiling}
      <button
        class="btn btn-ghost btn-xs"
        onclick={() => void cancelCompile(true)}
        disabled={stopping}
        title="Stop the current LaTeX compilation">{stopping ? 'Stopping…' : 'Stop'}</button
      >
    {/if}
    <ZoomControls
      label="LaTeX preview"
      value={preferences.pdfZoom}
      minimum={MIN_PDF_ZOOM}
      maximum={MAX_PDF_ZOOM}
      onchange={(action) => oncommand({ target: 'document', action })}
    />
    <button
      class="icon-button small"
      aria-label="Fit LaTeX preview to width"
      title="Fit to width"
      onclick={() => onpreferences({ ...preferences, fitWidth: true })}
      ><Maximize2 size={14} /></button
    >
  </div>
  {#if error && !compileFailure}<div class="error-banner latex-compile-error" role="alert">
      <span>{displayPathMessage(error)}</span>
      {#if compileBusy}
        <button
          class="btn btn-ghost btn-xs"
          onclick={() => void stopOtherAndRetry()}
          disabled={stopping}>{stopping ? 'Stopping…' : 'Stop other and retry'}</button
        >
      {/if}
    </div>{/if}
  <div class="latex-preview-body">
    {#if bytes}
      <Preview
        bind:this={preview}
        tab={{ ...initialTab, path, bytes, revision }}
        scrollPosition={scroll}
        {source}
        {preferences}
        trusted={false}
        query=""
        anchor={null}
        onlink={() => {}}
        onheadings={() => {}}
        onscroll={(_path, y) => (scroll = y)}
        {oncommand}
        retainDuringUpdate
        showRenderInfo={false}
        onrendered={() => {
          updating = false;
          renderFailed = false;
          if (pendingSyncId) {
            releaseSync(activeSyncId);
            activeSyncId = pendingSyncId;
            pendingSyncId = '';
          }
        }}
        onpdfsourcejump={jumpFromPdf}
        onrendererror={(_path, reason) => {
          updating = false;
          renderFailed = true;
          releaseSync(pendingSyncId);
          pendingSyncId = '';
          failedKey = currentKey;
          error = reason;
        }}
        onpdfscale={(value) => {
          const pdfZoom = clampZoom(value, MIN_PDF_ZOOM, MAX_PDF_ZOOM);
          if (pdfZoom !== preferences.pdfZoom) onpreferences({ ...preferences, pdfZoom });
        }}
      />
      {#if (stale || compiling || updating) && !compileFailure}<div
          class="latex-preview-stale"
          class:compiling={compiling || updating}
          role="status"
        >
          {compiling
            ? `Compiling · ${compileSeconds}s · Stale`
            : updating
              ? 'Rendering · Stale'
              : 'Stale'}
        </div>{/if}
    {:else if compiling}
      <div class="preview-status" role="status">
        <span class="loading loading-spinner loading-sm"></span> Compiling with
        {preferences.latexEngine} · {compileSeconds}s…
      </div>
    {:else if compileFailure}
      <div class="preview-paused" role="status">
        <strong>Preview paused</strong>
        <span>Fix the compile error in the editor to rebuild this preview.</span>
      </div>
    {:else}
      <div class="preview-status" role="status">Compile the document to show its preview.</div>
    {/if}
  </div>
</div>

<style>
  .latex-live-preview,
  .latex-preview-body {
    display: flex;
    flex: 1;
    min-width: 0;
    min-height: 0;
    flex-direction: column;
  }
  .latex-live-preview {
    border-left: 1px solid var(--line);
  }
  .latex-preview-body {
    position: relative;
  }
  .latex-compile-error {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .preview-paused {
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
  .preview-paused strong {
    color: var(--color-base-content);
    font-size: 13px;
  }
  .latex-live-toggle {
    display: flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
  }
  .latex-preview-stale {
    position: absolute;
    right: 12px;
    top: 12px;
    z-index: 3;
    padding: 4px 8px;
    border: 1px solid color-mix(in srgb, var(--color-warning) 40%, transparent);
    border-radius: 5px;
    background: color-mix(
      in srgb,
      color-mix(in srgb, var(--color-base-100) 82%, var(--color-warning)) 94%,
      transparent
    );
    color: var(--color-base-content);
    font-size: 11px;
    pointer-events: none;
  }
  .latex-preview-stale.compiling {
    border-color: color-mix(in srgb, var(--color-info) 40%, transparent);
    background: color-mix(
      in srgb,
      color-mix(in srgb, var(--color-base-100) 82%, var(--color-info)) 94%,
      transparent
    );
  }
</style>

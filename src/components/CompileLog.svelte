<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { X } from '@lucide/svelte';
  import LogOutput from './LogOutput.svelte';
  import { openDialog } from '../lib/dialog';
  import { invokeHost } from '../lib/native';
  import { errorLinesMissingFromLog, preview, type CompileLogSnapshot } from '../lib/compile-log';

  const ACTIVE_POLL_INTERVAL_MS = 300;
  const IDLE_POLL_INTERVAL_MS = 1000;
  const COPY_FEEDBACK_MS = 1600;

  let {
    width,
    height,
    oncopy,
    onclose,
  }: {
    width: number;
    height: number;
    oncopy: (text: string) => Promise<boolean>;
    onclose: () => void;
  } = $props();
  let status = $state<CompileLogSnapshot | null>(null);
  let active = $state(false);
  let error = $state('');
  type CopyState = 'idle' | 'copied' | 'failed';
  let copyState = $state<CopyState>('idle');
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;

  function describeState(value: CompileLogSnapshot | null, live: boolean): string {
    if (!value) return 'Idle';
    if (live) return 'Live';
    if (value.cancelled) return 'Cancelled';
    return value.success ? 'Finished' : 'Failed';
  }

  function copyLabel(state: CopyState): string {
    if (state === 'copied') return 'Copied';
    if (state === 'failed') return 'Copy failed';
    return 'Copy log';
  }

  const stateLabel = $derived(describeState(status, active));

  async function copyLog() {
    const current = status;
    if (!current) return;
    const lines = [...current.log, ...errorLinesMissingFromLog(current.log, current.error)];
    if (!lines.length) return;
    const copied = await oncopy(lines.join('\n'));
    copyState = copied ? 'copied' : 'failed';
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copyState = 'idle'), COPY_FEEDBACK_MS);
  }

  async function refresh() {
    try {
      const next = await invokeHost<CompileLogSnapshot | null>('compile_log');
      if (next) {
        status = next;
        active = next.active;
        error = '';
      } else {
        status = null;
        active = false;
        error = '';
      }
    } catch (reason) {
      active = false;
      error = String(reason);
    }
  }

  onMount(() => {
    let disposed = false;
    const poll = async () => {
      await refresh();
      if (disposed) return;
      pollTimer = setTimeout(poll, active ? ACTIVE_POLL_INTERVAL_MS : IDLE_POLL_INTERVAL_MS);
    };
    void poll();
    return () => {
      disposed = true;
      clearTimeout(pollTimer);
    };
  });

  onDestroy(() => clearTimeout(copyTimer));
</script>

<dialog
  use:openDialog
  class="modal modal-open log-window"
  aria-label="Compilation log"
  oncancel={onclose}
  onclick={(event) => {
    if (event.target === event.currentTarget) onclose();
  }}
>
  <div class="modal-box log-panel" style={`--log-width: ${width}; --log-height: ${height}`}>
    <header class="window-bar">
      <span class="window-dot" class:live={active}></span>
      <strong>Compilation log</strong>
      {#if !error}<span class="window-state" class:cancelled={status?.cancelled}>{stateLabel}</span
        >{/if}
      {#if status}<span class="window-time">{status.elapsedSeconds.toFixed(1)}s</span>{/if}
      {#if error}<span class="window-error" title={error}>Log unavailable</span>{/if}
      {#if status}<button
          type="button"
          class="copy-log"
          class:copied={copyState === 'copied'}
          class:failed={copyState === 'failed'}
          title="Copy compilation log"
          disabled={!status.log.length && !status.error}
          onclick={() => void copyLog()}>{copyLabel(copyState)}</button
        >{/if}
      <button type="button" aria-label="Close compilation log" title="Close" onclick={onclose}
        ><X size={13} /></button
      >
    </header>
    <div class="log-body">
      {#if status}
        <LogOutput state={preview(status)} {active} />
      {:else}
        <div class="log-empty">
          <strong>No compilation log yet</strong>
          <span>Compile a LaTeX or Typst document to see its output here.</span>
          {#if error}<span class="log-error">{error}</span>{/if}
        </div>
      {/if}
    </div>
  </div>
</dialog>

<style>
  .log-window::backdrop {
    background: color-mix(in srgb, var(--color-base-300) 65%, transparent);
    -webkit-backdrop-filter: blur(3px);
    backdrop-filter: blur(3px);
  }
  .log-window {
    display: grid;
    place-items: center;
  }
  .log-panel {
    display: flex;
    flex-direction: column;
    width: min(
      calc(var(--palette-max-width, 960px) / var(--ui-scale, 1)),
      calc(var(--dialog-viewport-width, 100vw) * var(--log-width, 70) / 100 / var(--ui-scale, 1))
    );
    height: min(
      calc(var(--palette-max-height, 760px) / var(--ui-scale, 1)),
      calc(var(--dialog-viewport-height, 100dvh) * var(--log-height, 60) / 100 / var(--ui-scale, 1))
    );
    max-width: 100%;
    max-height: none;
    padding: 0;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--color-base-content) 26%, transparent);
    border-radius: 10px;
    background: var(--color-base-200);
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--color-base-content) 8%, transparent),
      0 2px 4px rgb(0 0 0 / 20%),
      0 28px 80px rgb(0 0 0 / 46%);
    line-height: 1.5;
  }
  .window-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 32px;
    padding: 0 8px 0 12px;
    border-bottom: 1px solid var(--line);
    background: var(--color-base-300);
    color: var(--color-base-content);
    font-family: var(--ui-font, Inter, ui-sans-serif, system-ui, sans-serif);
    font-size: 10px;
  }
  .window-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--muted);
  }
  .window-dot.live {
    background: var(--color-success);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-success) 14%, transparent);
  }
  .window-bar strong {
    font-weight: 600;
  }
  .window-state {
    color: var(--muted);
    font-family: ui-monospace, 'SFMono-Regular', monospace;
    font-size: 8px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .window-state.cancelled {
    color: var(--color-warning);
  }
  .window-error {
    max-width: 140px;
    margin-left: auto;
    overflow: hidden;
    color: var(--color-error);
    font-size: 8px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .window-time {
    color: var(--color-base-content);
    font-family: ui-monospace, 'SFMono-Regular', monospace;
    font-size: 9px;
    font-variant-numeric: tabular-nums;
  }
  .window-bar > button {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: 5px;
    color: var(--muted);
    background: transparent;
  }
  .window-bar > button:hover {
    color: var(--color-error);
    background: color-mix(in srgb, var(--color-error) 9%, transparent);
  }
  .window-bar > button:last-child {
    margin-left: 0;
  }
  .window-bar .copy-log {
    display: flex;
    width: auto;
    height: 22px;
    margin-left: auto;
    padding: 0 7px;
    color: var(--muted);
    font: inherit;
    font-size: 9px;
    letter-spacing: 0.02em;
  }
  .window-bar .copy-log:hover {
    color: var(--color-primary);
    background: color-mix(in srgb, var(--color-primary) 9%, transparent);
  }
  .window-bar .copy-log:disabled {
    opacity: 0.4;
  }
  .window-bar .copy-log:disabled:hover {
    color: var(--muted);
    background: transparent;
  }
  .window-bar .copy-log.copied {
    color: var(--color-success);
  }
  .window-bar .copy-log.failed {
    color: var(--color-error);
  }
  .log-body {
    display: flex;
    flex: 1;
    min-height: 0;
  }
  .log-body :global(.compile-log) {
    flex: 1;
    min-height: 0;
    border: 0;
    border-radius: 0;
  }
  .log-empty {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 28px;
    color: var(--muted);
    background: var(--color-base-100);
    text-align: center;
  }
  .log-empty strong {
    color: var(--color-base-content);
    font-size: 13px;
    font-weight: 600;
  }
  .log-empty span {
    max-width: 420px;
    font-size: 10px;
    line-height: 1.5;
  }
  .log-error {
    color: var(--color-error);
  }
</style>

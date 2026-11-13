<script lang="ts">
  import type { CompilePreview } from '../lib/compile-log';
  import { autoscroll } from '../lib/autoscroll';

  let { state, active = true }: { state: CompilePreview; active?: boolean } = $props();
  const isTypst = $derived(state.engine === 'typst');
  const progress = $derived(state.totalPages > 0 ? Math.min(1, state.page / state.totalPages) : 0);

  function describePages(value: CompilePreview, typst: boolean): string {
    if (value.phase === 'Failed') return 'Incomplete';
    if (value.phase === 'Cancelled') return 'Cancelled';
    if (value.totalPages > 0) return `${value.page} / ${value.totalPages} pages`;
    if (typst) return 'Typst · single pass';
    if (value.phase === 'Complete') return value.page > 0 ? `page ${value.page}` : 'Complete';
    if (value.page > 0) return `page ${value.page}`;
    return 'Preparing pages';
  }

  const pageLabel = $derived(describePages(state, isTypst));
</script>

<div class="compile-log" role="region" aria-label="Compiler output">
  {#if state.totalPages > 0}
    <div
      class="progress"
      role="progressbar"
      aria-label="Compilation pages"
      aria-valuemin="0"
      aria-valuemax={state.totalPages}
      aria-valuenow={Math.min(state.page, state.totalPages)}
    >
      <span style:width={`${progress * 100}%`}></span>
    </div>
  {:else if active}
    <div class="progress indeterminate" role="progressbar" aria-label="Compiling">
      <span></span>
    </div>
  {/if}

  <div class="command" title="Compiler command summary">
    <span class="separator">$</span>
    <span class="invocation"
      >{#if isTypst}typst compile {state.path}{:else}{state.engine} -interaction=nonstopmode {state.path}{/if}</span
    >
    <span class="phase-label">{state.phase}</span>
  </div>

  <section class="log" use:autoscroll>
    {#if state.log.length}
      {#each state.log as line, index (index)}
        <p class={line.tone}>
          <span class="gutter">{String(index + 1).padStart(2, '0')}</span><span>{line.text}</span>
        </p>
      {/each}
    {:else}
      <p class="empty">{active ? 'Waiting for compiler output…' : 'No compiler output.'}</p>
    {/if}
  </section>

  <footer>
    <span class="pages">{pageLabel}</span>
    <span class="detail">{state.detail}</span>
  </footer>
</div>

<style>
  .compile-log {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 9px;
    background: var(--color-base-200);
    color: var(--color-base-content);
    font-family: var(--ui-font, Inter, ui-sans-serif, system-ui, sans-serif);
  }
  .progress {
    height: 3px;
    background: color-mix(in srgb, var(--color-base-content) 8%, transparent);
  }
  .progress span {
    display: block;
    height: 100%;
    background: var(--color-primary);
    transition: width 180ms ease;
  }
  .progress.indeterminate {
    overflow: hidden;
  }
  .progress.indeterminate span {
    width: 34%;
    border-radius: inherit;
    animation: log-indeterminate 1.2s ease-in-out infinite;
  }
  @keyframes log-indeterminate {
    from {
      transform: translateX(-110%);
    }
    to {
      transform: translateX(310%);
    }
  }
  .command {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 9px 16px;
    border-bottom: 1px solid var(--line);
    color: var(--muted);
    font-family: ui-monospace, 'SFMono-Regular', monospace;
    font-size: 9px;
    white-space: nowrap;
  }
  .invocation {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .separator {
    opacity: 0.5;
  }
  .phase-label {
    margin-left: auto;
    color: var(--color-primary);
    font-size: 8px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .log {
    flex: 1;
    min-height: 0;
    padding: 8px 0;
    overflow: auto;
    background: var(--color-base-100);
    font-family: ui-monospace, 'SFMono-Regular', monospace;
    font-size: 10px;
    line-height: 1.7;
    scrollbar-width: thin;
  }
  .log p {
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr);
    gap: 8px;
    margin: 0;
    padding: 0 16px;
    color: color-mix(in srgb, var(--color-base-content) 78%, transparent);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .log p:hover {
    background: color-mix(in srgb, var(--color-base-content) 4%, transparent);
  }
  .gutter {
    color: color-mix(in srgb, var(--color-base-content) 26%, transparent);
    text-align: right;
    user-select: none;
  }
  .log p.muted {
    color: color-mix(in srgb, var(--color-base-content) 42%, transparent);
  }
  .log p.page {
    color: var(--color-info);
  }
  .log p.warning {
    color: var(--color-warning);
  }
  .log p.error {
    color: var(--color-error);
  }
  .log p.success {
    color: var(--color-success);
  }
  .log p.empty {
    display: block;
    padding: 0 16px;
    color: var(--muted);
    font-style: italic;
  }
  footer {
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: 34px;
    padding: 6px 16px;
    border-top: 1px solid var(--line);
    background: var(--color-base-300);
    color: color-mix(in srgb, var(--color-base-content) 40%, transparent);
    font-family: ui-monospace, 'SFMono-Regular', monospace;
    font-size: 8px;
  }
  .pages {
    flex: none;
    color: var(--color-base-content);
  }
  .detail {
    overflow: hidden;
    margin-left: auto;
    color: var(--color-primary);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>

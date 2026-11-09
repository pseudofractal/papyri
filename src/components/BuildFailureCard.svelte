<script lang="ts">
  import { explainBuildMessage, type BuildFailure } from '../lib/build-diagnostics';

  let {
    failure,
    onjump,
  }: {
    failure: BuildFailure;
    onjump?: (line: number, column: number) => void;
  } = $props();

  const primary = $derived(
    failure.diagnostics.find((diagnostic) => diagnostic.severity === 'error') ??
      failure.diagnostics[0] ??
      null,
  );
  const warning = $derived(primary?.severity === 'warning');
  const logLines = $derived(failure.log ? failure.log.split('\n').length : 0);
  const position = $derived(
    primary?.line
      ? `${primary.file}:${primary.line}${primary.column ? `:${primary.column}` : ''}`
      : '',
  );
</script>

<section class="build-failure" class:warning aria-label="Compile error">
  <span class="build-failure-mark" aria-hidden="true">
    {#if warning}
      <svg viewBox="0 0 24 24"><path d="M12 7v6M12 16.5v.1" /></svg>
    {:else}
      <svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7 7 17" /></svg>
    {/if}
  </span>
  <div class="build-failure-body">
    <div class="build-failure-head">
      <strong>{primary?.message ?? failure.summary}</strong>
      {#if position}<span class="build-failure-location">{position}</span>{/if}
      {#if primary?.line}
        <button
          type="button"
          class="build-failure-open"
          aria-label="Open line {primary.line}"
          title="Open line {primary.line}"
          onclick={() => onjump?.(primary.line, primary.column ?? 1)}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4.5 11.5 11.5 4.5M5.5 4.5h6v6" />
          </svg>
        </button>
      {/if}
    </div>
    <p class="build-failure-explanation">
      {explainBuildMessage(primary?.message ?? failure.summary)}
    </p>
    {#if failure.log}
      <details class="build-failure-log">
        <summary>Build log <span>{logLines} lines</span></summary>
        <pre>{failure.log}</pre>
      </details>
    {/if}
  </div>
</section>

<style>
  .build-failure {
    display: grid;
    grid-template-columns: 20px minmax(0, 1fr);
    gap: 8px;
    padding: 8px 10px;
    border: 1px solid color-mix(in srgb, var(--color-error) 30%, transparent);
    border-left: 3px solid var(--color-error);
    border-radius: 8px;
    background: color-mix(in srgb, var(--color-error) 9%, var(--color-base-200));
    box-shadow: 0 4px 16px rgb(0 0 0 / 12%);
    line-height: 1.4;
    white-space: normal;
  }
  .build-failure.warning {
    border-color: color-mix(in srgb, var(--color-warning) 30%, transparent);
    border-left-color: var(--color-warning);
    background: color-mix(in srgb, var(--color-warning) 8%, var(--color-base-200));
  }
  .build-failure-mark {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--color-error);
    color: var(--color-base-100);
    line-height: 0;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-error) 14%, transparent);
  }
  .build-failure-mark svg {
    display: block;
    width: 11px;
    height: 11px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.4;
    stroke-linecap: round;
  }
  .warning .build-failure-mark {
    background: var(--color-warning);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-warning) 18%, transparent);
  }
  .build-failure-body {
    min-width: 0;
    line-height: 1.4;
  }
  .build-failure-head {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 2px 7px;
  }
  .build-failure-head strong {
    font-size: 13px;
    font-weight: 750;
    color: var(--color-base-content);
  }
  .build-failure-location {
    padding: 1px 7px;
    border: 1px solid color-mix(in srgb, var(--color-error) 30%, transparent);
    border-radius: 99px;
    background: color-mix(in srgb, var(--color-error) 9%, transparent);
    color: var(--color-error);
    font-family: ui-monospace, monospace;
    font-size: 10px;
    white-space: nowrap;
  }
  .warning .build-failure-location {
    border-color: color-mix(in srgb, var(--color-warning) 35%, transparent);
    color: var(--color-warning);
  }
  .build-failure-open {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    margin-left: auto;
    padding: 0;
    border: 1px solid color-mix(in srgb, var(--color-error) 30%, transparent);
    border-radius: 50%;
    background: color-mix(in srgb, var(--color-error) 9%, transparent);
    color: var(--color-error);
    line-height: 0;
    cursor: pointer;
  }
  .build-failure-open:hover {
    background: color-mix(in srgb, var(--color-error) 20%, transparent);
  }
  .warning .build-failure-open {
    border-color: color-mix(in srgb, var(--color-warning) 35%, transparent);
    color: var(--color-warning);
  }
  .build-failure-open svg {
    display: block;
    width: 11px;
    height: 11px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .build-failure-explanation {
    margin: 2px 0 0;
    color: var(--muted);
    font-size: 11px;
    line-height: 1.4;
  }
  .build-failure-log {
    margin-top: 5px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: color-mix(in srgb, var(--color-base-100) 55%, transparent);
  }
  .build-failure-log summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 4px 7px;
    color: var(--muted);
    font-size: 10px;
    line-height: 1.3;
    cursor: pointer;
    list-style: none;
  }
  .build-failure-log summary::-webkit-details-marker {
    display: none;
  }
  .build-failure-log summary::before {
    content: '▸';
    margin-right: 5px;
  }
  .build-failure-log[open] summary::before {
    content: '▾';
  }
  .build-failure-log summary span {
    margin-left: auto;
    font-size: 10px;
  }
  .build-failure-log pre {
    max-height: 220px;
    margin: 0;
    padding: 7px 9px 9px;
    overflow: auto;
    border-top: 1px solid var(--line);
    color: var(--muted);
    font-family: ui-monospace, monospace;
    font-size: 10.5px;
    line-height: 1.55;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>

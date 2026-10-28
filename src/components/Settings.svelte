<script lang="ts">
  import { untrack } from 'svelte';
  import { openDialog } from '../lib/dialog';
  import { X, ShieldCheck, Braces } from '@lucide/svelte';
  import ZoomControls from './ZoomControls.svelte';
  import { changeZoom } from '../lib/view';
  import type { Delimiter, Preferences } from '../lib/types';
  import { validateDelimiters } from '../lib/preferences';
  let {
    preferences,
    onclose,
    onchange,
  }: {
    preferences: Preferences;
    onclose: () => void;
    onchange: (preferences: Preferences) => void;
  } = $props();
  let delimiters = $state<Delimiter[]>(untrack(() => $state.snapshot(preferences.delimiters)));
  let error = $state('');
  function save() {
    try {
      const pairs = validateDelimiters(delimiters);
      onchange({ ...preferences, delimiters: pairs });
      error = '';
      onclose();
    } catch (reason) {
      error = String(reason);
    }
  }
</script>

<dialog use:openDialog class="modal modal-open" aria-labelledby="settings-title" oncancel={onclose}>
  <div class="modal-box settings-panel">
    <header>
      <div>
        <h2 id="settings-title">Reading preferences</h2>
      </div>
      <button class="btn btn-ghost btn-square btn-sm" aria-label="Close settings" onclick={onclose}
        ><X size={20} /></button
      >
    </header>
    <h3><ShieldCheck size={18} /> External content</h3>
    <label class="setting-row"
      ><span
        >Allow network resources<small
          >Images, chart data and trusted scripts may contact document-specified servers.</small
        ></span
      ><input
        class="toggle toggle-sm"
        type="checkbox"
        checked={preferences.network}
        onchange={(event) => onchange({ ...preferences, network: event.currentTarget.checked })}
      /></label
    >
    <p class="hint">
      Scripts are disabled unless you trust the current document. A trusted script can navigate its
      own frame and contact the network despite resource restrictions; enable it only for documents
      you know.
    </p>
    <h3>Magnification</h3>
    <div class="setting-row">
      <span>Document</span><ZoomControls
        label="document"
        value={preferences.documentZoom}
        onchange={(action) =>
          onchange({ ...preferences, documentZoom: changeZoom(preferences.documentZoom, action) })}
      />
    </div>
    <div class="setting-row">
      <span>Interface</span><ZoomControls
        label="UI"
        value={preferences.uiZoom}
        onchange={(action) =>
          onchange({ ...preferences, uiZoom: changeZoom(preferences.uiZoom, action) })}
      />
    </div>
    <p class="hint">Document: Ctrl + / − / 0. Interface: Ctrl Alt + / − / 0.</p>
    <h3><Braces size={18} /> Mathematics</h3>
    <p class="hint">
      Add as many inline or display pairs as you need. Display pairs work together, including
      equations with blank lines. Bare [ … ] works as a standalone block containing TeX commands, so
      citations stay intact.
    </p>
    <div class="delimiter-list">
      {#each delimiters as pair, index (index)}
        <div class="delimiter-row">
          <input
            class="input input-sm"
            aria-label="Opening delimiter {index + 1}"
            bind:value={pair.left}
            spellcheck="false"
            placeholder="Opening"
          />
          <input
            class="input input-sm"
            aria-label="Closing delimiter {index + 1}"
            bind:value={pair.right}
            spellcheck="false"
            placeholder="Closing"
          />
          <select
            class="select select-sm"
            aria-label="Math mode {index + 1}"
            value={pair.display ? 'display' : 'inline'}
            onchange={(event) => (pair.display = event.currentTarget.value === 'display')}
            ><option value="display">Display</option><option value="inline">Inline</option></select
          >
          <button
            class="icon-button small"
            aria-label="Remove delimiter {index + 1}"
            onclick={() => (delimiters = delimiters.filter((_, row) => row !== index))}
            ><X size={16} /></button
          >
        </div>
      {/each}
    </div>
    <div class="preset-row">
      <button
        class="btn btn-sm btn-ghost"
        onclick={() => (delimiters = [...delimiters, { left: '', right: '', display: true }])}
        disabled={delimiters.length >= 20}>Add delimiter pair</button
      ><button class="btn btn-sm btn-ghost" onclick={() => (delimiters = [])}>Disable math</button>
    </div>
    <p class="hint">
      Longest opening wins. Duplicate openings are rejected. Single dollars may conflict with
      currency. Invalid TeX stays visible in red.
    </p>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <footer>
      <span class="hint">Saved on this device</span><button
        class="btn btn-primary btn-sm"
        onclick={save}>Apply preferences</button
      >
    </footer>
  </div>
  <button class="modal-backdrop" aria-label="Dismiss settings" onclick={onclose}></button>
</dialog>

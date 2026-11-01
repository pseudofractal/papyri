<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { openDialog } from '../lib/dialog';
  import { X, ShieldCheck, Braces } from '@lucide/svelte';
  import ZoomControls from './ZoomControls.svelte';
  import { changeZoom, MIN_PDF_ZOOM, MAX_PDF_ZOOM } from '../lib/view';
  import type { Delimiter, LatexEngine, Preferences } from '../lib/types';
  import { validateDelimiters } from '../lib/preferences';
  import { native } from '../lib/sources';
  import { invokeHost } from '../lib/native';
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
  let engines = $state<{ name: LatexEngine; path: string | null }[]>([]);
  let discoveryError = $state('');
  let typstBinary = $state<string | null>(null);
  let typstDiscoveryError = $state('');
  onMount(() => {
    if (native)
      void invokeHost<typeof engines>('latex_engines')
        .then((found) => {
          engines = found;
        })
        .catch((reason) => {
          discoveryError = String(reason);
        });
    if (native)
      void invokeHost<string | null>('typst_binary')
        .then((found) => {
          typstBinary = found;
        })
        .catch((reason) => {
          typstDiscoveryError = String(reason);
        });
  });
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
          >Images, chart data, link previews and trusted scripts may contact document-specified
          servers.</small
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
      <span>Markdown text</span><ZoomControls
        label="document"
        value={preferences.documentZoom}
        onchange={(action) =>
          onchange({ ...preferences, documentZoom: changeZoom(preferences.documentZoom, action) })}
      />
    </div>
    <div class="setting-row">
      <span>PDF, Typst and LaTeX pages</span><ZoomControls
        label="PDF"
        value={preferences.pdfZoom}
        minimum={MIN_PDF_ZOOM}
        maximum={MAX_PDF_ZOOM}
        onchange={(action) =>
          onchange({
            ...preferences,
            pdfZoom: changeZoom(preferences.pdfZoom, action, MIN_PDF_ZOOM, MAX_PDF_ZOOM),
            fitWidth: false,
          })}
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
    <h3>Typst compiler</h3>
    <label class="setting-row"
      ><span
        >Typst executable<small
          >{native ? typstBinary || 'Not found on PATH' : 'Available in the Linux app'}</small
        ></span
      >
      <input
        class="input input-sm"
        aria-label="Typst executable path"
        placeholder="Use PATH"
        value={preferences.typstPath}
        onchange={(event) =>
          onchange({ ...preferences, typstPath: event.currentTarget.value.trim() })}
      />
    </label>
    <p class="hint">Leave the path empty to use Typst from PATH or the bundled compiler.</p>
    {#if typstDiscoveryError}<p class="error">
        Could not discover Typst: {typstDiscoveryError}
      </p>{/if}
    <h3>LaTeX compiler</h3>
    <label class="setting-row"
      ><span>Engine</span>
      <select
        class="select select-sm"
        value={preferences.latexEngine}
        onchange={(event) =>
          onchange({ ...preferences, latexEngine: event.currentTarget.value as LatexEngine })}
      >
        <option value="lualatex">LuaLaTeX</option><option value="pdflatex">pdfLaTeX</option><option
          value="xelatex">XeLaTeX</option
        >
      </select>
    </label>
    {#each ['lualatex', 'pdflatex', 'xelatex'] as engine (engine)}
      {@const name = engine as LatexEngine}
      <label class="setting-row"
        ><span
          >{engine} executable<small
            >{native
              ? engines.find((item) => item.name === name)?.path || 'Not found on PATH'
              : 'Available in the Linux app'}</small
          ></span
        >
        <input
          class="input input-sm"
          aria-label="{engine} executable path"
          placeholder="Use PATH"
          value={preferences.latexPaths[name]}
          onchange={(event) =>
            onchange({
              ...preferences,
              latexPaths: { ...preferences.latexPaths, [name]: event.currentTarget.value.trim() },
            })}
        />
      </label>
    {/each}
    <p class="hint">
      Leave paths empty to use commands found on PATH. LaTeX compilation requires the Linux app.
    </p>
    {#if discoveryError}<p class="error">Could not discover LaTeX engines: {discoveryError}</p>{/if}
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

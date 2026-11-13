<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { openDialog } from '../lib/dialog';
  import { displayPath, displayPathMessage, expandHomePath } from '../lib/paths';
  import { X, ShieldCheck, Braces } from '@lucide/svelte';
  import ZoomControls from './ZoomControls.svelte';
  import {
    changeZoom,
    clampPaletteMaxHeight,
    clampPaletteMaxWidth,
    clampPalettePercent,
    MAX_PALETTE_MAX_HEIGHT,
    MAX_PALETTE_MAX_WIDTH,
    MAX_PALETTE_PERCENT,
    MAX_PDF_ZOOM,
    MIN_PALETTE_MAX_HEIGHT,
    MIN_PALETTE_MAX_WIDTH,
    MIN_PALETTE_PERCENT,
    MIN_PDF_ZOOM,
  } from '../lib/view';
  import type { Delimiter, LatexEngine, Preferences } from '../lib/types';
  import { validateDelimiters, validateFontFamily } from '../lib/preferences';
  import {
    CODE_FONT_PRESETS,
    MATH_FONT_PRESETS,
    TEXT_FONT_PRESETS,
    UI_FONT_PRESETS,
  } from '../lib/fonts';
  import { desktop } from '../lib/sources';
  import { platform } from '../lib/platform';
  import { invokeHost } from '../lib/native';
  type SettingsTab = 'appearance' | 'reading' | 'documents' | 'compilers';
  type FontPreference = 'uiFont' | 'textFont' | 'codeFont' | 'mathFont';
  const tabs: { id: SettingsTab; label: string }[] = [
    { id: 'appearance', label: 'Appearance' },
    { id: 'reading', label: 'Reading' },
    { id: 'documents', label: 'Documents' },
    { id: 'compilers', label: 'Compilers' },
  ];
  let {
    preferences,
    onclose,
    onchange,
    toolBusy,
    toolMessage,
    toolError,
    ondownloadtools,
    onmanagetexlive,
    ontoolerror,
  }: {
    preferences: Preferences;
    onclose: () => void;
    onchange: (preferences: Preferences) => void;
    toolBusy: boolean;
    toolMessage: string;
    toolError: string;
    ondownloadtools: (names: ManagedTool[]) => Promise<void>;
    onmanagetexlive: (action: 'install' | 'update') => Promise<void>;
    ontoolerror: (message: string) => void;
  } = $props();
  let delimiters = $state<Delimiter[]>(untrack(() => $state.snapshot(preferences.delimiters)));
  let error = $state('');
  let fontError = $state('');
  let activeTab = $state<SettingsTab>('appearance');
  let settingsContent: HTMLDivElement | undefined;
  let engines = $state<{ name: LatexEngine; path: string | null }[]>([]);
  let discoveryError = $state('');
  let typstBinary = $state<string | null>(null);
  let typstDiscoveryError = $state('');
  type Language = keyof Preferences['languageServerPaths'];
  type ManagedTool = 'marksman' | 'tinymist' | 'texlab' | 'typst';
  const languageServers: { language: Language; name: ManagedTool; label: string }[] = [
    { language: 'markdown', name: 'marksman', label: 'Markdown · Marksman' },
    { language: 'typst', name: 'tinymist', label: 'Typst · Tinymist' },
    { language: 'latex', name: 'texlab', label: 'LaTeX · Texlab' },
  ];
  onMount(() => {
    if (desktop)
      void invokeHost<typeof engines>('latex_engines')
        .then((found) => {
          engines = found;
        })
        .catch((reason) => {
          discoveryError = String(reason);
        });
    if (desktop)
      void invokeHost<string | null>('typst_binary')
        .then((found) => {
          typstBinary = found;
        })
        .catch((reason) => {
          typstDiscoveryError = String(reason);
        });
  });
  function setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    onchange({ ...preferences, [key]: value });
  }
  /** Select a settings section from a control client. */
  export function showTab(tab: SettingsTab) {
    activeTab = tab;
  }
  function setServerPath(language: Language, path: string) {
    setPreference('languageServerPaths', { ...preferences.languageServerPaths, [language]: path });
  }
  async function chooseExecutable(setPath: (path: string) => void) {
    ontoolerror('');
    try {
      const path = await invokeHost<string | null>('pick_executable');
      if (path) setPath(path);
    } catch (reason) {
      ontoolerror(String(reason));
    }
  }
  function updateFont(key: FontPreference, value: string) {
    try {
      const font = validateFontFamily(value, key, key === 'mathFont');
      fontError = '';
      setPreference(key, font);
    } catch (reason) {
      fontError = String(reason);
    }
  }
  function updatePercent(
    key: 'paletteWidth' | 'paletteHeight' | 'logWidth' | 'logHeight',
    value: string,
  ) {
    const number = Number(value);
    if (Number.isFinite(number)) setPreference(key, clampPalettePercent(number));
  }
  function updatePaletteMaximum(key: 'paletteMaxWidth' | 'paletteMaxHeight', value: string) {
    const number = Number(value);
    if (!Number.isFinite(number)) return;
    setPreference(
      key,
      key === 'paletteMaxWidth' ? clampPaletteMaxWidth(number) : clampPaletteMaxHeight(number),
    );
  }
  function activateTab(id: SettingsTab) {
    activeTab = id;
    settingsContent?.scrollTo({ top: 0 });
  }
  function tabKeydown(event: KeyboardEvent, index: number) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'End') next = tabs.length - 1;
    else next = 0;
    activateTab(tabs[next].id);
    requestAnimationFrame(() => document.getElementById(`settings-tab-${tabs[next].id}`)?.focus());
  }
  function save() {
    try {
      const pairs = validateDelimiters(delimiters);
      onchange({ ...preferences, delimiters: pairs });
      error = '';
      onclose();
    } catch (reason) {
      error = String(reason);
      activateTab('documents');
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
    <div class="settings-tabs" role="tablist" aria-label="Settings sections">
      {#each tabs as tab, index (tab.id)}
        <button
          type="button"
          id="settings-tab-{tab.id}"
          class="settings-tab"
          role="tab"
          aria-selected={activeTab === tab.id}
          aria-controls="settings-panel-{tab.id}"
          tabindex={activeTab === tab.id ? 0 : -1}
          onclick={() => activateTab(tab.id)}
          onkeydown={(event) => tabKeydown(event, index)}>{tab.label}</button
        >
      {/each}
    </div>
    {#if fontError}<p class="error settings-error" role="alert">{fontError}</p>{/if}
    <div class="settings-content" bind:this={settingsContent}>
      <div
        id="settings-panel-appearance"
        role="tabpanel"
        aria-labelledby="settings-tab-appearance"
        hidden={activeTab !== 'appearance'}
      >
        <h3>Interface</h3>
        <label class="setting-row"
          ><span
            >Interface font<small
              >Used by the explorer, toolbars, settings, and other application controls.</small
            ></span
          >
          <input
            class="input input-sm font-input"
            list="ui-font-presets"
            aria-label="Interface font"
            value={preferences.uiFont}
            onchange={(event) => updateFont('uiFont', event.currentTarget.value)}
            spellcheck="false"
          />
        </label>
        <div class="font-preview" style="font-family: {preferences.uiFont}">
          Papyri · The quick brown fox jumps over the lazy dog.
        </div>
        <div class="setting-row">
          <span>Interface magnification</span><ZoomControls
            label="UI"
            value={preferences.uiZoom}
            onchange={(action) => setPreference('uiZoom', changeZoom(preferences.uiZoom, action))}
          />
        </div>
        <p class="hint">Interface: Ctrl Alt + / − / 0.</p>
        <h3>Command palette</h3>
        <p class="hint">
          Width and height are percentages of the available window. The pixel limits keep the
          palette from becoming too large on wide displays.
        </p>
        <label class="setting-row"
          ><span>Width<small>{preferences.paletteWidth}% of the window.</small></span>
          <input
            class="input input-sm numeric-input"
            type="number"
            min={MIN_PALETTE_PERCENT}
            max={MAX_PALETTE_PERCENT}
            step="1"
            aria-label="Command palette width percentage"
            value={preferences.paletteWidth}
            onchange={(event) => updatePercent('paletteWidth', event.currentTarget.value)}
          />
        </label>
        <label class="setting-row"
          ><span>Height<small>{preferences.paletteHeight}% of the window.</small></span>
          <input
            class="input input-sm numeric-input"
            type="number"
            min={MIN_PALETTE_PERCENT}
            max={MAX_PALETTE_PERCENT}
            step="1"
            aria-label="Command palette height percentage"
            value={preferences.paletteHeight}
            onchange={(event) => updatePercent('paletteHeight', event.currentTarget.value)}
          />
        </label>
        <label class="setting-row"
          ><span>Maximum width<small>Pixels on large displays.</small></span>
          <input
            class="input input-sm numeric-input"
            type="number"
            min={MIN_PALETTE_MAX_WIDTH}
            max={MAX_PALETTE_MAX_WIDTH}
            step="10"
            aria-label="Command palette maximum width in pixels"
            value={preferences.paletteMaxWidth}
            onchange={(event) => updatePaletteMaximum('paletteMaxWidth', event.currentTarget.value)}
          />
        </label>
        <label class="setting-row"
          ><span>Maximum height<small>Pixels on large displays.</small></span>
          <input
            class="input input-sm numeric-input"
            type="number"
            min={MIN_PALETTE_MAX_HEIGHT}
            max={MAX_PALETTE_MAX_HEIGHT}
            step="10"
            aria-label="Command palette maximum height in pixels"
            value={preferences.paletteMaxHeight}
            onchange={(event) =>
              updatePaletteMaximum('paletteMaxHeight', event.currentTarget.value)}
          />
        </label>
      </div>

      <div
        id="settings-panel-reading"
        role="tabpanel"
        aria-labelledby="settings-tab-reading"
        hidden={activeTab !== 'reading'}
      >
        <h3>Markdown display</h3>
        <div class="setting-row">
          <span>Markdown text</span><ZoomControls
            label="document"
            value={preferences.documentZoom}
            onchange={(action) =>
              setPreference('documentZoom', changeZoom(preferences.documentZoom, action))}
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
        <p class="hint">Document: Ctrl + / − / 0, including paged previews.</p>
        <h3>Markdown fonts</h3>
        <label class="setting-row"
          ><span>Text font<small>Body text, headings, lists, and other prose.</small></span>
          <input
            class="input input-sm font-input"
            list="text-font-presets"
            aria-label="Markdown text font"
            value={preferences.textFont}
            onchange={(event) => updateFont('textFont', event.currentTarget.value)}
            spellcheck="false"
          />
        </label>
        <div class="font-preview" style="font-family: {preferences.textFont}">
          The quick brown fox jumps over the lazy dog. 0123456789
        </div>
        <label class="setting-row"
          ><span>Code font<small>Fenced code, inline code, and highlighted source.</small></span>
          <input
            class="input input-sm font-input"
            list="code-font-presets"
            aria-label="Markdown code font"
            value={preferences.codeFont}
            onchange={(event) => updateFont('codeFont', event.currentTarget.value)}
            spellcheck="false"
          />
        </label>
        <div class="font-preview font-preview-code" style="font-family: {preferences.codeFont}">
          const sum = (a, b) =&gt; a + b;
        </div>
        <label class="setting-row"
          ><span
            >Math font<small
              >Leave empty to use KaTeX's bundled fonts. Installed Unicode math fonts can be
              selected by name.</small
            ></span
          >
          <input
            class="input input-sm font-input"
            list="math-font-presets"
            aria-label="Math font"
            placeholder="KaTeX default"
            value={preferences.mathFont}
            onchange={(event) => updateFont('mathFont', event.currentTarget.value)}
            spellcheck="false"
          />
        </label>
        <div class="font-preview" style="font-family: {preferences.mathFont || 'serif'}">
          {preferences.mathFont
            ? 'E = mc² · ∫₀¹ x² dx · ∑ₙ aₙ'
            : 'KaTeX default · E = mc² · ∫₀¹ x² dx'}
        </div>
        <p class="hint">
          Any installed font name or comma-separated fallback list works. Fonts are never
          downloaded; missing families fall back to the next name.
        </p>
      </div>

      <div
        id="settings-panel-documents"
        role="tabpanel"
        aria-labelledby="settings-tab-documents"
        hidden={activeTab !== 'documents'}
      >
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
            onchange={(event) => setPreference('network', event.currentTarget.checked)}
          /></label
        >
        <p class="hint">
          Scripts are disabled unless you trust the current document. A trusted script can navigate
          its own frame and contact the network despite resource restrictions; enable it only for
          documents you know.
        </p>
        <h3><Braces size={18} /> Mathematics</h3>
        <p class="hint">
          Add as many inline or display pairs as you need. Display pairs work together, including
          equations with blank lines. Bare [ … ] works as a standalone block containing TeX
          commands, so citations stay intact.
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
                ><option value="display">Display</option><option value="inline">Inline</option
                ></select
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
          ><button class="btn btn-sm btn-ghost" onclick={() => (delimiters = [])}
            >Disable math</button
          >
        </div>
        <p class="hint">
          Longest opening wins. Duplicate openings are rejected. Single dollars may conflict with
          currency. Invalid TeX stays visible in red.
        </p>
        {#if error}<p class="error" role="alert">{displayPathMessage(error)}</p>{/if}
      </div>

      <div
        id="settings-panel-compilers"
        role="tabpanel"
        aria-labelledby="settings-tab-compilers"
        hidden={activeTab !== 'compilers'}
      >
        {#if desktop}
          <h3>Compile log</h3>
          <p class="hint">Configure the floating compilation log.</p>
          <label class="setting-row"
            ><span>Log width<small>{preferences.logWidth}% of the window.</small></span>
            <input
              class="input input-sm numeric-input"
              type="number"
              min={MIN_PALETTE_PERCENT}
              max={MAX_PALETTE_PERCENT}
              step="1"
              aria-label="Compilation log width percentage"
              value={preferences.logWidth}
              onchange={(event) => updatePercent('logWidth', event.currentTarget.value)}
            />
          </label>
          <label class="setting-row"
            ><span>Log height<small>{preferences.logHeight}% of the window.</small></span>
            <input
              class="input input-sm numeric-input"
              type="number"
              min={MIN_PALETTE_PERCENT}
              max={MAX_PALETTE_PERCENT}
              step="1"
              aria-label="Compilation log height percentage"
              value={preferences.logHeight}
              onchange={(event) => updatePercent('logHeight', event.currentTarget.value)}
            />
          </label>
        {/if}
        <h3>Language servers</h3>
        <p class="hint">
          Choose an executable, or download a managed copy from its official release. Downloads
          become the selected executable without changing system tools. Empty paths use PATH.
          Changes reconnect the current editor.
        </p>
        {#each languageServers as server (server.language)}
          <div class="tool-setting">
            <label for="server-{server.language}">{server.label}</label>
            <div class="tool-controls">
              <input
                id="server-{server.language}"
                class="input input-sm"
                aria-label="{server.label} executable path"
                placeholder="Use PATH"
                value={displayPath(preferences.languageServerPaths[server.language])}
                onchange={(event) =>
                  setServerPath(server.language, expandHomePath(event.currentTarget.value.trim()))}
              />
              <button
                type="button"
                class="btn btn-ghost btn-sm"
                aria-label="Browse {server.label} executable"
                disabled={!desktop || toolBusy}
                onclick={() =>
                  void chooseExecutable((path) => setServerPath(server.language, path))}
                >Browse</button
              >
              <button
                type="button"
                class="btn btn-ghost btn-sm"
                aria-label="Download or update {server.label}"
                disabled={!desktop || !platform.managedTools || toolBusy}
                onclick={() => void ondownloadtools([server.name])}>Download / update</button
              >
            </div>
          </div>
        {/each}
        <h3>Typst compiler</h3>
        <label class="setting-row"
          ><span
            >Typst executable<small
              >{desktop
                ? typstBinary || 'Not found on PATH'
                : 'Available in the desktop app'}</small
            ></span
          >
          <input
            class="input input-sm"
            aria-label="Typst executable path"
            placeholder="Use PATH"
            value={displayPath(preferences.typstPath)}
            onchange={(event) =>
              setPreference('typstPath', expandHomePath(event.currentTarget.value.trim()))}
          />
        </label>
        <div class="tool-actions">
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            disabled={!desktop || toolBusy}
            onclick={() => void chooseExecutable((path) => setPreference('typstPath', path))}
            >Browse Typst</button
          >
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            disabled={!desktop || !platform.managedTools || toolBusy}
            onclick={() => void ondownloadtools(['typst'])}>Download / update Typst</button
          >
        </div>
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
              setPreference('latexEngine', event.currentTarget.value as LatexEngine)}
          >
            <option value="lualatex">LuaLaTeX</option><option value="pdflatex">pdfLaTeX</option
            ><option value="xelatex">XeLaTeX</option>
          </select>
        </label>
        {#each ['lualatex', 'pdflatex', 'xelatex'] as engine (engine)}
          {@const name = engine as LatexEngine}
          <label class="setting-row"
            ><span
              >{engine} executable<small
                >{desktop
                  ? engines.find((item) => item.name === name)?.path || 'Not found on PATH'
                  : 'Available in the desktop app'}</small
              ></span
            >
            <input
              class="input input-sm"
              aria-label="{engine} executable path"
              placeholder="Use PATH"
              value={displayPath(preferences.latexPaths[name])}
              onchange={(event) =>
                setPreference('latexPaths', {
                  ...preferences.latexPaths,
                  [name]: expandHomePath(event.currentTarget.value.trim()),
                })}
            />
          </label>
          <div class="tool-actions">
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              disabled={!desktop || toolBusy}
              onclick={() =>
                void chooseExecutable((path) =>
                  setPreference('latexPaths', { ...preferences.latexPaths, [name]: path }),
                )}>Browse {engine}</button
            >
          </div>
        {/each}
        <p class="hint">
          Leave paths empty to use commands found on PATH, or choose an existing TeX distribution.
          The optional managed TeX Live installation is separate from system tools and can require
          several gigabytes and substantial download time. Each install creates a new copy; older
          managed copies remain available on disk.
        </p>
        <div class="tool-actions">
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            disabled={!desktop || !platform.managedTexlive || toolBusy}
            onclick={() => void onmanagetexlive('install')}>Install managed TeX Live</button
          >
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            disabled={!desktop || !platform.managedTexlive || toolBusy}
            onclick={() => void onmanagetexlive('update')}>Update managed TeX Live</button
          >
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            disabled={!desktop || toolBusy}
            onclick={() =>
              void invokeHost('open_external', {
                url: 'https://tug.org/texlive/acquire-netinstall.html',
              }).catch((reason) => ontoolerror(String(reason)))}>TeX Live download page</button
          >
        </div>
        <div class="tool-actions">
          <button
            type="button"
            class="btn btn-primary btn-sm"
            disabled={!desktop || !platform.managedTools || toolBusy}
            onclick={() => void ondownloadtools(['marksman', 'tinymist', 'texlab', 'typst'])}
            >Download / update standalone tools</button
          >
        </div>
        {#if !desktop || !platform.managedTools}<p class="hint">
            Managed tool downloads are unavailable on this platform. Choose an installed executable
            instead.
          </p>{/if}
        {#if toolMessage}<p class="hint" role="status">{toolMessage}</p>{/if}
        {#if toolError}<p class="error" role="alert" style="white-space: pre-wrap">
            {toolError}
          </p>{/if}
        {#if discoveryError}<p class="error">
            Could not discover LaTeX engines: {discoveryError}
          </p>{/if}
      </div>
    </div>
    <footer>
      <span class="hint">Saved on this device</span><button
        class="btn btn-primary btn-sm"
        aria-label="Apply preferences"
        onclick={save}
        ><span class="apply-full">Apply preferences</span><span class="apply-short">Apply</span
        ></button
      >
    </footer>
    <datalist id="ui-font-presets">
      {#each UI_FONT_PRESETS as preset (preset.value)}
        <option value={preset.value}>{preset.label}</option>
      {/each}
    </datalist>
    <datalist id="text-font-presets">
      {#each TEXT_FONT_PRESETS as preset (preset.value)}
        <option value={preset.value}>{preset.label}</option>
      {/each}
    </datalist>
    <datalist id="code-font-presets">
      {#each CODE_FONT_PRESETS as preset (preset.value)}
        <option value={preset.value}>{preset.label}</option>
      {/each}
    </datalist>
    <datalist id="math-font-presets">
      {#each MATH_FONT_PRESETS as preset (preset.value)}
        <option value={preset.value}>{preset.label}</option>
      {/each}
    </datalist>
  </div>
  <button class="modal-backdrop" aria-label="Dismiss settings" onclick={onclose}></button>
</dialog>

<style>
  .tool-setting {
    margin-bottom: 12px;
    font-size: 13px;
  }
  .tool-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin-top: 5px;
  }
  .tool-controls input {
    flex: 1 1 180px;
    min-width: 0;
  }
  .tool-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 6px;
    margin-bottom: 8px;
  }
</style>

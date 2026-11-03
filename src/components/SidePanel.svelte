<script lang="ts">
  import { onDestroy, type Component } from 'svelte';
  import {
    ArrowLeft,
    ArrowRight,
    ExternalLink,
    List,
    Maximize2,
    NotebookPen,
    RotateCw,
    X,
  } from '@lucide/svelte';
  import ZoomControls from './ZoomControls.svelte';
  import SiteIcon from './SiteIcon.svelte';
  import type { Heading } from '../lib/types';
  import type { BrowserState } from '../lib/browser';
  import {
    browserAvailable,
    browserSetBounds,
    browserSetVisible,
    browserTarget,
  } from '../lib/browser';
  import { basename } from '../lib/paths';
  import { SITES, isSiteTab, type RightTab, type SiteId } from '../lib/sites';
  import { DEFAULT_BROWSER_WIDTH, MIN_BROWSER_WIDTH, type ZoomAction } from '../lib/view';

  let {
    headings,
    activePath,
    hasDocument,
    tab,
    browser,
    visible,
    width,
    maximum,
    scale,
    onselecttab,
    onresize,
    oncommit,
    onnavigate,
    onback,
    onforward,
    onreload,
    onstop,
    onopenexternal,
    onopenwindow,
    onbrowserzoom,
    onclosepanel,
    onanchor,
  }: {
    headings: Heading[];
    activePath: string;
    hasDocument: boolean;
    tab: RightTab;
    browser: BrowserState;
    visible: boolean;
    width: number;
    maximum: number;
    scale: number;
    onselecttab: (tab: RightTab) => void;
    onresize: (width: number) => void;
    oncommit: () => void;
    onnavigate: (url: string) => void;
    onback: () => void;
    onforward: () => void;
    onreload: () => void;
    onstop: () => void;
    onopenexternal: () => void;
    onopenwindow: () => void;
    onbrowserzoom: (action: ZoomAction) => void;
    onclosepanel: () => void;
    onanchor: (id: string) => void;
  } = $props();

  const KEYBOARD_STEP = 16;
  let address = $state('');
  let addressInput = $state<HTMLInputElement>();
  let surface = $state<HTMLElement>();
  let note = $state('');
  let noteSaved = $state(false);
  let dragging = $state(false);
  let startX = 0;
  let startWidth = 0;
  let frame = 0;
  let noteTimer: ReturnType<typeof setTimeout> | undefined;
  const allTabs: { id: RightTab; label: string; icon?: Component; site?: SiteId }[] = [
    { id: 'outline', label: 'Outline', icon: List },
    ...SITES.map((site) => ({ id: site.id, label: site.label, site: site.id })),
    { id: 'notes', label: 'Notes', icon: NotebookPen },
  ];
  const tabs = $derived(allTabs.filter((item) => !item.site || browserAvailable()));

  $effect(() => {
    const value = browser.url;
    if (value && document.activeElement !== addressInput) address = value;
  });
  $effect(() => {
    const path = activePath;
    note = path ? (localStorage.getItem(`papyri.note:${path}`) ?? '') : '';
    noteSaved = false;
  });
  $effect(() => {
    if (!isSiteTab(tab) || !visible) return;
    const focusAddress = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (event.key.toLowerCase() !== 'l') return;
      event.preventDefault();
      addressInput?.focus();
      addressInput?.select();
    };
    window.addEventListener('keydown', focusAddress);
    return () => window.removeEventListener('keydown', focusAddress);
  });
  $effect(() => {
    if (!browserAvailable()) return;
    const shouldShow = isSiteTab(tab) && visible && !dragging;
    void browserSetVisible(shouldShow).catch((error) =>
      console.error('Browser visibility:', error),
    );
  });
  $effect(() => {
    void tab;
    void visible;
    void width;
    void scale;
    if (!isSiteTab(tab) || !surface || dragging) return;

    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!surface) return;
        const rect = surface.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) return;
        void browserSetBounds({
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        }).catch((error) => console.error('Browser bounds:', error));
      });
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(surface);
    if (surface.parentElement) observer.observe(surface.parentElement);
    window.addEventListener('resize', sync);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', sync);
    };
  });
  onDestroy(() => {
    cancelAnimationFrame(frame);
    if (noteTimer) clearTimeout(noteTimer);
    document.body.classList.remove('side-panel-resizing');
    window.removeEventListener('pointermove', moveResize);
    window.removeEventListener('pointerup', stopResize);
    window.removeEventListener('pointercancel', stopResize);
    if (browserAvailable()) void browserSetVisible(false).catch(() => {});
  });

  const clamp = (value: number) =>
    Math.max(MIN_BROWSER_WIDTH, Math.min(maximum, Math.round(value)));
  function startResize(event: PointerEvent) {
    if (event.button !== 0) return;
    startX = event.clientX;
    startWidth = width;
    dragging = true;
    document.body.classList.add('side-panel-resizing');
    window.addEventListener('pointermove', moveResize);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
    event.preventDefault();
  }
  function moveResize(event: PointerEvent) {
    if (dragging) onresize(clamp(startWidth - (event.clientX - startX) / scale));
  }
  function stopResize() {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('side-panel-resizing');
    window.removeEventListener('pointermove', moveResize);
    window.removeEventListener('pointerup', stopResize);
    window.removeEventListener('pointercancel', stopResize);
    oncommit();
  }
  function resizeKeyboard(event: KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'Escape'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Escape') {
      if (dragging) {
        onresize(startWidth);
        stopResize();
      }
      return;
    }
    onresize(
      clamp(
        event.key === 'Home'
          ? DEFAULT_BROWSER_WIDTH
          : width + (event.key === 'ArrowLeft' ? KEYBOARD_STEP : -KEYBOARD_STEP),
      ),
    );
    oncommit();
  }
  function submitAddress(event: Event) {
    event.preventDefault();
    const target = browserTarget(address);
    address = target;
    onnavigate(target);
    addressInput?.blur();
  }
  function updateNote(value: string) {
    note = value;
    noteSaved = false;
    if (activePath) {
      try {
        localStorage.setItem(`papyri.note:${activePath}`, value);
        noteSaved = true;
      } catch {
        noteSaved = false;
      }
    }
    if (noteTimer) clearTimeout(noteTimer);
    noteTimer = setTimeout(() => (noteSaved = false), 1400);
  }
  function clearNote() {
    updateNote('');
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (WAI-ARIA window splitters use a focusable, keyboard-operated separator.) -->
<div
  class="side-panel-resize"
  class:dragging
  role="separator"
  tabindex="0"
  aria-label="Resize right panel"
  aria-orientation="vertical"
  aria-controls="side-panel"
  aria-valuemin={Math.min(MIN_BROWSER_WIDTH, maximum)}
  aria-valuemax={maximum}
  aria-valuenow={width}
  onpointerdown={startResize}
  onkeydown={resizeKeyboard}
  ondblclick={() => {
    onresize(clamp(DEFAULT_BROWSER_WIDTH));
    oncommit();
  }}
></div>
<aside
  id="side-panel"
  class="side-panel"
  style:--side-panel-width="{width}px"
  aria-label="Context panel"
>
  <div class="side-panel-tabs">
    <div class="side-panel-tablist" role="tablist" aria-label="Context panel">
      {#each tabs as item (item.id)}<button
          class="side-panel-tab"
          class:active={tab === item.id}
          role="tab"
          aria-selected={tab === item.id}
          onclick={() => onselecttab(item.id)}
          >{#if item.site}<SiteIcon site={item.site} />{:else if item.icon}{@const TabIcon =
              item.icon}<TabIcon size={14} />{/if}<span>{item.label}</span></button
        >{/each}
    </div>
    <button
      class="icon-button small side-panel-close"
      aria-label="Close right panel"
      title="Close right panel"
      onclick={onclosepanel}><X size={14} /></button
    >
  </div>
  <div class="side-panel-content">
    {#if tab === 'outline'}
      <div class="panel-outline" role="tabpanel" aria-label="Document outline">
        <div class="section-label">ON THIS PAGE</div>
        <nav class="outline-scroll">
          {#if hasDocument}
            {#each headings.slice(0, 1000) as heading (heading.id)}<button
                class="outline-link"
                style:padding-left="{Math.max(0, heading.level - 1) * 10 + 14}px"
                onclick={() => onanchor(heading.id)}>{heading.text}</button
              >{/each}
            {#if !headings.length}<p class="tree-note">No headings in this document.</p>{/if}
          {:else}<p class="tree-note">No document open.</p>{/if}
          {#if headings.length > 1000}<p class="tree-note">
              Showing the first 1,000 headings. Search can find the rest.
            </p>{/if}
        </nav>
        <div class="panel-outline-foot">
          <div class="reading-tip"><p><kbd>Ctrl B</kbd> toggles the explorer.</p></div>
        </div>
      </div>
    {:else if isSiteTab(tab)}
      <div class="panel-chat" role="tabpanel" aria-label={tab}>
        <div class="browser-toolbar">
          <button
            class="icon-button small"
            aria-label="Back"
            title="Back"
            disabled={!browser.canGoBack}
            onclick={onback}><ArrowLeft size={14} /></button
          ><button
            class="icon-button small"
            aria-label="Forward"
            title="Forward"
            disabled={!browser.canGoForward}
            onclick={onforward}><ArrowRight size={14} /></button
          ><button
            class="icon-button small"
            aria-label={browser.loading ? 'Stop loading' : 'Reload'}
            title={browser.loading ? 'Stop loading' : 'Reload'}
            onclick={() => (browser.loading ? onstop() : onreload())}
            >{#if browser.loading}<X size={14} />{:else}<RotateCw size={14} />{/if}</button
          >
          <form class="browser-address" onsubmit={submitAddress}>
            <input
              bind:this={addressInput}
              bind:value={address}
              spellcheck="false"
              autocapitalize="off"
              autocomplete="off"
              aria-label="Web address"
              placeholder="Search or enter an address"
              onblur={() => {
                if (browser.url) address = browser.url;
              }}
            />
          </form>
          <ZoomControls
            label="web page"
            value={Math.round((browser.zoom || 1) * 100)}
            minimum={25}
            maximum={500}
            onchange={onbrowserzoom}
          />
          <button
            class="icon-button small browser-open-window"
            aria-label="Open in new window"
            title="Open in new window"
            onclick={onopenwindow}><Maximize2 size={14} /></button
          ><button
            class="icon-button small browser-open-external"
            aria-label="Open in system browser"
            title="Open in system browser"
            onclick={onopenexternal}><ExternalLink size={14} /></button
          >
        </div>
        <div class="browser-surface" bind:this={surface} aria-label="{tab} browser content">
          {#if browser.error}<p class="browser-status" role="alert">{browser.error}</p>{:else}<p
              class="browser-status"
            >
              {browser.loading ? 'Loading…' : SITES.find((site) => site.id === tab)?.label}
            </p>{/if}
        </div>
      </div>
    {:else}
      <div class="panel-notes" role="tabpanel" aria-label="Document notes">
        <div class="panel-notes-head">
          <div>
            <span class="eyebrow">NOTES</span><strong
              >{basename(activePath) || 'No document'}</strong
            >
          </div>
          <button class="btn btn-ghost btn-xs" disabled={!hasDocument} onclick={clearNote}
            >Clear</button
          >
        </div>
        <textarea
          class="notes-editor"
          aria-label="Document notes"
          placeholder={hasDocument
            ? 'Write notes for this document…'
            : 'Open a document to take notes.'}
          bind:value={note}
          disabled={!hasDocument}
          oninput={(event) => updateNote(event.currentTarget.value)}></textarea>
        <div class="notes-status">
          {hasDocument
            ? noteSaved
              ? 'Saved locally'
              : 'Stored locally · never uploaded'
            : 'No document open'}
        </div>
      </div>
    {/if}
  </div>
</aside>

<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { Folder, X } from '@lucide/svelte';
  import FileIcon from './FileIcon.svelte';
  import { basename, displayPath, displayPathMessage } from '../lib/paths';
  import { openDialog } from '../lib/dialog';
  import type { Source } from '../lib/types';

  let {
    source,
    directory,
    onclose,
    oncreated,
    initialKind = 'markdown',
  }: {
    source: Source;
    directory: string;
    onclose: () => void;
    oncreated: (path: string, kind: 'folder' | 'markdown' | 'typst' | 'latex') => void;
    initialKind?: 'folder' | 'markdown';
  } = $props();
  let kind = $state<'folder' | 'markdown' | 'typst' | 'latex'>(untrack(() => initialKind));
  let name = $state('');
  let busy = $state(false);
  let error = $state('');
  let nameInput: HTMLInputElement;
  onMount(() => nameInput.focus());
  async function create() {
    if (busy || !source.create) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === '.' || trimmed === '..' || /[/\\]/.test(trimmed)) {
      error = 'Enter a single file or folder name.';
      return;
    }
    const extension = { markdown: '.md', typst: '.typ', latex: '.tex', folder: '' }[kind];
    const filename =
      extension && !trimmed.toLowerCase().endsWith(extension) ? trimmed + extension : trimmed;
    busy = true;
    error = '';
    try {
      const path = await source.create(directory, filename, kind);
      oncreated(path, kind);
    } catch (reason) {
      error = String(reason);
      await tick();
      nameInput?.focus();
    } finally {
      busy = false;
    }
  }
</script>

<dialog
  use:openDialog
  class="modal modal-open"
  aria-labelledby="create-entry-title"
  oncancel={(event) => {
    if (busy) event.preventDefault();
    else onclose();
  }}
>
  <form
    class="modal-box create-entry-dialog"
    onsubmit={(event) => {
      event.preventDefault();
      void create();
    }}
  >
    <header class="create-header">
      <div>
        <p class="eyebrow">EXPLORER</p>
        <h2 id="create-entry-title">Create new</h2>
      </div>
      <button
        type="button"
        class="close-button"
        aria-label="Close"
        disabled={busy}
        onclick={onclose}><X size={16} /></button
      >
    </header>
    <div class="destination" title={displayPath(directory)}>
      <Folder size={15} /> <span>In <strong>{basename(directory)}</strong></span><span
        class="destination-path">{displayPath(directory)}</span
      >
    </div>
    <fieldset class="type-field" disabled={busy}>
      <legend>Choose a type</legend>
      <div class="type-grid">
        {#each [{ value: 'markdown', label: 'Markdown', extension: '.md', name: 'document.md' }, { value: 'typst', label: 'Typst', extension: '.typ', name: 'document.typ' }, { value: 'latex', label: 'LaTeX', extension: '.tex', name: 'document.tex' }, { value: 'folder', label: 'Folder', extension: 'Directory', name: 'folder' }] as option (option.value)}
          <label class="type-option" class:selected={kind === option.value}>
            <input type="radio" name="entry-type" value={option.value} bind:group={kind} />
            <span class="type-icon"
              ><FileIcon name={option.name} directory={option.value === 'folder'} /></span
            >
            <span class="type-copy"
              ><strong>{option.label}</strong><small>{option.extension}</small></span
            >
          </label>
        {/each}
      </div>
    </fieldset>
    <label class="name-field"
      >Name
      <input
        class="input input-bordered"
        bind:this={nameInput}
        bind:value={name}
        disabled={busy}
        required
        autocomplete="off"
        placeholder={kind === 'folder' ? 'Folder name' : 'Document name'}
      />
    </label>
    {#if error}<p class="create-entry-error" role="alert">{displayPathMessage(error)}</p>{/if}
    <div class="create-actions">
      <button type="button" class="btn btn-ghost" disabled={busy} onclick={onclose}>Cancel</button>
      <button type="submit" class="btn btn-primary" disabled={busy}
        >{busy ? 'Creating…' : 'Create'}</button
      >
    </div>
  </form>
</dialog>

<style>
  .modal-box.create-entry-dialog {
    width: min(430px, calc((var(--dialog-viewport-width, 100vw) - 32px) / var(--ui-scale, 1)));
    max-width: min(430px, calc((var(--dialog-viewport-width, 100vw) - 32px) / var(--ui-scale, 1)));
    padding: 22px;
    border-radius: 14px;
    line-height: 1.35;
    box-shadow: 0 18px 60px #0004;
  }
  .create-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
  }
  .create-entry-dialog .eyebrow {
    margin: 0 0 5px;
    color: var(--color-primary);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.1em;
  }
  .create-entry-dialog h2 {
    margin: 0;
    font-size: 20px;
    line-height: 1.2;
  }
  .close-button {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border: 0;
    border-radius: 7px;
    color: var(--muted);
    background: transparent;
  }
  .close-button:hover {
    background: var(--color-base-200);
    color: var(--color-base-content);
  }
  .destination {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    margin: 16px 0 19px;
    padding: 9px 10px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--color-base-200);
    font-size: 11px;
    color: var(--muted);
  }
  .destination :global(svg) {
    flex: none;
    color: var(--color-primary);
  }
  .destination strong {
    color: var(--color-base-content);
    font-weight: 600;
  }
  .destination-path {
    margin-left: auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    opacity: 0.75;
    direction: rtl;
    text-align: right;
  }
  .type-field {
    margin: 0;
    padding: 0;
    border: 0;
    min-width: 0;
  }
  .type-field legend,
  .name-field {
    margin-bottom: 7px;
    color: var(--muted);
    font-size: 11px;
    font-weight: 600;
  }
  .type-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  .type-option {
    position: relative;
    display: flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
    padding: 9px;
    border: 1px solid var(--line);
    border-radius: 8px;
    cursor: pointer;
    background: var(--color-base-200);
  }
  .type-option:hover {
    border-color: color-mix(in srgb, var(--color-primary) 45%, transparent);
  }
  .type-option.selected {
    border-color: var(--color-primary);
    background: color-mix(in srgb, var(--color-primary) 12%, var(--color-base-100));
  }
  .type-option:has(input:focus-visible) {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }
  .type-option input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
  }
  .type-icon {
    display: grid;
    place-items: center;
    flex: none;
    width: 32px;
    height: 32px;
    border-radius: 7px;
    background: color-mix(in srgb, var(--color-primary) 14%, var(--color-base-100));
    color: var(--color-primary);
  }
  .type-copy {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 2px;
  }
  .type-copy strong {
    color: var(--color-base-content);
    font-size: 12px;
    font-weight: 600;
  }
  .type-copy small {
    color: var(--muted);
    font-size: 10px;
  }
  .name-field {
    display: flex;
    flex-direction: column;
    gap: 7px;
    margin: 17px 0 0;
  }
  .name-field input {
    width: 100%;
    min-height: 38px;
    height: 38px;
    font-size: 13px;
    font-weight: 400;
  }
  .create-entry-dialog .create-entry-error {
    margin: 10px 0 0;
    color: var(--color-error);
    font-size: 12px;
    overflow-wrap: anywhere;
  }
  .create-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 19px;
  }
</style>

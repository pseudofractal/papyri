<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { basename } from '../lib/paths';
  let {
    path,
    depth,
    busy,
    onrename,
    oncancel,
  }: {
    path: string;
    depth: number;
    busy: boolean;
    onrename: (path: string, name: string) => void;
    oncancel: () => void;
  } = $props();
  let name = $state(untrack(() => basename(path)));
  let input: HTMLInputElement;
  onMount(() => {
    input.focus();
    const extension = name.lastIndexOf('.');
    input.setSelectionRange(0, extension > 0 ? extension : name.length);
  });
</script>

<form
  class="rename-row"
  style:padding-left="{12 + depth * 16}px"
  onsubmit={(event) => {
    event.preventDefault();
    onrename(path, name);
  }}
>
  <input
    bind:this={input}
    bind:value={name}
    aria-label="Rename file"
    disabled={busy}
    required
    onblur={() => {
      if (!busy) oncancel();
    }}
    onkeydown={(event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        oncancel();
      }
    }}
  />
</form>

<style>
  .rename-row {
    display: flex;
    width: 100%;
    padding-right: 6px;
    min-width: 0;
  }
  input {
    width: 100%;
    min-width: 0;
    height: 28px;
    padding: 3px 7px;
    background: var(--color-base-200);
    color: var(--color-base-content);
    border: 1px solid var(--color-primary);
    border-radius: 5px;
    font: inherit;
    font-size: 12px;
  }
</style>

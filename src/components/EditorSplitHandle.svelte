<script lang="ts">
  import { onMount } from 'svelte';

  let { value, onresize }: { value: number; onresize: (value: number) => void } = $props();
  let vertical = $state(true);
  let dragging = $state(false);
  let initial = 50;

  onMount(() => {
    const query = window.matchMedia('(max-width: 700px)');
    const update = () => (vertical = !query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  });
  $effect(() => {
    document.documentElement.classList.toggle('resizing-sidebar', dragging);
    return () => document.documentElement.classList.remove('resizing-sidebar');
  });
  const clamp = (next: number) => Math.max(20, Math.min(80, Math.round(next)));
  function start(event: PointerEvent) {
    if (event.button !== 0) return;
    initial = value;
    dragging = true;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  }
  function move(event: PointerEvent) {
    if (!dragging) return;
    const bounds = (event.currentTarget as HTMLElement).parentElement?.getBoundingClientRect();
    if (!bounds) return;
    const size = vertical ? bounds.width : bounds.height;
    const offset = vertical ? event.clientX - bounds.left : event.clientY - bounds.top;
    if (size > 0) onresize(clamp((offset / size) * 100));
  }
  function keyboard(event: KeyboardEvent) {
    const backward = vertical ? 'ArrowLeft' : 'ArrowUp';
    const forward = vertical ? 'ArrowRight' : 'ArrowDown';
    if (![backward, forward, 'Home', 'Escape'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Escape') {
      if (dragging) onresize(initial);
      dragging = false;
    } else onresize(event.key === 'Home' ? 50 : clamp(value + (event.key === forward ? 5 : -5)));
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (A window splitter is a focusable separator.) -->
<div
  class="editor-split-handle"
  class:dragging
  role="separator"
  tabindex="0"
  aria-label="Resize source and live preview"
  aria-orientation={vertical ? 'vertical' : 'horizontal'}
  aria-valuemin="20"
  aria-valuemax="80"
  aria-valuenow={value}
  onpointerdown={start}
  onpointermove={move}
  onpointerup={() => (dragging = false)}
  onpointercancel={() => (dragging = false)}
  onlostpointercapture={() => (dragging = false)}
  onkeydown={keyboard}
  ondblclick={() => onresize(50)}
></div>

<style>
  .editor-split-handle {
    flex: 0 0 6px;
    cursor: col-resize;
    touch-action: none;
    background: var(--color-base-200);
    border-left: 1px solid var(--line);
  }
  .editor-split-handle:hover,
  .editor-split-handle:focus-visible,
  .editor-split-handle.dragging {
    background: var(--color-primary);
    outline: none;
  }
  @media (max-width: 700px) {
    .editor-split-handle {
      cursor: row-resize;
      border-left: 0;
      border-top: 1px solid var(--line);
    }
  }
</style>

<script lang="ts">
  import { Minus, Plus } from '@lucide/svelte';
  import { MIN_ZOOM, MAX_ZOOM, type ZoomAction } from '../lib/view';
  let {
    label,
    value,
    onchange,
    minimum = MIN_ZOOM,
    maximum = MAX_ZOOM,
  }: {
    label: string;
    value: number;
    onchange: (action: ZoomAction) => void;
    minimum?: number;
    maximum?: number;
  } = $props();
</script>

<div class="zoom-controls" role="group" aria-label="{label} zoom">
  <button
    class="icon-button small"
    aria-label="Zoom out {label}"
    disabled={value <= minimum}
    onclick={() => onchange('out')}><Minus size={14} /></button
  >
  <button
    class="zoom-reset"
    aria-label="Reset {label} zoom: {value}%"
    title="Reset to 100%"
    onclick={() => onchange('reset')}>{value + '%'}</button
  >
  <button
    class="icon-button small"
    aria-label="Zoom in {label}"
    disabled={value >= maximum}
    onclick={() => onchange('in')}><Plus size={14} /></button
  >
</div>

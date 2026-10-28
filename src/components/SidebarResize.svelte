<script lang="ts">
  import { DEFAULT_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH } from '../lib/view';
  let {
    width,
    maximum,
    scale,
    onresize,
    oncommit,
  }: {
    width: number;
    maximum: number;
    scale: number;
    onresize: (width: number) => void;
    oncommit: () => void;
  } = $props();
  const KEYBOARD_STEP = 16;
  let dragging = $state(false);
  let startX = 0;
  let startWidth = 0;
  const clamp = (value: number) =>
    Math.max(MIN_SIDEBAR_WIDTH, Math.min(maximum, Math.round(value)));
  function start(event: PointerEvent) {
    if (event.button !== 0) return;
    startX = event.clientX;
    startWidth = width;
    dragging = true;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  }
  function move(event: PointerEvent) {
    if (dragging) onresize(clamp(startWidth + (event.clientX - startX) / scale));
  }
  function stop() {
    if (dragging) {
      dragging = false;
      oncommit();
    }
  }
  function keyboard(event: KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'Escape'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Escape') {
      if (dragging) {
        onresize(startWidth);
        stop();
      }
      return;
    }
    onresize(
      clamp(
        event.key === 'Home'
          ? DEFAULT_SIDEBAR_WIDTH
          : width + (event.key === 'ArrowRight' ? KEYBOARD_STEP : -KEYBOARD_STEP),
      ),
    );
    oncommit();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (WAI-ARIA window splitters use a focusable, keyboard-operated separator.) -->
<div
  class="sidebar-resize"
  class:dragging
  role="separator"
  tabindex="0"
  aria-label="Resize explorer"
  aria-orientation="vertical"
  aria-controls="file-explorer"
  aria-valuemin={MIN_SIDEBAR_WIDTH}
  aria-valuemax={maximum}
  aria-valuenow={width}
  onpointerdown={start}
  onpointermove={move}
  onpointerup={stop}
  onpointercancel={stop}
  onlostpointercapture={stop}
  onkeydown={keyboard}
  ondblclick={() => {
    onresize(clamp(DEFAULT_SIDEBAR_WIDTH));
    oncommit();
  }}
></div>

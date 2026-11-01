import { diagramPng, diagramSvg } from './diagram-export';

/** Move the live diagram into a modal, preserving SVG IDs and chart interaction state. */
export function createDiagramViewer(
  output: HTMLElement,
  format: string,
  onExpanded: (expanded: boolean) => void,
  exportDiagram: (action: 'download' | 'copy', blob: Blob) => Promise<string>,
  canExport: boolean,
) {
  const viewport = document.createElement('div');
  viewport.className = 'diagram-viewport';
  viewport.tabIndex = 0;
  viewport.setAttribute('role', 'region');
  viewport.setAttribute('aria-label', `${format} diagram viewport`);
  viewport.append(output);
  const expandButton = document.createElement('button');
  expandButton.type = 'button';
  expandButton.textContent = 'Expand diagram';
  expandButton.disabled = true;
  const dialog = document.createElement('dialog');
  dialog.className = 'diagram-dialog';
  dialog.setAttribute('aria-label', `${format} diagram`);
  const expandedViewport = document.createElement('div');
  expandedViewport.className = 'diagram-viewport';
  expandedViewport.tabIndex = 0;
  expandedViewport.setAttribute('role', 'region');
  expandedViewport.setAttribute('aria-label', `${format} diagram viewport`);
  const interactiveChart = format === 'vega' || format === 'vega-lite';
  expandedViewport.title = `${interactiveChart ? 'Shift-drag' : 'Drag'} to pan · Ctrl/⌘-scroll to zoom`;
  const controls = document.createElement('div');
  controls.className = 'diagram-zoom-controls';
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', 'Diagram controls');
  const zoomOut = document.createElement('button');
  zoomOut.type = 'button';
  zoomOut.setAttribute('aria-label', 'Zoom out diagram');
  zoomOut.textContent = '−';
  const reset = document.createElement('button');
  reset.type = 'button';
  const zoomIn = document.createElement('button');
  zoomIn.type = 'button';
  zoomIn.setAttribute('aria-label', 'Zoom in diagram');
  zoomIn.textContent = '+';
  const fit = document.createElement('button');
  fit.type = 'button';
  fit.setAttribute('aria-label', 'Fit diagram to screen');
  fit.textContent = 'Fit';
  const close = document.createElement('button');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close diagram');
  close.textContent = 'Close';
  close.autofocus = true;
  close.onclick = () => dialog.close();
  const downloadSvg = document.createElement('button');
  downloadSvg.type = 'button';
  downloadSvg.textContent = 'SVG';
  downloadSvg.setAttribute('aria-label', 'Download diagram as SVG');
  const downloadPng = document.createElement('button');
  downloadPng.type = 'button';
  downloadPng.textContent = 'PNG';
  downloadPng.setAttribute('aria-label', 'Download diagram as PNG');
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = 'Copy';
  copy.setAttribute('aria-label', 'Copy diagram as PNG');
  const status = document.createElement('div');
  status.className = 'diagram-export-status';
  status.setAttribute('role', 'status');
  const exportButtons = [downloadSvg, downloadPng, copy];
  let viewGeneration = 0;
  for (const button of exportButtons) {
    button.disabled = !canExport;
    if (!canExport) button.title = 'Export is unavailable while document scripts are enabled.';
  }
  async function exportImage(action: 'download' | 'copy', raster: boolean) {
    const generation = viewGeneration;
    for (const button of exportButtons) button.disabled = true;
    status.textContent = raster ? 'Preparing PNG…' : 'Preparing SVG…';
    try {
      const svg = diagramSvg(output, zoom);
      const blob = raster ? await diagramPng(svg) : svg;
      const message = await exportDiagram(action, blob);
      if (generation === viewGeneration) status.textContent = message;
    } catch (error) {
      if (generation === viewGeneration) status.textContent = `Export failed: ${String(error)}`;
    } finally {
      if (generation === viewGeneration)
        for (const button of exportButtons) button.disabled = !canExport;
    }
  }
  downloadSvg.onclick = () => void exportImage('download', false);
  downloadPng.onclick = () => void exportImage('download', true);
  copy.onclick = () => void exportImage('copy', true);
  const minimumZoom = 1;
  const maximumZoom = 400;
  const zoomStep = 10;
  let zoom = 100;
  let fitting = true;
  function setZoom(value: number, pointer?: { x: number; y: number }) {
    const nextZoom = Math.max(minimumZoom, Math.min(maximumZoom, value));
    const before = expandedViewport.getBoundingClientRect();
    const anchorX = pointer ? pointer.x - before.left : expandedViewport.clientWidth / 2;
    const anchorY = pointer ? pointer.y - before.top : expandedViewport.clientHeight / 2;
    const centerX = (expandedViewport.scrollLeft + anchorX) / zoom;
    const centerY = (expandedViewport.scrollTop + anchorY) / zoom;
    zoom = nextZoom;
    output.style.zoom = String(zoom / 100);
    reset.textContent = `${zoom}%`;
    reset.setAttribute('aria-label', `Reset diagram zoom: ${zoom}%`);
    zoomOut.disabled = zoom <= minimumZoom;
    zoomIn.disabled = zoom >= maximumZoom;
    const after = expandedViewport.getBoundingClientRect();
    expandedViewport.scrollLeft =
      centerX * zoom - (pointer ? pointer.x - after.left : expandedViewport.clientWidth / 2);
    expandedViewport.scrollTop =
      centerY * zoom - (pointer ? pointer.y - after.top : expandedViewport.clientHeight / 2);
  }
  function fitToScreen() {
    if (!dialog.open) return;
    const bounds = output.getBoundingClientRect();
    const naturalWidth = bounds.width / (zoom / 100);
    const naturalHeight = bounds.height / (zoom / 100);
    const viewportMargin = 0.9;
    const panelPadding = 34;
    const controlsHeight =
      controls.getBoundingClientRect().height + status.getBoundingClientRect().height + 24;
    const availableWidth = Math.max(1, window.innerWidth * viewportMargin - panelPadding);
    const availableHeight = Math.max(
      1,
      window.innerHeight * viewportMargin - panelPadding - controlsHeight,
    );
    if (naturalWidth > 0 && naturalHeight > 0)
      setZoom(
        Math.floor(
          Math.min(1, availableWidth / naturalWidth, availableHeight / naturalHeight) * 100,
        ),
      );
  }
  function manualZoom(value: number) {
    fitting = false;
    setZoom(value);
  }
  zoomOut.onclick = () => manualZoom(zoom - zoomStep);
  zoomIn.onclick = () => manualZoom(zoom + zoomStep);
  reset.onclick = () => manualZoom(100);
  fit.onclick = () => {
    fitting = true;
    fitToScreen();
  };
  dialog.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
    if ((event.target as Element).closest('input,textarea,select,[contenteditable]')) return;
    if (event.key === '+' || event.key === '=') manualZoom(zoom + zoomStep);
    else if (event.key === '-' || event.key === '−') manualZoom(zoom - zoomStep);
    else if (event.key === '0') manualZoom(100);
    else return;
    event.preventDefault();
    event.stopPropagation();
  });
  const resize = () => {
    if (fitting) fitToScreen();
  };
  expandedViewport.addEventListener(
    'wheel',
    (event) => {
      if (!(event.ctrlKey || event.metaKey) || !event.deltaY) return;
      event.preventDefault();
      fitting = false;
      setZoom(zoom + (event.deltaY < 0 ? zoomStep : -zoomStep), {
        x: event.clientX,
        y: event.clientY,
      });
    },
    { passive: false },
  );
  let drag:
    { id: number; x: number; y: number; left: number; top: number; moved: boolean } | undefined;
  let suppressClick = false;
  expandedViewport.addEventListener('pointerdown', (event) => {
    suppressClick = false;
    if (
      event.pointerType !== 'mouse' ||
      event.button !== 0 ||
      (interactiveChart && !event.shiftKey)
    )
      return;
    if (
      (event.target as Element).closest(
        'a,button,input,select,textarea,[contenteditable], [role="button"]',
      )
    )
      return;
    drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: expandedViewport.scrollLeft,
      top: expandedViewport.scrollTop,
      moved: false,
    };
  });
  expandedViewport.addEventListener('pointermove', (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    const deltaX = event.clientX - drag.x;
    const deltaY = event.clientY - drag.y;
    const dragThreshold = 4;
    if (!drag.moved && Math.hypot(deltaX, deltaY) < dragThreshold) return;
    if (!drag.moved) {
      drag.moved = true;
      expandedViewport.setPointerCapture(event.pointerId);
      expandedViewport.classList.add('panning');
    }
    event.preventDefault();
    expandedViewport.scrollLeft = drag.left - deltaX;
    expandedViewport.scrollTop = drag.top - deltaY;
  });
  const endDrag = (event: PointerEvent) => {
    if (!drag || drag.id !== event.pointerId) return;
    suppressClick = drag.moved;
    drag = undefined;
    expandedViewport.classList.remove('panning');
    if (expandedViewport.hasPointerCapture(event.pointerId))
      expandedViewport.releasePointerCapture(event.pointerId);
  };
  expandedViewport.addEventListener('pointerup', endDrag);
  expandedViewport.addEventListener('pointercancel', endDrag);
  expandedViewport.addEventListener(
    'click',
    (event) => {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    },
    true,
  );
  controls.append(zoomOut, reset, zoomIn, fit, downloadSvg, downloadPng, copy, close);
  dialog.append(expandedViewport, controls, status);
  const controlsObserver = new ResizeObserver(() => {
    const height =
      controls.getBoundingClientRect().height + status.getBoundingClientRect().height + 24;
    dialog.style.setProperty('--diagram-controls-height', `${height}px`);
    if (fitting) fitToScreen();
  });
  expandButton.onclick = () => {
    viewGeneration++;
    for (const button of exportButtons) button.disabled = !canExport;
    document.body.append(dialog);
    expandedViewport.append(output);
    setZoom(100);
    dialog.showModal();
    status.textContent = canExport
      ? ''
      : 'Export is unavailable while document scripts are enabled.';
    fitting = true;
    onExpanded(true);
    controlsObserver.observe(controls);
    controlsObserver.observe(status);
    window.addEventListener('resize', resize);
    requestAnimationFrame(() => {
      if (fitting) fitToScreen();
    });
  };
  dialog.addEventListener('close', () => {
    viewGeneration++;
    output.style.zoom = '';
    controlsObserver.disconnect();
    window.removeEventListener('resize', resize);
    viewport.append(output);
    dialog.remove();
    onExpanded(false);
    expandButton.focus();
  });
  return { viewport, expandButton };
}

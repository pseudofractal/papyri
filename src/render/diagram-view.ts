import { createMediaViewer } from './media-view';

/** Move the live diagram into a modal, preserving SVG IDs and chart interaction state. */
export function createDiagramViewer(
  output: HTMLElement,
  format: string,
  onExpanded: (expanded: boolean) => void,
  exportDiagram: (action: 'download' | 'copy', blob: Blob) => Promise<string>,
  canExport: boolean,
) {
  return createMediaViewer(output, {
    kind: 'diagram',
    label: `${format} diagram`,
    onExpanded,
    interactive: format === 'vega' || format === 'vega-lite',
    exportDiagram,
    canExport,
  });
}

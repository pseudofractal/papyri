/** Move the live diagram into a modal, preserving SVG IDs and chart interaction state. */
export function createDiagramViewer(
  output: HTMLElement,
  format: string,
  onExpanded: (expanded: boolean) => void,
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
  const header = document.createElement('header');
  const title = document.createElement('strong');
  title.textContent = `${format} diagram`;
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Close diagram';
  close.autofocus = true;
  close.onclick = () => dialog.close();
  header.append(title, close);
  const expandedViewport = document.createElement('div');
  expandedViewport.className = 'diagram-viewport';
  expandedViewport.tabIndex = 0;
  expandedViewport.setAttribute('role', 'region');
  expandedViewport.setAttribute('aria-label', `${format} diagram viewport`);
  dialog.append(header, expandedViewport);
  expandButton.onclick = () => {
    document.body.append(dialog);
    expandedViewport.append(output);
    dialog.showModal();
    onExpanded(true);
  };
  dialog.addEventListener('close', () => {
    viewport.append(output);
    dialog.remove();
    onExpanded(false);
    expandButton.focus();
  });
  return { viewport, expandButton };
}

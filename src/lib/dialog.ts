/** Native modal semantics provide focus trapping, Escape handling, and focus restoration. */
export function openDialog(dialog: HTMLDialogElement) {
  const viewport = window.visualViewport;
  function measureViewport() {
    const width = Math.min(window.innerWidth, viewport?.width ?? window.innerWidth);
    const height = Math.min(window.innerHeight, viewport?.height ?? window.innerHeight);
    dialog.style.setProperty('--dialog-viewport-width', `${width}px`);
    dialog.style.setProperty('--dialog-viewport-height', `${height}px`);
    dialog.style.setProperty('--dialog-viewport-left', `${viewport?.offsetLeft ?? 0}px`);
    dialog.style.setProperty('--dialog-viewport-top', `${viewport?.offsetTop ?? 0}px`);
  }
  measureViewport();
  window.addEventListener('resize', measureViewport);
  viewport?.addEventListener('resize', measureViewport);
  viewport?.addEventListener('scroll', measureViewport);
  dialog.showModal();
  return {
    destroy() {
      window.removeEventListener('resize', measureViewport);
      viewport?.removeEventListener('resize', measureViewport);
      viewport?.removeEventListener('scroll', measureViewport);
      dialog.close();
    },
  };
}

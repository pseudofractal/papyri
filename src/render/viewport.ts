/** Keep document layout in the iframe's CSS pixels, independently of parent UI zoom. */
export function syncViewportSize() {
  const viewport = window.visualViewport;
  // WebKitGTK scales clientWidth and CSS vw by ancestor zoom, but not innerWidth.
  // At normal visual zoom, also exclude any space occupied by native scrollbars.
  const width =
    viewport?.scale === 1 ? Math.min(window.innerWidth, viewport.width) : window.innerWidth;
  const height =
    viewport?.scale === 1 ? Math.min(window.innerHeight, viewport.height) : window.innerHeight;
  document.documentElement.style.setProperty('--viewport-width', `${width}px`);
  document.documentElement.style.setProperty('--viewport-height', `${height}px`);
}

syncViewportSize();
window.addEventListener('resize', syncViewportSize);
window.visualViewport?.addEventListener('resize', syncViewportSize);

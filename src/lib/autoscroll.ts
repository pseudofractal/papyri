/**
 * Keep a scrolling log pinned to its newest line until the reader scrolls away.
 */
export function autoscroll(node: HTMLElement) {
  const PIN_THRESHOLD_PX = 24;
  let pinned = true;
  const bottom = () => node.scrollHeight - node.scrollTop - node.clientHeight;

  const scrollToLatest = () => {
    if (pinned) node.scrollTop = node.scrollHeight;
  };
  const tracksPosition = () => {
    pinned = bottom() < PIN_THRESHOLD_PX;
  };

  node.addEventListener('scroll', tracksPosition, { passive: true });
  const observer = new MutationObserver(scrollToLatest);
  observer.observe(node, { childList: true, subtree: true, characterData: true });
  const resize = new ResizeObserver(scrollToLatest);
  resize.observe(node);
  const initialScroll = requestAnimationFrame(scrollToLatest);

  return {
    destroy() {
      cancelAnimationFrame(initialScroll);
      observer.disconnect();
      resize.disconnect();
      node.removeEventListener('scroll', tracksPosition);
    },
  };
}

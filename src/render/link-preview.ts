const HOVER_DELAY_MS = 500;
const CARD_GAP = 12;
const CARD_WIDTH = 320;
const CARD_HEIGHT = 240;
const VIEWPORT_MARGIN = 12;
const IMAGE_PATH = /\.(?:png|jpe?g|gif|webp|avif|svg)(?:$|[?#])/i;

/** Show external destinations immediately and preview them after a deliberate hover or focus. */
export function installLinkPreviews(root: HTMLElement, networkAllowed: boolean) {
  const status = document.createElement('div');
  status.className = 'link-preview-destination';
  status.setAttribute('role', 'status');
  status.hidden = true;
  const card = document.createElement('div');
  card.className = 'link-preview-card';
  card.setAttribute('aria-hidden', 'true');
  card.hidden = true;
  document.body.append(status, card);
  let current: HTMLAnchorElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function hide() {
    clearTimeout(timer);
    current = null;
    status.hidden = true;
    card.hidden = true;
    card.replaceChildren();
  }
  function show(anchor: HTMLAnchorElement, x: number, y: number) {
    const href = anchor.dataset.previewHref || anchor.getAttribute('href') || '';
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      hide();
      return;
    }
    if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) {
      hide();
      return;
    }
    if (current === anchor) return;
    hide();
    current = anchor;
    const hasCredentials = Boolean(url.username || url.password);
    url.username = '';
    url.password = '';
    status.textContent = url.href;
    status.hidden = false;
    timer = setTimeout(() => {
      if (current !== anchor) return;
      const title = document.createElement('strong');
      title.textContent = url.protocol === 'mailto:' ? 'Email link' : url.hostname;
      const message = document.createElement('p');
      if (url.protocol === 'mailto:') message.textContent = 'Opens your mail application.';
      else if (hasCredentials)
        message.textContent = 'Preview unavailable for links containing credentials.';
      else if (!networkAllowed)
        message.textContent =
          'External previews are blocked. Enable network resources in Settings to load them.';
      else if (IMAGE_PATH.test(url.href)) {
        const image = document.createElement('img');
        image.alt = 'Linked image preview';
        image.referrerPolicy = 'no-referrer';
        message.textContent = 'Loading image…';
        image.onload = () => {
          message.textContent = '';
        };
        image.onerror = () => {
          message.textContent = 'Image preview unavailable.';
          image.remove();
        };
        image.src = url.href;
        card.append(image);
      } else {
        const frame = document.createElement('iframe');
        frame.title = `Preview of ${url.hostname}`;
        frame.tabIndex = -1;
        frame.sandbox.value = '';
        frame.referrerPolicy = 'no-referrer';
        frame.src = url.href;
        message.textContent = 'Loading preview… Some sites do not allow previews.';
        frame.onload = () => {
          message.textContent = 'Some sites do not allow previews.';
        };
        card.append(frame);
      }
      card.prepend(title);
      card.append(message);
      card.style.left = `${Math.max(VIEWPORT_MARGIN, Math.min(x + CARD_GAP, window.innerWidth - CARD_WIDTH - VIEWPORT_MARGIN))}px`;
      const below = y + CARD_GAP;
      const top = below + CARD_HEIGHT > window.innerHeight ? y - CARD_HEIGHT - CARD_GAP : below;
      card.style.top = `${Math.max(VIEWPORT_MARGIN, top)}px`;
      card.hidden = false;
    }, HOVER_DELAY_MS);
  }
  root.addEventListener('pointerover', (event) => {
    if (event.pointerType === 'touch') return;
    const anchor = (event.target as Element).closest<HTMLAnchorElement>('a[href]');
    if (anchor) show(anchor, event.clientX, event.clientY);
  });
  root.addEventListener('pointerout', (event) => {
    if (
      current &&
      (!(event.relatedTarget instanceof Node) || !current.contains(event.relatedTarget))
    )
      hide();
  });
  root.addEventListener('focusin', (event) => {
    const anchor = (event.target as Element).closest<HTMLAnchorElement>('a[href]');
    if (anchor?.matches(':focus-visible')) {
      const bounds = anchor.getBoundingClientRect();
      show(anchor, bounds.left, bounds.bottom);
    }
  });
  root.addEventListener('focusout', hide);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      hide();
      event.stopPropagation();
    }
  });
  window.addEventListener('scroll', hide, { passive: true });
  root.addEventListener('scroll', hide, { passive: true, capture: true });
  window.addEventListener('resize', hide);
  window.addEventListener('blur', hide);
}

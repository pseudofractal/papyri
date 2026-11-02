import { createMediaViewer } from './media-view';

type MediaElement = HTMLImageElement | SVGSVGElement;

const SKIP_ANCESTORS =
  'button,[role="button"],[contenteditable],.diagram,.media-dialog,.katex,math';

function descriptionFor(media: MediaElement): string {
  if (media instanceof HTMLImageElement)
    return media.alt.trim() || media.getAttribute('title')?.trim() || 'image';
  return (
    media.getAttribute('aria-label')?.trim() ||
    media.querySelector(':scope > title')?.textContent?.trim() ||
    'image'
  );
}

/** Return a function that restores the media's original inline presentation. */
function prepareForViewer(media: MediaElement): () => void {
  const previousStyle = media.getAttribute('style');
  const previousLoading = media instanceof HTMLImageElement ? media.getAttribute('loading') : null;
  media.style.maxWidth = 'none';
  if (media instanceof HTMLImageElement) {
    media.style.width = 'auto';
    media.style.height = 'auto';
    media.setAttribute('loading', 'eager');
  } else {
    const viewBox = media.viewBox.baseVal;
    const bounds = media.getBoundingClientRect();
    const width = viewBox.width || bounds.width;
    const height = viewBox.height || bounds.height;
    if (width > 0 && height > 0) {
      media.style.width = `${width}px`;
      media.style.height = `${height}px`;
    }
  }
  return () => {
    if (previousStyle === null) media.removeAttribute('style');
    else media.setAttribute('style', previousStyle);
    if (media instanceof HTMLImageElement) {
      if (previousLoading === null) media.removeAttribute('loading');
      else media.setAttribute('loading', previousLoading);
    }
  };
}

function addViewer(
  media: MediaElement,
  container: Element,
  linked: boolean,
  notifyHost: (message: Record<string, unknown>) => void,
): void {
  const description = descriptionFor(media);
  const label = description === 'image' ? 'image' : `image: ${description}`;
  const expandLabel = `Expand image${description === 'image' ? '' : `: ${description}`}`;

  const frame = document.createElement('span');
  frame.className = 'image-frame';
  frame.classList.toggle('linked', linked);
  frame.dataset.imageViewer = '';
  container.before(frame);
  frame.append(container);

  const placeholder = document.createElement('button');
  placeholder.type = 'button';
  placeholder.className = 'image-expand';
  placeholder.textContent = 'Expand image';
  placeholder.setAttribute('aria-label', expandLabel);
  frame.append(placeholder);

  const mediaParent = media.parentElement!;
  const mediaNext = media.nextSibling;
  let viewer: ReturnType<typeof createMediaViewer> | undefined;
  let expanded = false;
  let restoreStyle: (() => void) | undefined;

  function restoreMedia() {
    if (linked) mediaParent.insertBefore(media, mediaNext);
    else frame.insertBefore(media, viewer?.expandButton ?? null);
  }

  function openViewer() {
    if (expanded) return;
    if (!viewer) {
      const output = document.createElement('div');
      output.className = 'image-output';
      viewer = createMediaViewer(output, {
        kind: 'image',
        label,
        onExpanded(value) {
          if (!value) {
            restoreStyle?.();
            restoreStyle = undefined;
            restoreMedia();
          }
          expanded = value;
          notifyHost({ type: 'image-expanded', expanded: value });
        },
      });
      const button = viewer.expandButton;
      button.disabled = false;
      button.classList.add('image-expand');
      button.setAttribute('aria-label', expandLabel);
      const open = button.onclick;
      button.onclick = (event) => {
        if (expanded) return;
        if (media.parentElement !== output) {
          restoreStyle = prepareForViewer(media);
          output.append(media);
        }
        open?.call(button, event);
      };
      placeholder.replaceWith(button);
    }
    viewer.expandButton.click();
  }

  placeholder.onclick = openViewer;
  if (!linked)
    media.addEventListener('click', (event) => {
      if (expanded) return;
      if ((event.target as Element).closest('a,button,[role="button"]')) return;
      event.preventDefault();
      event.stopPropagation();
      openViewer();
    });
}

/** Make static Markdown images and inline SVG openable in the image viewer. */
export function installImageViewers(
  root: HTMLElement,
  notifyHost: (message: Record<string, unknown>) => void,
) {
  for (const media of root.querySelectorAll<MediaElement>('img, svg')) {
    if (media.closest(SKIP_ANCESTORS) || media.closest('.image-frame')) continue;
    if (media instanceof HTMLImageElement) {
      if (!media.getAttribute('src') || media.closest('picture')) continue;
    } else if (media.parentElement?.closest('svg')) {
      continue;
    }
    const link = media.closest('a');
    addViewer(media, link ?? media, Boolean(link), notifyHost);
  }
}

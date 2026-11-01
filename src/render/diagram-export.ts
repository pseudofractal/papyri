const MAX_EXPORT_BYTES = 16 * 1024 * 1024;
const MAX_RASTER_PIXELS = 16_000_000;
const EXPORT_STYLES = [
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'visibility',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-anchor',
  'dominant-baseline',
  'color',
  'paint-order',
];

/** Serialize the rendered SVG with its computed visual styles and without preview zoom. */
export function diagramSvg(output: HTMLElement, zoom: number): Blob {
  const svg = output.querySelector('svg');
  if (!svg) throw new Error('This diagram has no SVG to export.');
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const originalElements = [svg, ...svg.querySelectorAll('*')];
  const copiedElements = [clone, ...clone.querySelectorAll('*')];
  for (let index = 0; index < originalElements.length; index++) {
    const original = originalElements[index];
    const copy = copiedElements[index] as SVGElement;
    const style = getComputedStyle(original);
    for (const property of EXPORT_STYLES) {
      const value = style.getPropertyValue(property);
      if (value) copy.style.setProperty(property, value);
    }
  }
  for (const image of clone.querySelectorAll('image, use')) {
    const reference = image.getAttribute('href') || image.getAttribute('xlink:href') || '';
    if (reference && !reference.startsWith('#') && !reference.startsWith('data:'))
      throw new Error('Export cannot include external image resources.');
  }
  const bounds = svg.getBoundingClientRect();
  const width = bounds.width / (zoom / 100);
  const height = bounds.height / (zoom / 100);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
    throw new Error('The diagram has no usable dimensions.');
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.style.width = `${width}px`;
  clone.style.height = `${height}px`;
  const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' });
  if (blob.size > MAX_EXPORT_BYTES) throw new Error('The diagram exceeds the 16 MiB export limit.');
  return blob;
}

/** Rasterize an SVG within a bounded canvas; surface failures to the caller. */
export async function diagramPng(svg: Blob): Promise<Blob> {
  const url = URL.createObjectURL(svg);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Could not rasterize the diagram.'));
      image.src = url;
    });
    const width = Math.ceil(image.naturalWidth);
    const height = Math.ceil(image.naturalHeight);
    if (!width || !height || width * height > MAX_RASTER_PIXELS)
      throw new Error('The diagram exceeds the 16-megapixel PNG export limit.');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('PNG rendering is unavailable.');
    context.drawImage(image, 0, 0);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!png || png.size > MAX_EXPORT_BYTES)
      throw new Error('Could not create a PNG within the 16 MiB export limit.');
    return png;
  } finally {
    URL.revokeObjectURL(url);
  }
}

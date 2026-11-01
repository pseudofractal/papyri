import { invokeHost } from './native';
import { native } from './sources';

const MAX_EXPORT_BYTES = 16 * 1024 * 1024;
export type DiagramExportMime = 'image/svg+xml' | 'image/png';

/** Save or copy an exported diagram after the preview has requested the action. */
export async function exportDiagram(
  action: 'download' | 'copy',
  mime: DiagramExportMime,
  bytes: Uint8Array,
): Promise<string> {
  if (!bytes.length || bytes.length > MAX_EXPORT_BYTES)
    throw new Error('The diagram exceeds the 16 MiB export limit.');
  const blob = new Blob([bytes.slice().buffer], { type: mime });
  if (action === 'copy') {
    if (mime !== 'image/png' || !navigator.clipboard?.write || typeof ClipboardItem === 'undefined')
      throw new Error('Copying images is unavailable in this browser or desktop environment.');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return 'Diagram copied to clipboard.';
  }
  const format = mime === 'image/png' ? 'png' : 'svg';
  if (native) {
    const saved = await invokeHost<boolean>('save_diagram', { format, bytes: Array.from(bytes) });
    return saved ? 'Diagram saved.' : 'Save cancelled.';
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `diagram.${format}`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return 'Diagram download started.';
}

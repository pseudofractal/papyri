export const MIN_ZOOM = 50;
export const MAX_ZOOM = 200;
export const MIN_PDF_ZOOM = 10;
export const MAX_PDF_ZOOM = 1000;
export const ZOOM_STEP = 10;
export const DEFAULT_SIDEBAR_WIDTH = 254;
export const MIN_SIDEBAR_WIDTH = 180;
export const MAX_SIDEBAR_WIDTH = 10000;
export const DEFAULT_BROWSER_WIDTH = 440;
export const MIN_BROWSER_WIDTH = 280;
export const MAX_BROWSER_WIDTH = 10000;
export const DEFAULT_BROWSER_URL = 'https://chatgpt.com/';
export const DEFAULT_PALETTE_WIDTH_PERCENT = 70;
export const DEFAULT_PALETTE_HEIGHT_PERCENT = 60;
export const MIN_PALETTE_PERCENT = 40;
export const MAX_PALETTE_PERCENT = 100;
export const DEFAULT_PALETTE_MAX_WIDTH = 960;
export const DEFAULT_PALETTE_MAX_HEIGHT = 760;
export const MIN_PALETTE_MAX_WIDTH = 320;
export const MAX_PALETTE_MAX_WIDTH = 2000;
export const MIN_PALETTE_MAX_HEIGHT = 240;
export const MAX_PALETTE_MAX_HEIGHT = 1600;
export const NARROW_VIEWPORT = 760;
export const MAX_SCROLL_POSITION = 100_000_000;
export type ZoomTarget = 'document' | 'ui';
export type ZoomAction = 'in' | 'out' | 'reset';
export interface ZoomCommand {
  target: ZoomTarget;
  action: ZoomAction;
}
export type ViewCommand =
  | ZoomCommand
  | { target: 'document'; action: 'fit-width' }
  | { target: 'palette'; action: 'open' }
  | { target: 'tabs'; action: 'next' | 'previous' }
  | { target: 'view'; action: 'decorationless' };

export function viewShortcut(event: KeyboardEvent): ViewCommand | null {
  if (!(event.ctrlKey || event.metaKey)) return null;
  if (
    !event.altKey &&
    event.shiftKey &&
    (event.key.toLowerCase() === 'd' ||
      ((event.key === 'Unidentified' || event.key === '') && event.code === 'KeyD'))
  )
    return { target: 'view', action: 'decorationless' };
  if (
    !event.altKey &&
    !event.shiftKey &&
    (event.key.toLowerCase() === 'k' || event.code === 'KeyK')
  )
    return { target: 'palette', action: 'open' };
  // WebKitGTK can report Shift+Tab as Unidentified while preserving its physical code.
  if ((event.key === 'Tab' || event.code === 'Tab') && !event.altKey)
    return { target: 'tabs', action: event.shiftKey ? 'previous' : 'next' };
  const equalKey =
    event.key === '=' ||
    ((event.key === 'Unidentified' || event.key === '') && event.code === 'Equal');
  if (equalKey && !event.altKey && !event.shiftKey)
    return { target: 'document', action: 'fit-width' };
  return zoomShortcut(event);
}

export function clampZoom(value: number, minimum = MIN_ZOOM, maximum = MAX_ZOOM): number {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}
export function changeZoom(
  value: number,
  action: ZoomAction,
  minimum = MIN_ZOOM,
  maximum = MAX_ZOOM,
): number {
  return action === 'reset'
    ? 100
    : clampZoom(value + (action === 'in' ? ZOOM_STEP : -ZOOM_STEP), minimum, maximum);
}
export function zoomShortcut(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'> &
    Partial<Pick<KeyboardEvent, 'code' | 'shiftKey'>>,
): ZoomCommand | null {
  if (!(event.ctrlKey || event.metaKey)) return null;
  // WebKitGTK may omit the key value for modified keys; retain physical-key shortcuts.
  const key =
    event.key === 'Unidentified' || event.key === ''
      ? { Equal: '=', Minus: '-', Digit0: '0', NumpadAdd: '+', NumpadSubtract: '-', Numpad0: '0' }[
          event.code || ''
        ]
      : event.key;
  const action = ['+', '='].includes(key || '')
    ? 'in'
    : key === '-'
      ? 'out'
      : key === '0'
        ? 'reset'
        : null;
  return action ? { target: event.altKey ? 'ui' : 'document', action } : null;
}
export function clampSidebarWidth(value: number): number {
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, Math.round(value)));
}
export function clampBrowserWidth(value: number): number {
  return Math.max(MIN_BROWSER_WIDTH, Math.min(MAX_BROWSER_WIDTH, Math.round(value)));
}
export function clampPalettePercent(value: number): number {
  return Math.max(MIN_PALETTE_PERCENT, Math.min(MAX_PALETTE_PERCENT, Math.round(value)));
}
export function clampPaletteMaxWidth(value: number): number {
  return Math.max(MIN_PALETTE_MAX_WIDTH, Math.min(MAX_PALETTE_MAX_WIDTH, Math.round(value)));
}
export function clampPaletteMaxHeight(value: number): number {
  return Math.max(MIN_PALETTE_MAX_HEIGHT, Math.min(MAX_PALETTE_MAX_HEIGHT, Math.round(value)));
}

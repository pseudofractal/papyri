export const MIN_ZOOM = 50;
export const MAX_ZOOM = 200;
export const ZOOM_STEP = 10;
export const DEFAULT_SIDEBAR_WIDTH = 254;
export const MIN_SIDEBAR_WIDTH = 180;
export const MAX_SIDEBAR_WIDTH = 600;
export type ZoomTarget = 'document' | 'ui';
export type ZoomAction = 'in' | 'out' | 'reset';
export interface ZoomCommand {
  target: ZoomTarget;
  action: ZoomAction;
}
export type ViewCommand =
  | ZoomCommand
  | { target: 'document'; action: 'fit-width' }
  | { target: 'tabs'; action: 'next' | 'previous' };

export function viewShortcut(event: KeyboardEvent): ViewCommand | null {
  if (!(event.ctrlKey || event.metaKey)) return null;
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

export function clampZoom(value: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(value)));
}
export function changeZoom(value: number, action: ZoomAction): number {
  return action === 'reset' ? 100 : clampZoom(value + (action === 'in' ? ZOOM_STEP : -ZOOM_STEP));
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

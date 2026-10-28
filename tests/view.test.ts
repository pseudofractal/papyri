import { describe, expect, it } from 'vitest';
import { changeZoom, zoomShortcut, viewShortcut, clampSidebarWidth } from '../src/lib/view';
import { RenderCache } from '../src/render/cache';
import { defaults, loadPreferences } from '../src/lib/preferences';
import { vi } from 'vitest';
describe('view preferences', () => {
  it('separates document and UI shortcuts and clamps zoom', () => {
    expect(zoomShortcut({ key: '+', ctrlKey: true, metaKey: false, altKey: false })).toEqual({
      target: 'document',
      action: 'in',
    });
    expect(zoomShortcut({ key: '-', ctrlKey: true, metaKey: false, altKey: true })).toEqual({
      target: 'ui',
      action: 'out',
    });
    expect(zoomShortcut({ key: '0', ctrlKey: false, metaKey: true, altKey: false })).toEqual({
      target: 'document',
      action: 'reset',
    });
    expect(zoomShortcut({ key: '+', ctrlKey: false, metaKey: false, altKey: false })).toBeNull();
    expect(changeZoom(200, 'in')).toBe(200);
    expect(changeZoom(50, 'out')).toBe(50);
    expect(changeZoom(160, 'reset')).toBe(100);
    expect(clampSidebarWidth(1)).toBe(180);
    expect(clampSidebarWidth(900)).toBe(600);
  });
  it('migrates unchanged legacy math defaults and preserves custom pairs', () => {
    const legacy = {
      theme: 'latte',
      network: false,
      delimiters: defaults.delimiters.filter((pair) => pair.left !== '['),
    };
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(legacy) });
    expect(loadPreferences().delimiters.some((pair) => pair.left === '[')).toBe(true);
    legacy.delimiters = [{ left: '%%', right: '%%', display: true }];
    expect(loadPreferences().delimiters).toEqual(legacy.delimiters);
    expect(loadPreferences().documentZoom).toBe(100);
    vi.unstubAllGlobals();
  });
});
it('reuses markup with bounded LRU eviction without sharing trust or file handles', () => {
  const cache = new RenderCache();
  const result = { html: '<h1>Cached</h1>', headings: [], elapsed: 30 };
  for (let index = 0; index < 8; index++) cache.set(String(index), result);
  expect(cache.get('0')?.elapsed).toBe(0);
  cache.set('8', result);
  expect(cache.get('1')).toBeUndefined();
  expect(cache.get('0')?.html).toBe(result.html);
  cache.set('oversized', { ...result, html: 'x'.repeat(17 * 1024 * 1024) });
  expect(cache.get('oversized')).toBeUndefined();
});

it('reserves unshifted Ctrl = for width and supports bidirectional tab shortcuts', () => {
  const keyboard = (key: string, extra = {}) =>
    ({
      key,
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      ...extra,
    }) as KeyboardEvent;
  expect(viewShortcut(keyboard('='))).toEqual({ target: 'document', action: 'fit-width' });
  expect(viewShortcut(keyboard('=', { shiftKey: true }))).toEqual({
    target: 'document',
    action: 'in',
  });
  expect(viewShortcut(keyboard('=', { altKey: true }))).toEqual({ target: 'ui', action: 'in' });
  expect(viewShortcut(keyboard('Tab'))).toEqual({ target: 'tabs', action: 'next' });
  expect(viewShortcut(keyboard('Tab', { shiftKey: true }))).toEqual({
    target: 'tabs',
    action: 'previous',
  });
  expect(viewShortcut(keyboard('Tab', { ctrlKey: false }))).toBeNull();
  expect(viewShortcut(keyboard('Unidentified', { code: 'Tab', shiftKey: true }))).toEqual({
    target: 'tabs',
    action: 'previous',
  });
});

it('handles missing WebKit key values for physical zoom keys', () => {
  const keyboard = (code: string, shiftKey = false) =>
    ({ key: 'Unidentified', code, ctrlKey: true, shiftKey }) as KeyboardEvent;
  expect(viewShortcut(keyboard('Equal', true))).toEqual({ target: 'document', action: 'in' });
  expect(viewShortcut(keyboard('NumpadAdd'))).toEqual({ target: 'document', action: 'in' });
  expect(viewShortcut(keyboard('Minus'))).toEqual({ target: 'document', action: 'out' });
  expect(viewShortcut(keyboard('NumpadSubtract'))).toEqual({ target: 'document', action: 'out' });
  expect(viewShortcut(keyboard('Digit0'))).toEqual({ target: 'document', action: 'reset' });
  expect(viewShortcut(keyboard('Equal'))).toEqual({ target: 'document', action: 'fit-width' });
  expect(viewShortcut(keyboard('KeyA'))).toBeNull();
});

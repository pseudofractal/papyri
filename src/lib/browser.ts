import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invokeHost } from './native';
import { platform } from './platform';
import { native } from './sources';
import type { SiteId } from './sites';
import { DEFAULT_BROWSER_URL } from './view';

export { DEFAULT_BROWSER_URL };
export const BROWSER_EVENT = 'papyri://browser';

export interface BrowserState {
  site: SiteId;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  zoom: number;
  error: string | null;
}

export const emptyBrowserState: BrowserState = {
  site: 'chatgpt',
  url: DEFAULT_BROWSER_URL,
  title: '',
  loading: false,
  canGoBack: false,
  canGoForward: false,
  zoom: 1,
  error: null,
};

export function browserAvailable(): boolean {
  return native && platform.browserPanel;
}

/** Turn address-bar input into a safe HTTP(S) destination. */
export function browserTarget(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return DEFAULT_BROWSER_URL;
  if (/^https?:\/\//i.test(trimmed) || /^about:blank$/i.test(trimmed)) return trimmed;
  const localHost = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(trimmed);
  if (localHost) return `http://${trimmed}`;
  if (!/\s/.test(trimmed) && /^[^/\s:]+\.[^/\s:]+/.test(trimmed)) return `https://${trimmed}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(trimmed)}`;
}

export function browserShow(site: SiteId, url?: string): Promise<void> {
  return invokeHost('browser_show', { site, url });
}

export function browserSelect(site: SiteId): Promise<void> {
  return invokeHost('browser_select', { site });
}

export function browserNavigate(url: string): Promise<void> {
  return invokeHost('browser_navigate', { url });
}

export function browserBack(): Promise<void> {
  return invokeHost('browser_back');
}

export function browserForward(): Promise<void> {
  return invokeHost('browser_forward');
}

export function browserReload(): Promise<void> {
  return invokeHost('browser_reload');
}

export function browserStop(): Promise<void> {
  return invokeHost('browser_stop');
}

export function browserSetVisible(visible: boolean): Promise<void> {
  return invokeHost('browser_set_visible', { visible });
}

export function browserSetZoom(zoom: number): Promise<void> {
  return invokeHost('browser_set_zoom', { zoom });
}

export function browserQuote(site: SiteId, text: string): Promise<void> {
  return invokeHost('browser_quote', { site, text });
}

export function browserSearchWikipedia(text: string): Promise<void> {
  return invokeHost('browser_search_wikipedia', { text });
}

export function browserOpenWindow(url: string): Promise<void> {
  return invokeHost('browser_open_window', { url });
}

export function browserSetBounds(rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}): Promise<void> {
  return invokeHost('browser_set_bounds', {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  });
}

export async function listenBrowser(
  handler: (state: BrowserState) => void,
): Promise<UnlistenFn | null> {
  if (!native) return null;
  return listen<BrowserState>(BROWSER_EVENT, (event) => handler(event.payload));
}

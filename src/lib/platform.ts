/**
 * Capabilities reported by the native shell at startup.
 *
 * The native host injects `__PAPYRI_PLATFORM__` before the application bundle
 * runs, so the first render can hide unsupported controls without waiting for
 * an IPC round trip. The same contract is the place to add Android and other
 * future shells.
 */
export interface PlatformCapabilities {
  os: string;
  desktop: boolean;
  mobile: boolean;
  browserPanel: boolean;
  inputInjection: boolean;
  screenCapture: boolean;
  webviewCapture: boolean;
  windowEnumeration: boolean;
  windowCapture: boolean;
  controlSocket: boolean;
  managedTools: boolean;
  managedTexlive: boolean;
  latex: boolean;
  typst: boolean;
  clipboardImages: boolean;
}

const defaults: PlatformCapabilities = {
  os: 'web',
  desktop: false,
  mobile: false,
  browserPanel: false,
  inputInjection: false,
  screenCapture: false,
  webviewCapture: false,
  windowEnumeration: false,
  windowCapture: false,
  controlSocket: false,
  managedTools: false,
  managedTexlive: false,
  latex: false,
  typst: false,
  clipboardImages: false,
};

const nativeFallback: PlatformCapabilities = {
  ...defaults,
  os: 'linux',
  desktop: true,
  browserPanel: true,
  inputInjection: true,
  screenCapture: true,
  webviewCapture: true,
  windowEnumeration: true,
  windowCapture: true,
  controlSocket: true,
  managedTools: true,
  managedTexlive: true,
  latex: true,
  typst: true,
  clipboardImages: true,
};

const injected =
  typeof window === 'undefined'
    ? undefined
    : (window as unknown as { __PAPYRI_PLATFORM__?: Partial<PlatformCapabilities> })
        .__PAPYRI_PLATFORM__;
const nativeWindow = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const platform: PlatformCapabilities = {
  ...(injected ? defaults : nativeWindow ? nativeFallback : defaults),
  ...(injected ?? {}),
};

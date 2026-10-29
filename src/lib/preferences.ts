import {
  clampZoom,
  clampSidebarWidth,
  DEFAULT_SIDEBAR_WIDTH,
  MIN_PDF_ZOOM,
  MAX_PDF_ZOOM,
} from './view';
import type { Delimiter, Preferences } from './types';
export const defaults: Preferences = {
  theme: 'mocha',
  network: false,
  documentZoom: 100,
  pdfZoom: 100,
  fitWidth: false,
  uiZoom: 100,
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  delimiters: [
    { left: '$$', right: '$$', display: true },
    { left: '\\[', right: '\\]', display: true },
    { left: '\\(', right: '\\)', display: false },
    { left: '[', right: ']', display: true },
  ],
};
/** Reject ambiguous openings; longest opening delimiter is always matched first. */
export function validateDelimiters(value: unknown): Delimiter[] {
  if (!Array.isArray(value) || value.length > 20)
    throw new Error('Use an array of at most 20 delimiter pairs.');
  const openings = new Set<string>();
  for (const pair of value) {
    if (
      !pair ||
      typeof pair.left !== 'string' ||
      typeof pair.right !== 'string' ||
      typeof pair.display !== 'boolean' ||
      !pair.left.trim() ||
      !pair.right.trim() ||
      pair.left.length > 32 ||
      pair.right.length > 32 ||
      /[\r\n<>]/.test(pair.left + pair.right)
    )
      throw new Error(
        'Each pair needs nonempty left/right strings (up to 32 characters, no newlines or HTML) and a display boolean.',
      );
    if (openings.has(pair.left)) throw new Error(`Duplicate opening delimiter: ${pair.left}`);
    openings.add(pair.left);
  }
  return [...value].sort((a, b) => b.left.length - a.left.length);
}
export function loadPreferences(): Preferences {
  try {
    const stored = JSON.parse(localStorage.getItem('papyri.preferences') || 'null');
    if (!stored) return structuredClone(defaults);
    return {
      theme: stored.theme === 'latte' ? 'latte' : 'mocha',
      network: stored.network === true,
      fitWidth: stored.fitWidth === true,
      documentZoom: Number.isFinite(stored.documentZoom) ? clampZoom(stored.documentZoom) : 100,
      pdfZoom: Number.isFinite(stored.pdfZoom)
        ? clampZoom(stored.pdfZoom, MIN_PDF_ZOOM, MAX_PDF_ZOOM)
        : 100,
      uiZoom: Number.isFinite(stored.uiZoom) ? clampZoom(stored.uiZoom) : 100,
      sidebarWidth: Number.isFinite(stored.sidebarWidth)
        ? clampSidebarWidth(stored.sidebarWidth)
        : DEFAULT_SIDEBAR_WIDTH,
      delimiters: migrateDelimiters(stored),
    };
  } catch {
    return structuredClone(defaults);
  }
}

function migrateDelimiters(stored: { delimiters: unknown; version?: number }): Delimiter[] {
  const pairs = validateDelimiters(stored.delimiters);
  const legacyDefaults = defaults.delimiters.filter((pair) => pair.left !== '[');
  const unchangedDefaults =
    pairs.length === legacyDefaults.length &&
    pairs.every((pair) =>
      legacyDefaults.some((legacy) => JSON.stringify(legacy) === JSON.stringify(pair)),
    );
  return !stored.version && unchangedDefaults ? validateDelimiters(defaults.delimiters) : pairs;
}

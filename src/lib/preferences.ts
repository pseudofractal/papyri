import {
  clampZoom,
  clampSidebarWidth,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_PDF_ZOOM,
  MAX_SIDEBAR_WIDTH,
  MAX_ZOOM,
  MIN_PDF_ZOOM,
  MIN_SIDEBAR_WIDTH,
  MIN_ZOOM,
} from './view';
import type { Delimiter, Preferences } from './types';
export const defaults: Preferences = {
  typstPath: '',
  latexEngine: 'lualatex',
  latexPaths: { lualatex: '', pdflatex: '', xelatex: '' },
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
      typstPath: typeof stored.typstPath === 'string' ? stored.typstPath : '',
      latexEngine: ['lualatex', 'pdflatex', 'xelatex'].includes(stored.latexEngine)
        ? stored.latexEngine
        : 'lualatex',
      latexPaths: Object.fromEntries(
        Object.keys(defaults.latexPaths).map((engine) => [
          engine,
          typeof stored.latexPaths?.[engine] === 'string' ? stored.latexPaths[engine] : '',
        ]),
      ) as Preferences['latexPaths'],
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

function preferenceNumber(value: unknown, minimum: number, maximum: number, name: string) {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`\`${name}\` must be a finite number.`);
  return clampZoom(value, minimum, maximum);
}

/** Validate a partial settings update, returning a new preferences object. */
export function mergePreferences(
  current: Preferences,
  patch: Record<string, unknown>,
): Preferences {
  const next = structuredClone(current);
  for (const [key, value] of Object.entries(patch)) {
    switch (key) {
      case 'theme':
        if (value !== 'latte' && value !== 'mocha')
          throw new Error('`theme` must be "latte" or "mocha".');
        next.theme = value;
        break;
      case 'network':
        if (typeof value !== 'boolean') throw new Error('`network` must be a boolean.');
        next.network = value;
        break;
      case 'fitWidth':
        if (typeof value !== 'boolean') throw new Error('`fitWidth` must be a boolean.');
        next.fitWidth = value;
        break;
      case 'documentZoom':
        next.documentZoom = preferenceNumber(value, MIN_ZOOM, MAX_ZOOM, 'documentZoom');
        break;
      case 'pdfZoom':
        next.pdfZoom = preferenceNumber(value, MIN_PDF_ZOOM, MAX_PDF_ZOOM, 'pdfZoom');
        break;
      case 'uiZoom':
        next.uiZoom = preferenceNumber(value, MIN_ZOOM, MAX_ZOOM, 'uiZoom');
        break;
      case 'sidebarWidth':
        next.sidebarWidth = preferenceNumber(
          value,
          MIN_SIDEBAR_WIDTH,
          MAX_SIDEBAR_WIDTH,
          'sidebarWidth',
        );
        break;
      case 'typstPath':
        if (typeof value !== 'string') throw new Error('`typstPath` must be a string.');
        next.typstPath = value;
        break;
      case 'latexEngine':
        if (!['lualatex', 'pdflatex', 'xelatex'].includes(value as string))
          throw new Error('`latexEngine` must be lualatex, pdflatex, or xelatex.');
        next.latexEngine = value as Preferences['latexEngine'];
        break;
      case 'latexPaths': {
        if (!value || typeof value !== 'object' || Array.isArray(value))
          throw new Error('`latexPaths` must be an object.');
        const paths = value as Record<string, unknown>;
        for (const [engine, compiler] of Object.entries(paths)) {
          if (!(engine in next.latexPaths))
            throw new Error(`Unknown LaTeX engine in latexPaths: ${engine}`);
          if (typeof compiler !== 'string')
            throw new Error(`\`latexPaths.${engine}\` must be a string.`);
          next.latexPaths[engine as Preferences['latexEngine']] = compiler;
        }
        break;
      }
      case 'delimiters':
        next.delimiters = validateDelimiters(value);
        break;
      default:
        throw new Error(`Unknown preference: ${key}`);
    }
  }
  return next;
}

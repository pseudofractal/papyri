import {
  clampZoom,
  clampSidebarWidth,
  clampBrowserWidth,
  clampPalettePercent,
  clampPaletteMaxWidth,
  clampPaletteMaxHeight,
  DEFAULT_BROWSER_WIDTH,
  DEFAULT_BROWSER_URL,
  DEFAULT_PALETTE_WIDTH_PERCENT,
  DEFAULT_PALETTE_HEIGHT_PERCENT,
  DEFAULT_PALETTE_MAX_WIDTH,
  DEFAULT_PALETTE_MAX_HEIGHT,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_PDF_ZOOM,
  MAX_ZOOM,
  MIN_PDF_ZOOM,
  MIN_ZOOM,
} from './view';
import type { Delimiter, Preferences } from './types';
export const defaults: Preferences = {
  languageServerPaths: { markdown: '', typst: '', latex: '' },
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
  browserWidth: DEFAULT_BROWSER_WIDTH,
  browserUrl: DEFAULT_BROWSER_URL,
  paletteWidth: DEFAULT_PALETTE_WIDTH_PERCENT,
  paletteHeight: DEFAULT_PALETTE_HEIGHT_PERCENT,
  paletteMaxWidth: DEFAULT_PALETTE_MAX_WIDTH,
  paletteMaxHeight: DEFAULT_PALETTE_MAX_HEIGHT,
  uiFont: 'Inter, ui-sans-serif, system-ui, sans-serif',
  textFont: 'system-ui, sans-serif',
  codeFont: 'ui-monospace, monospace',
  mathFont: '',
  delimiters: [
    { left: '$$', right: '$$', display: true },
    { left: '\\[', right: '\\]', display: true },
    { left: '\\(', right: '\\)', display: false },
    { left: '[', right: ']', display: true },
  ],
};
const MAX_FONT_FAMILY_LENGTH = 256;
const INVALID_FONT_FAMILY_CHARACTERS = ';{}<>!';
const MAX_BROWSER_URL_LENGTH = 2048;

export function validBrowserUrl(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_BROWSER_URL_LENGTH &&
    (/^https?:\/\//i.test(value) || value === 'about:blank')
  );
}
function hasInvalidFontCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (code <= 0x1f || code === 0x7f || INVALID_FONT_FAMILY_CHARACTERS.includes(character))
      return true;
  }
  return false;
}

/**
 * Keep a CSS font-family list. The value is applied with `style.setProperty`,
 * so rejecting separators and markup keeps persisted preferences predictable.
 */
export function validateFontFamily(value: unknown, name: string, allowEmpty = false): string {
  if (typeof value !== 'string') throw new Error(`\`${name}\` must be a string.`);
  const family = value.trim().replace(/\s+/g, ' ');
  if (!family) {
    if (allowEmpty) return '';
    throw new Error(`\`${name}\` must not be empty.`);
  }
  if (family.length > MAX_FONT_FAMILY_LENGTH)
    throw new Error(`\`${name}\` must be at most ${MAX_FONT_FAMILY_LENGTH} characters.`);
  if (hasInvalidFontCharacters(family))
    throw new Error(`\`${name}\` contains unsupported characters.`);
  return family;
}
function loadFont(value: unknown, fallback: string, allowEmpty = false): string {
  try {
    return validateFontFamily(value, 'font', allowEmpty);
  } catch {
    return fallback;
  }
}
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
      languageServerPaths: Object.fromEntries(
        Object.keys(defaults.languageServerPaths).map((language) => [
          language,
          typeof stored.languageServerPaths?.[language] === 'string'
            ? stored.languageServerPaths[language]
            : '',
        ]),
      ) as Preferences['languageServerPaths'],
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
      browserWidth: Number.isFinite(stored.browserWidth)
        ? clampBrowserWidth(stored.browserWidth)
        : DEFAULT_BROWSER_WIDTH,
      browserUrl: validBrowserUrl(stored.browserUrl) ? stored.browserUrl : DEFAULT_BROWSER_URL,
      paletteWidth: Number.isFinite(stored.paletteWidth)
        ? clampPalettePercent(stored.paletteWidth)
        : DEFAULT_PALETTE_WIDTH_PERCENT,
      paletteHeight: Number.isFinite(stored.paletteHeight)
        ? clampPalettePercent(stored.paletteHeight)
        : DEFAULT_PALETTE_HEIGHT_PERCENT,
      paletteMaxWidth: Number.isFinite(stored.paletteMaxWidth)
        ? clampPaletteMaxWidth(stored.paletteMaxWidth)
        : DEFAULT_PALETTE_MAX_WIDTH,
      paletteMaxHeight: Number.isFinite(stored.paletteMaxHeight)
        ? clampPaletteMaxHeight(stored.paletteMaxHeight)
        : DEFAULT_PALETTE_MAX_HEIGHT,
      uiFont: loadFont(stored.uiFont, defaults.uiFont),
      textFont: loadFont(stored.textFont, defaults.textFont),
      codeFont: loadFont(stored.codeFont, defaults.codeFont),
      mathFont: loadFont(stored.mathFont, defaults.mathFont, true),
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

function finitePreference(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`\`${name}\` must be a finite number.`);
  return value;
}

function preferenceNumber(value: unknown, minimum: number, maximum: number, name: string) {
  return clampZoom(finitePreference(value, name), minimum, maximum);
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
        next.sidebarWidth = clampSidebarWidth(finitePreference(value, 'sidebarWidth'));
        break;
      case 'browserWidth':
        next.browserWidth = clampBrowserWidth(finitePreference(value, 'browserWidth'));
        break;
      case 'browserUrl':
        if (!validBrowserUrl(value)) throw new Error('`browserUrl` must be an HTTP(S) URL.');
        next.browserUrl = value;
        break;
      case 'paletteWidth':
        next.paletteWidth = clampPalettePercent(finitePreference(value, 'paletteWidth'));
        break;
      case 'paletteHeight':
        next.paletteHeight = clampPalettePercent(finitePreference(value, 'paletteHeight'));
        break;
      case 'paletteMaxWidth':
        next.paletteMaxWidth = clampPaletteMaxWidth(finitePreference(value, 'paletteMaxWidth'));
        break;
      case 'paletteMaxHeight':
        next.paletteMaxHeight = clampPaletteMaxHeight(finitePreference(value, 'paletteMaxHeight'));
        break;
      case 'uiFont':
        next.uiFont = validateFontFamily(value, 'uiFont');
        break;
      case 'textFont':
        next.textFont = validateFontFamily(value, 'textFont');
        break;
      case 'codeFont':
        next.codeFont = validateFontFamily(value, 'codeFont');
        break;
      case 'mathFont':
        next.mathFont = validateFontFamily(value, 'mathFont', true);
        break;
      case 'languageServerPaths': {
        if (!value || typeof value !== 'object' || Array.isArray(value))
          throw new Error('`languageServerPaths` must be an object.');
        for (const [language, path] of Object.entries(value)) {
          if (!Object.hasOwn(next.languageServerPaths, language) || typeof path !== 'string')
            throw new Error(`Invalid language server path for ${language}.`);
          next.languageServerPaths[language as keyof Preferences['languageServerPaths']] = path;
        }
        break;
      }
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
          if (!Object.hasOwn(next.latexPaths, engine))
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

/** Preserve saved values for preferences controlled by a configuration file. */
export function withoutConfiguredPreferences(
  next: Preferences,
  saved: Preferences,
  configured: Record<string, unknown>,
): Preferences {
  const restored = JSON.parse(JSON.stringify(next)) as Record<string, unknown>;
  const previous = saved as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(configured)) {
    if (
      (key === 'languageServerPaths' || key === 'latexPaths') &&
      value &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      const target = restored[key] as Record<string, unknown>;
      const original = previous[key] as Record<string, unknown>;
      for (const field of Object.keys(value)) target[field] = original[field];
    } else if (Object.hasOwn(previous, key)) {
      restored[key] = structuredClone(previous[key]);
    }
  }
  return restored as unknown as Preferences;
}

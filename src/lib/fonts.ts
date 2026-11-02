export interface FontPreset {
  label: string;
  value: string;
}

/** Installed fonts vary by system; each preset ends in a generic fallback. */
export const UI_FONT_PRESETS: FontPreset[] = [
  { label: 'Inter', value: 'Inter, ui-sans-serif, system-ui, sans-serif' },
  { label: 'System UI', value: 'system-ui, sans-serif' },
  { label: 'Noto Sans', value: "'Noto Sans', 'DejaVu Sans', sans-serif" },
  { label: 'Cantarell', value: 'Cantarell, system-ui, sans-serif' },
  { label: 'IBM Plex Sans', value: "'IBM Plex Sans', 'Noto Sans', sans-serif" },
  { label: 'Source Sans', value: "'Source Sans 3', 'Source Sans Pro', 'Noto Sans', sans-serif" },
  { label: 'Atkinson Hyperlegible', value: "'Atkinson Hyperlegible', sans-serif" },
  { label: 'Serif', value: "'Noto Serif', 'DejaVu Serif', Georgia, serif" },
  { label: 'Monospace', value: "ui-monospace, 'JetBrains Mono', 'Fira Code', monospace" },
];

export const TEXT_FONT_PRESETS: FontPreset[] = [
  { label: 'System UI', value: 'system-ui, sans-serif' },
  { label: 'Georgia', value: "Georgia, 'Noto Serif', 'DejaVu Serif', serif" },
  { label: 'Charter', value: "Charter, 'Bitstream Charter', Georgia, serif" },
  { label: 'Literata', value: "Literata, Georgia, 'Noto Serif', serif" },
  { label: 'Source Serif', value: "'Source Serif 4', 'Source Serif Pro', Georgia, serif" },
  { label: 'Noto Serif', value: "'Noto Serif', 'DejaVu Serif', serif" },
  { label: 'Atkinson Hyperlegible', value: "'Atkinson Hyperlegible', sans-serif" },
  { label: 'Inter', value: "Inter, 'Noto Sans', sans-serif" },
  { label: 'Monospace', value: "ui-monospace, 'JetBrains Mono', monospace" },
];

export const CODE_FONT_PRESETS: FontPreset[] = [
  { label: 'System monospace', value: 'ui-monospace, monospace' },
  { label: 'JetBrains Mono', value: "'JetBrains Mono', ui-monospace, monospace" },
  { label: 'Fira Code', value: "'Fira Code', ui-monospace, monospace" },
  { label: 'Cascadia Code', value: "'Cascadia Code', ui-monospace, monospace" },
  { label: 'Source Code Pro', value: "'Source Code Pro', ui-monospace, monospace" },
  { label: 'IBM Plex Mono', value: "'IBM Plex Mono', ui-monospace, monospace" },
  { label: 'Iosevka', value: 'Iosevka, ui-monospace, monospace' },
  { label: 'Noto Sans Mono', value: "'Noto Sans Mono', ui-monospace, monospace" },
  { label: 'DejaVu Sans Mono', value: "'DejaVu Sans Mono', ui-monospace, monospace" },
];

/** An empty value keeps KaTeX's bundled metric-compatible math fonts. */
export const MATH_FONT_PRESETS: FontPreset[] = [
  { label: 'KaTeX default', value: '' },
  { label: 'Latin Modern Math', value: "'Latin Modern Math', 'KaTeX_Main', serif" },
  { label: 'STIX Two Math', value: "'STIX Two Math', 'STIXGeneral', serif" },
  { label: 'TeX Gyre Pagella Math', value: "'TeX Gyre Pagella Math', 'Palatino Linotype', serif" },
  { label: 'TeX Gyre Termes Math', value: "'TeX Gyre Termes Math', 'Times New Roman', serif" },
  { label: 'DejaVu Math TeX Gyre', value: "'DejaVu Math TeX Gyre', 'DejaVu Serif', serif" },
  { label: 'Noto Sans Math', value: "'Noto Sans Math', 'Noto Sans', sans-serif" },
  { label: 'Cambria Math', value: "'Cambria Math', Cambria, serif" },
  { label: 'Libertinus Math', value: "'Libertinus Math', 'Libertinus Serif', serif" },
  { label: 'XITS Math', value: "XITS Math, 'STIX Two Math', serif" },
];

/** Catppuccin defaults; renderer-specific document settings take precedence. */
export function diagramPalette(theme: string) {
  return theme === 'latte'
    ? {
        background: '#eff1f5',
        text: '#4c4f69',
        muted: '#5c5f77',
        surface: '#ccd0da',
        border: '#9ca0b0',
        accent: '#8839ef',
        line: '#1e66f5',
        colors: [
          '#8839ef',
          '#1e66f5',
          '#40a02b',
          '#fe640b',
          '#ea76cb',
          '#179299',
          '#d20f39',
          '#df8e1d',
        ],
      }
    : {
        background: '#1e1e2e',
        text: '#cdd6f4',
        muted: '#a6adc8',
        surface: '#313244',
        border: '#6c7086',
        accent: '#cba6f7',
        line: '#89b4fa',
        colors: [
          '#cba6f7',
          '#89b4fa',
          '#a6e3a1',
          '#fab387',
          '#f5c2e7',
          '#94e2d5',
          '#f38ba8',
          '#f9e2af',
        ],
      };
}

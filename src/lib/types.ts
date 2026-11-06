export interface Entry {
  name: string;
  path: string;
  directory: boolean;
  symlink?: boolean;
}
export interface FileData {
  text: string;
  stamp: string;
  bytes?: Uint8Array;
  compilationError?: string;
  retryCompilation?: boolean;
}
export interface Source {
  label: string;
  root: string;
  live: boolean;
  list(path: string): Promise<Entry[]>;
  read(path: string): Promise<FileData>;
  readSource?(path: string): Promise<FileData>;
  stamp?(path: string): Promise<string>;
  asset(path: string): Promise<Uint8Array>;
}
export interface Delimiter {
  left: string;
  right: string;
  display: boolean;
}
export interface Preferences {
  typstPath: string;
  latexEngine: LatexEngine;
  latexPaths: Record<LatexEngine, string>;
  theme: 'mocha' | 'latte';
  network: boolean;
  documentZoom: number;
  pdfZoom: number;
  fitWidth: boolean;
  uiZoom: number;
  sidebarWidth: number;
  browserWidth: number;
  browserUrl: string;
  paletteWidth: number;
  paletteHeight: number;
  paletteMaxWidth: number;
  paletteMaxHeight: number;
  uiFont: string;
  textFont: string;
  codeFont: string;
  mathFont: string;
  delimiters: Delimiter[];
}
export type LatexEngine = 'lualatex' | 'pdflatex' | 'xelatex';
export interface Heading {
  id: string;
  text: string;
  level: number;
}
export interface Rendered {
  html: string;
  headings: Heading[];
  elapsed: number;
}

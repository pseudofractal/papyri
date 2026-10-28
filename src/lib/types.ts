export interface Entry {
  name: string;
  path: string;
  directory: boolean;
}
export interface FileData {
  text: string;
  stamp: string;
}
export interface Source {
  label: string;
  root: string;
  live: boolean;
  list(path: string): Promise<Entry[]>;
  read(path: string): Promise<FileData>;
  stamp?(path: string): Promise<string>;
  asset(path: string): Promise<Uint8Array>;
}
export interface Delimiter {
  left: string;
  right: string;
  display: boolean;
}
export interface Preferences {
  theme: 'mocha' | 'latte';
  network: boolean;
  documentZoom: number;
  fitWidth: boolean;
  uiZoom: number;
  sidebarWidth: number;
  delimiters: Delimiter[];
}
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

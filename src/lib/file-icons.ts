const icons = import.meta.glob<string>('../assets/catppuccin-icons/*.svg', {
  eager: true,
  query: '?raw',
  import: 'default',
});
const folderIcons: Record<string, string> = {
  docs: 'docs',
  doc: 'docs',
  documentation: 'docs',
  chapters: 'docs',
  images: 'images',
  image: 'images',
  img: 'images',
  figures: 'images',
  assets: 'assets',
  static: 'assets',
  public: 'assets',
  src: 'src',
  source: 'src',
  parts: 'src',
  test: 'tests',
  tests: 'tests',
  spec: 'tests',
  specs: 'tests',
  example: 'examples',
  examples: 'examples',
  config: 'config',
  configs: 'config',
  configuration: 'config',
  script: 'scripts',
  scripts: 'scripts',
  font: 'fonts',
  fonts: 'fonts',
};
const extensions: Record<string, string> = {
  md: 'markdown',
  markdown: 'markdown',
  mdown: 'markdown',
  mkd: 'markdown',
  typ: 'typst',
  tex: 'latex',
  ltx: 'latex',
  sty: 'latex',
  dtx: 'latex',
  pdf: 'pdf',
  bib: 'lib',
  bst: 'lib',
  svg: 'svg',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  avif: 'image',
  bmp: 'image',
  json: 'json',
  jsonc: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  csv: 'csv',
  tsv: 'csv',
  txt: 'text',
  html: 'html',
  htm: 'html',
  css: 'css',
  py: 'python',
  rs: 'rust',
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  sh: 'bash',
  bash: 'bash',
};
/** Choose a bundled Catppuccin icon for a file or folder name. */
export function fileIconName(name: string, directory: boolean, expanded = false): string {
  const lower = name.toLowerCase();
  if (directory) {
    const folder = Object.hasOwn(folderIcons, lower) ? folderIcons[lower] : undefined;
    return folder
      ? `folder_${folder}${expanded ? '_open' : ''}`
      : `_folder${expanded ? '_open' : ''}`;
  }
  if (/^readme(?:\.|$)/.test(lower)) return 'readme';
  if (/^(license|licence|copying)(?:\.|$)/.test(lower)) return 'license';
  if (lower === 'package.json') return 'package-json';
  if (lower === '.gitignore' || lower === '.gitattributes') return 'git';
  const extension = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : '';
  return Object.hasOwn(extensions, extension) ? extensions[extension] : '_file';
}
/** Return trusted, bundled SVG markup; unknown files use the generic icon. */
export function fileIcon(name: string, directory: boolean, expanded = false): string {
  const icon = fileIconName(name, directory, expanded);
  return (
    icons[`../assets/catppuccin-icons/${icon}.svg`] ?? icons['../assets/catppuccin-icons/_file.svg']
  );
}

import type { Entry } from './types';
export const isMarkdown = (path: string) => /\.(md|markdown|mdown|mkd)$/i.test(path);
export const isPdf = (path: string) => /\.pdf$/i.test(path);
export const isTypst = (path: string) => /\.typ$/i.test(path);
export const isLatex = (path: string) => /\.tex$/i.test(path);
export const isDocument = (path: string) =>
  isMarkdown(path) || isPdf(path) || isTypst(path) || isLatex(path);
export function normalize(path: string): string {
  const segments: string[] = [];
  for (const segment of path.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  }
  return '/' + segments.join('/');
}
export const dirname = (path: string) => path.slice(0, path.lastIndexOf('/')) || '/';
export const basename = (path: string) => path.split('/').pop() || '/';
function homeDirectory(): string {
  return typeof window === 'undefined'
    ? ''
    : ((window as unknown as { __PAPYRI_HOME__?: string }).__PAPYRI_HOME__ ?? '').replace(
        /\/+$/,
        '',
      );
}
/** Abbreviate the current user's home directory for display. */
export function displayPath(path: string): string {
  const home = homeDirectory();
  return home && (path === home || path.startsWith(`${home}/`))
    ? `~${path.slice(home.length)}`
    : path;
}
/** Expand a home-relative path entered in the directory field. */
export function expandHomePath(path: string): string {
  const home = homeDirectory();
  return home && (path === '~' || path.startsWith('~/')) ? `${home}${path.slice(1)}` : path;
}
/** Abbreviate home paths embedded in diagnostics without changing similar prefixes. */
export function displayPathMessage(message: string): string {
  const home = homeDirectory();
  if (!home) return message;
  const escaped = home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return message.replace(new RegExp(`${escaped}(?=/|$|[:\\s])`, 'g'), '~');
}
/** Return a path relative to the displayed project root when the item is inside it. */
export function relativeProjectPath(root: string, path: string): string {
  root = normalize(root);
  path = normalize(path);
  if (path === root) return '.';
  const prefix = root === '/' ? '/' : `${root}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}
export type Target =
  | { kind: 'anchor'; anchor: string }
  | { kind: 'external'; url: string }
  | { kind: 'local'; path: string; anchor: string }
  | { kind: 'blocked' };
/** Resolve POSIX document links, never treating Android content URIs as paths. */
export function resolveLink(document: string, href: string): Target {
  if (href.startsWith('#')) {
    try {
      return { kind: 'anchor', anchor: decodeURIComponent(href.slice(1)) };
    } catch {
      return { kind: 'blocked' };
    }
  }
  if (/^(https?:|mailto:)/i.test(href)) return { kind: 'external', url: href };
  if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('//') || href.includes('\\'))
    return { kind: 'blocked' };
  const [rawPath, rawAnchor = ''] = href.split('#', 2);
  try {
    const path = decodeURIComponent(rawPath.split('?')[0]);
    if (path.includes('\0') || path.includes('\\')) return { kind: 'blocked' };
    return {
      kind: 'local',
      path: normalize(path.startsWith('/') ? path : `${dirname(document)}/${path}`),
      anchor: decodeURIComponent(rawAnchor),
    };
  } catch {
    return { kind: 'blocked' };
  }
}
export function sortEntries(entries: Entry[]): Entry[] {
  return entries
    .filter((e) => e.name !== '.' && e.name !== '..')
    .sort(
      (a, b) =>
        Number(b.directory) - Number(a.directory) ||
        a.name.localeCompare(b.name, undefined, { numeric: true }),
    );
}

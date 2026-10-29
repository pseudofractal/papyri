import type { Entry } from './types';
export const isMarkdown = (path: string) => /\.(md|markdown|mdown|mkd)$/i.test(path);
export const isPdf = (path: string) => /\.pdf$/i.test(path);
export const isTypst = (path: string) => /\.typ$/i.test(path);
export const isDocument = (path: string) => isMarkdown(path) || isPdf(path) || isTypst(path);
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

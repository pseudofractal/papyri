import { isAbsolutePath, isRootPath, normalize } from './paths';

export interface RecentFolder {
  path: string;
  lastFile?: string;
}

const STORAGE_KEY = 'papyri.recentFolders';
const STORAGE_VERSION = 1;
const MAX_PATH_LENGTH = 4096;
export const MAX_RECENT_FOLDERS = 10;

function validPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    isAbsolutePath(value) &&
    value.length <= MAX_PATH_LENGTH &&
    !value.includes('\0')
  );
}

function validFolder(value: unknown): value is RecentFolder {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const folder = value as { path?: unknown; lastFile?: unknown };
  if (!validPath(folder.path) || isRootPath(normalize(folder.path))) return false;
  if (
    folder.lastFile !== undefined &&
    folder.lastFile !== null &&
    (!validPath(folder.lastFile) || isRootPath(normalize(folder.lastFile)))
  )
    return false;
  return true;
}

/** Parse a persisted recent-folder list, dropping malformed and duplicate entries. */
export function parseRecentFolders(raw: string | null): RecentFolder[] {
  if (!raw) return [];
  try {
    const stored = JSON.parse(raw) as { version?: unknown; folders?: unknown };
    if (stored.version !== STORAGE_VERSION || !Array.isArray(stored.folders)) return [];
    const seen = new Set<string>();
    const folders: RecentFolder[] = [];
    for (const candidate of stored.folders) {
      if (!validFolder(candidate)) continue;
      const path = normalize(candidate.path);
      if (seen.has(path)) continue;
      seen.add(path);
      const folder: RecentFolder = { path };
      if (candidate.lastFile) folder.lastFile = normalize(candidate.lastFile);
      folders.push(folder);
      if (folders.length >= MAX_RECENT_FOLDERS) break;
    }
    return folders;
  } catch {
    return [];
  }
}

function nativeHost(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function loadRecentFolders(): RecentFolder[] {
  if (!nativeHost() || typeof localStorage === 'undefined') return [];
  try {
    return parseRecentFolders(localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

export function persistRecentFolders(folders: RecentFolder[]): void {
  if (!nativeHost() || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: STORAGE_VERSION, folders: folders.slice(0, MAX_RECENT_FOLDERS) }),
    );
  } catch {
    // Recent folders are a convenience; storage failures must not block opening files.
  }
}

/**
 * Pick the newest recent project when startup fell back to the home directory.
 * Explicit launch targets and working directories inside a project keep priority.
 */
export function startupRecentProject(
  initial: { path: string; explicit: boolean },
  folders: RecentFolder[],
  home: string,
): RecentFolder | undefined {
  if (initial.explicit) return undefined;
  const normalizedHome = home ? normalize(home) : '';
  if (initial.path !== normalizedHome && initial.path !== '/') return undefined;
  return folders[0];
}

/**
 * Move a folder to the front of the recent list. `undefined` keeps a known last
 * file; `null` explicitly clears it.
 */
export function rememberRecentFolder(
  folders: RecentFolder[],
  path: string,
  lastFile?: string | null,
): RecentFolder[] {
  if (!validPath(path)) return folders;
  const normalized = normalize(path);
  if (normalized === '/') return folders;
  const existing = folders.find((folder) => folder.path === normalized);
  const nextLastFile =
    lastFile === null
      ? undefined
      : lastFile && validPath(lastFile) && normalize(lastFile) !== '/'
        ? normalize(lastFile)
        : existing?.lastFile;
  const next: RecentFolder = { path: normalized };
  if (nextLastFile) next.lastFile = nextLastFile;
  return [next, ...folders.filter((folder) => folder.path !== normalized)].slice(
    0,
    MAX_RECENT_FOLDERS,
  );
}

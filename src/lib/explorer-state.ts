import { isAbsolutePath, normalize } from './paths';

export interface ExplorerState {
  workingDirectory: string;
  expanded: string[];
}
const STORAGE_PREFIX = 'papyri.explorer.v1:';
const MAX_EXPANDED = 500;
function inside(root: string, value: unknown): value is string {
  return (
    typeof value === 'string' &&
    isAbsolutePath(value) &&
    value.length <= 4096 &&
    !value.includes('\0') &&
    normalize(value) === value &&
    (root === '/' || value === root || value.startsWith(root + '/'))
  );
}
/** Restore navigation for one displayed project root, ignoring malformed stored paths. */
export function readExplorerState(root: string, storage: Pick<Storage, 'getItem'>): ExplorerState {
  const fallback = { workingDirectory: root, expanded: [] };
  try {
    const value = JSON.parse(
      storage.getItem(STORAGE_PREFIX + root) ?? 'null',
    ) as Partial<ExplorerState> | null;
    if (!value || !Array.isArray(value.expanded)) return fallback;
    return {
      workingDirectory: inside(root, value.workingDirectory) ? value.workingDirectory : root,
      expanded: [...new Set(value.expanded.filter((path) => inside(root, path)))].slice(
        0,
        MAX_EXPANDED,
      ),
    };
  } catch {
    return fallback;
  }
}
/** Persist the selected working folder and expanded directories for one project root. */
export function writeExplorerState(
  root: string,
  state: ExplorerState,
  storage: Pick<Storage, 'setItem'>,
): void {
  storage.setItem(
    STORAGE_PREFIX + root,
    JSON.stringify({
      workingDirectory: state.workingDirectory,
      expanded: state.expanded.slice(0, MAX_EXPANDED),
    }),
  );
}

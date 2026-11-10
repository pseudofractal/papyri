import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  loadRecentFolders,
  MAX_RECENT_FOLDERS,
  parseRecentFolders,
  persistRecentFolders,
  rememberRecentFolder,
  startupRecentProject,
  type RecentFolder,
} from '../src/lib/recent';

afterEach(() => vi.unstubAllGlobals());

describe('recent folders', () => {
  it('parses valid entries, deduplicates paths, and drops unsafe values', () => {
    const raw = JSON.stringify({
      version: 1,
      folders: [
        { path: '/notes', lastFile: '/notes/readme.md' },
        { path: '/notes', lastFile: '/notes/other.md' },
        { path: '/', lastFile: '/root.md' },
        { path: 'relative', lastFile: '/notes/readme.md' },
        { path: '/projects/../notes', lastFile: 'relative.md' },
        { path: '/work', lastFile: null },
      ],
    });
    expect(parseRecentFolders(raw)).toEqual([
      { path: '/notes', lastFile: '/notes/readme.md' },
      { path: '/work' },
    ]);
    expect(parseRecentFolders('{bad json')).toEqual([]);
    expect(parseRecentFolders(JSON.stringify({ version: 2, folders: [] }))).toEqual([]);
  });

  it('keeps recent folders newest-first and preserves or clears the last file', () => {
    let folders = rememberRecentFolder([], '/notes', '/notes/readme.md');
    expect(folders).toEqual([{ path: '/notes', lastFile: '/notes/readme.md' }]);

    folders = rememberRecentFolder(folders, '/work');
    expect(folders.map((folder) => folder.path)).toEqual(['/work', '/notes']);

    folders = rememberRecentFolder(folders, '/notes');
    expect(folders).toEqual([{ path: '/notes', lastFile: '/notes/readme.md' }, { path: '/work' }]);

    folders = rememberRecentFolder(folders, '/notes', '/notes/changed.md');
    expect(folders[0]).toEqual({ path: '/notes', lastFile: '/notes/changed.md' });

    folders = rememberRecentFolder(folders, '/notes', null);
    expect(folders[0]).toEqual({ path: '/notes' });
  });

  it('ignores the root and invalid paths and bounds the list', () => {
    expect(rememberRecentFolder([], '/')).toEqual([]);
    expect(rememberRecentFolder([], 'relative')).toEqual([]);
    let folders: RecentFolder[] = [];
    for (let index = 0; index < MAX_RECENT_FOLDERS + 5; index++)
      folders = rememberRecentFolder(folders, `/project-${index}`);
    expect(folders).toHaveLength(MAX_RECENT_FOLDERS);
    expect(folders[0].path).toBe(`/project-${MAX_RECENT_FOLDERS + 4}`);
  });

  it('reopens a recent project only when startup falls back to home', () => {
    const recent = [
      { path: '/work/notes', lastFile: '/work/notes/readme.md' },
      { path: '/work/other' },
    ];
    expect(
      startupRecentProject(
        { path: '/home/pseudofractal', explicit: false },
        recent,
        '/home/pseudofractal',
      ),
    ).toEqual(recent[0]);
    expect(
      startupRecentProject(
        { path: '/home/pseudofractal', explicit: true },
        recent,
        '/home/pseudofractal',
      ),
    ).toBeUndefined();
    expect(
      startupRecentProject(
        { path: '/work/current', explicit: false },
        recent,
        '/home/pseudofractal',
      ),
    ).toBeUndefined();
    expect(
      startupRecentProject({ path: '/', explicit: false }, recent, '/home/pseudofractal'),
    ).toEqual(recent[0]);
  });

  it('persists only in the native host and ignores storage failures', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    persistRecentFolders([{ path: '/notes', lastFile: '/notes/readme.md' }]);
    expect(loadRecentFolders()).toEqual([{ path: '/notes', lastFile: '/notes/readme.md' }]);

    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('unavailable');
      },
      setItem: () => {
        throw new Error('unavailable');
      },
    });
    expect(loadRecentFolders()).toEqual([]);
    expect(() => persistRecentFolders([])).not.toThrow();

    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', {
      getItem: () => JSON.stringify({ version: 1, folders: [{ path: '/notes' }] }),
      setItem: () => {},
    });
    expect(loadRecentFolders()).toEqual([]);
  });
});

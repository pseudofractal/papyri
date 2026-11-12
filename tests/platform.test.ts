import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  basename,
  dirname,
  isAbsolutePath,
  isRootPath,
  normalize,
  resolveLink,
} from '../src/lib/paths';
import { parseRecentFolders } from '../src/lib/recent';
import { readExplorerState } from '../src/lib/explorer-state';
import { fileUri } from '../src/lib/editor-lsp';

afterEach(() => vi.unstubAllGlobals());

describe('platform paths', () => {
  it('preserves Windows drive letters while normalizing separators', () => {
    expect(normalize('C:/Users/me/../me2')).toBe('C:/Users/me2');
    expect(normalize('D:\\papers\\notes.md')).toBe('D:/papers/notes.md');
    expect(dirname('C:/papers/notes.md')).toBe('C:/papers');
    expect(basename('C:/papers/notes.md')).toBe('notes.md');
    expect(isAbsolutePath('C:/papers')).toBe(true);
    expect(isAbsolutePath('papers')).toBe(false);
    expect(isRootPath('C:/')).toBe(true);
    expect(isRootPath('C:/papers')).toBe(false);
    expect(normalize('//beta.md')).toBe('/beta.md');
    expect(normalize('//server/share/folder')).toBe('//server/share/folder');
  });

  it('resolves relative document links on Windows without dropping the drive', () => {
    expect(resolveLink('C:/papers/main.md', 'images/plot.png')).toEqual({
      kind: 'local',
      path: 'C:/papers/images/plot.png',
      anchor: '',
    });
    expect(fileUri('C:/papers/main.md')).toBe('file:///C%3A/papers/main.md');
  });

  it('restores Windows recent folders and explorer state', () => {
    const recent = parseRecentFolders(
      JSON.stringify({
        version: 1,
        folders: [{ path: 'C:/papers', lastFile: 'C:/papers/main.md' }],
      }),
    );
    expect(recent).toEqual([{ path: 'C:/papers', lastFile: 'C:/papers/main.md' }]);
    const state = readExplorerState('C:/papers', {
      getItem: () =>
        JSON.stringify({
          workingDirectory: 'C:/papers/sections',
          expanded: ['C:/papers/sections'],
        }),
    });
    expect(state.workingDirectory).toBe('C:/papers/sections');
    expect(state.expanded).toEqual(['C:/papers/sections']);
  });
});

describe('platform capabilities', () => {
  it('uses injected capabilities before native fallbacks', async () => {
    vi.resetModules();
    vi.stubGlobal('window', {
      __TAURI_INTERNALS__: {},
      __PAPYRI_PLATFORM__: {
        os: 'windows',
        desktop: true,
        mobile: false,
        browserPanel: false,
        managedTools: true,
      },
    });
    const { platform } = await import('../src/lib/platform');
    expect(platform.os).toBe('windows');
    expect(platform.browserPanel).toBe(false);
    expect(platform.managedTools).toBe(true);
    expect(platform.managedTexlive).toBe(false);
  });

  it('uses the conservative web defaults without a native host', async () => {
    vi.resetModules();
    vi.stubGlobal('window', {});
    const { platform } = await import('../src/lib/platform');
    expect(platform.desktop).toBe(false);
    expect(platform.browserPanel).toBe(false);
    expect(platform.latex).toBe(false);
  });
});

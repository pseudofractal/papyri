import { describe, expect, it } from 'vitest';
import { readExplorerState, writeExplorerState } from '../src/lib/explorer-state';

describe('explorer navigation persistence', () => {
  it('restores working and expanded folders separately for each root', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    writeExplorerState(
      '/project',
      {
        workingDirectory: '/project/chapters',
        expanded: ['/project/chapters', '/project/figures'],
      },
      storage,
    );
    expect(readExplorerState('/project', storage)).toEqual({
      workingDirectory: '/project/chapters',
      expanded: ['/project/chapters', '/project/figures'],
    });
    expect(readExplorerState('/other', storage)).toEqual({
      workingDirectory: '/other',
      expanded: [],
    });
  });
  it('rejects malformed and outside-root paths', () => {
    const storage = {
      getItem: () =>
        JSON.stringify({
          workingDirectory: '/project-other',
          expanded: ['/project/a', '/project/../bad', '/else', '/project/a'],
        }),
    };
    expect(readExplorerState('/project', storage)).toEqual({
      workingDirectory: '/project',
      expanded: ['/project/a'],
    });
    expect(readExplorerState('/project', { getItem: () => '{' })).toEqual({
      workingDirectory: '/project',
      expanded: [],
    });
  });
});

import { describe, expect, it } from 'vitest';
import { listDirectory } from '../src/lib/directories';
import { Workspace } from '../src/lib/workspace.svelte';
import type { Entry, FileData, Source } from '../src/lib/types';
function memorySource(): { source: Source; files: Map<string, FileData> } {
  const files = new Map([
    ['/a.md', { text: '# First', stamp: '1' }],
    ['/b.md', { text: '# Second', stamp: '1' }],
  ]);
  const get = (path: string) => {
    const file = files.get(path);
    if (!file) throw new Error('Deleted');
    return file;
  };
  return {
    files,
    source: {
      label: 'test',
      root: '/',
      live: true,
      async list() {
        return [...files.keys()].map((path) => ({ path, name: path.slice(1), directory: false }));
      },
      async stamp(path) {
        return get(path).stamp;
      },
      async read(path) {
        return { ...get(path) };
      },
      async asset() {
        return new Uint8Array();
      },
    },
  };
}
describe('workspace navigation and live updates', () => {
  it('refreshes changed documents and retains scroll and stale preview on deletion', async () => {
    const { source, files } = memorySource();
    const workspace = new Workspace();
    await workspace.changeSource(source);
    await workspace.open('/a.md');
    workspace.setScroll('/a.md', 300);
    files.set('/a.md', { text: '# Changed', stamp: '2' });
    await workspace.refresh();
    expect(workspace.tabs[0]).toMatchObject({ text: '# Changed', revision: 1, scroll: 300 });
    await workspace.refresh();
    expect(workspace.tabs[0].revision).toBe(1);
    files.delete('/a.md');
    await workspace.refresh();
    expect(workspace.tabs[0].error).toContain('File unavailable');
    expect(workspace.tabs[0].text).toBe('# Changed');
  });
  it('keeps the latest user navigation when an earlier read completes late', async () => {
    const { source } = memorySource();
    const workspace = new Workspace();
    await workspace.changeSource(source);
    await workspace.open('/a.md');
    let complete!: (file: FileData) => void;
    source.read = () => new Promise((resolve) => (complete = resolve));
    const pending = workspace.open('/b.md');
    await workspace.open('/a.md');
    complete({ text: '# Late', stamp: '1' });
    await pending;
    expect(workspace.active).toBe('/a.md');
    expect(workspace.tabs).toHaveLength(1);
    expect(workspace.busy).toBe(false);
  });
  it('invalidates pending reads when switching sources and closes split tabs coherently', async () => {
    const { source } = memorySource();
    const workspace = new Workspace();
    await workspace.changeSource(source);
    await workspace.open('/a.md');
    await workspace.open('/b.md');
    workspace.secondary = '/a.md';
    workspace.close('/a.md');
    expect(workspace.secondary).toBe('');
    expect(workspace.active).toBe('/b.md');
    let complete!: (file: FileData) => void;
    source.read = () => new Promise((resolve) => (complete = resolve));
    const pending = workspace.open('/late.md');
    await workspace.changeSource(memorySource().source);
    complete({ text: '# Late', stamp: '1' });
    await pending;
    expect(workspace.tabs).toHaveLength(0);
    expect(workspace.busy).toBe(false);
  });
});

it('ignores late folder selection results after a newer source or document is selected', async () => {
  const { source: slowSource } = memorySource();
  const { source: newSource } = memorySource();
  let complete!: (entries: Entry[]) => void;
  slowSource.list = () => new Promise((resolve) => (complete = resolve));
  const workspace = new Workspace();
  const oldSelection = workspace.selectSource(slowSource);
  await workspace.selectSource(newSource);
  complete([{ name: 'b.md', path: '/b.md', directory: false }]);
  await oldSelection;
  expect(workspace.source).toBe(newSource);
  expect(workspace.active).toBe('/a.md');

  const pendingSelection = workspace.selectSource(slowSource);
  await workspace.open('/a.md');
  complete([{ name: 'b.md', path: '/b.md', directory: false }]);
  await pendingSelection;
  expect(workspace.active).toBe('/a.md');
  expect(workspace.tabs).toHaveLength(1);
});

it('ignores errors from obsolete source selections', async () => {
  const { source } = memorySource();
  let fail!: (error: Error) => void;
  source.list = () => new Promise((_, reject) => (fail = reject));
  const workspace = new Workspace();
  const selection = workspace.selectSource(source);
  await workspace.selectSource(memorySource().source);
  fail(new Error('Old folder became inaccessible'));
  await selection;
  expect(workspace.error).toBe('');
  expect(workspace.active).toBe('/a.md');
});

it('uses one tab identity for equivalent paths and clears heading targets on navigation', async () => {
  const workspace = new Workspace();
  await workspace.changeSource(memorySource().source);
  await workspace.open('/notes/.././a.md', 'section');
  expect(workspace.active).toBe('/a.md');
  expect(workspace.anchor?.id).toBe('section');
  await workspace.open('/a.md');
  expect(workspace.tabs).toHaveLength(1);
  expect(workspace.anchor).toBeNull();
  workspace.navigateAnchor('section');
  const firstRequest = workspace.anchor!.request;
  workspace.navigateAnchor('section');
  expect(workspace.anchor!.request).toBeGreaterThan(firstRequest);
  workspace.consumeAnchor(firstRequest);
  expect(workspace.anchor).not.toBeNull();
  workspace.consumeAnchor(workspace.anchor!.request);
  expect(workspace.anchor).toBeNull();
  workspace.navigateAnchor('section');
  workspace.close('/a.md');
  expect(workspace.anchor).toBeNull();
});

it('coalesces slow directory polling and retries after a completed listing', async () => {
  const { source } = memorySource();
  let reads = 0;
  let complete!: (value: []) => void;
  source.list = () => {
    reads++;
    return new Promise((resolve) => (complete = resolve));
  };
  const first = listDirectory(source, '/');
  const second = listDirectory(source, '/');
  expect(first).toBe(second);
  expect(reads).toBe(1);
  complete([]);
  await first;
  const next = listDirectory(source, '/');
  expect(reads).toBe(2);
  complete([]);
  await next;
});

it('retains an unavailable split document with its own error state', async () => {
  const { source, files } = memorySource();
  const workspace = new Workspace();
  await workspace.changeSource(source);
  await workspace.open('/a.md');
  await workspace.open('/b.md');
  workspace.secondary = '/a.md';
  files.delete('/a.md');
  await workspace.refresh();
  expect(workspace.secondaryTab?.error).toContain('File unavailable');
  expect(workspace.secondaryTab?.text).toBe('# First');
  expect(workspace.activeTab?.error).toBe('');
});

it('opens PDF and Typst tabs, refreshes binary previews, and retains them on compilation errors', async () => {
  const { source, files } = memorySource();
  const first = Uint8Array.of(1, 2, 3);
  files.set('/paper.pdf', { text: '', bytes: first, stamp: '1' });
  files.set('/paper.typ', { text: '', bytes: first, stamp: '1' });
  const workspace = new Workspace();
  workspace.changeSource(source);
  await workspace.open('/paper.pdf', 'page=2');
  expect(workspace.activeTab?.bytes).toEqual(first);
  expect(workspace.anchor?.id).toBe('page=2');
  await workspace.open('/paper.typ');
  workspace.setScroll('/paper.typ', 500);
  files.set('/paper.typ', { text: '', bytes: Uint8Array.of(4, 5), stamp: '2' });
  await workspace.refresh();
  expect(workspace.activeTab).toMatchObject({
    bytes: Uint8Array.of(4, 5),
    scroll: 500,
    revision: 1,
  });
  files.delete('/paper.typ');
  await workspace.refresh();
  expect(workspace.activeTab?.error).toContain('Last preview retained');
  expect(workspace.activeTab?.bytes).toEqual(Uint8Array.of(4, 5));
  await workspace.open('/unsupported.txt');
  expect(workspace.error).toContain('Markdown, PDF, or Typst');
  expect(workspace.active).toBe('/paper.typ');
});

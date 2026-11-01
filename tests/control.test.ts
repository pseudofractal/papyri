import { describe, expect, it, vi } from 'vitest';
import { createControlExecutor, type ControlActions, type ControlState } from '../src/lib/control';

function sampleState(): ControlState {
  return {
    protocol: 1,
    active: '/notes.md',
    secondary: null,
    tabs: [
      {
        path: '/notes.md',
        kind: 'markdown',
        active: true,
        secondary: false,
        scroll: 12,
        error: null,
      },
    ],
    pdf: null,
    view: {
      sidebar: true,
      outline: false,
      settings: false,
      palette: false,
      search: false,
      split: false,
      decorationless: false,
      query: '',
    },
    preferences: {
      typstPath: '',
      latexEngine: 'lualatex',
      latexPaths: { lualatex: '', pdflatex: '', xelatex: '' },
      theme: 'mocha',
      network: false,
      documentZoom: 100,
      pdfZoom: 100,
      fitWidth: false,
      uiZoom: 100,
      sidebarWidth: 254,
      delimiters: [],
    },
    directory: '/',
    source: { label: 'Test', root: '/', live: true },
    busy: false,
    error: null,
  };
}

function sampleActions(overrides: Partial<ControlActions> = {}): ControlActions {
  const state = sampleState();
  return {
    state: () => state,
    headings: () => ({ path: '/notes.md', headings: [] }),
    commands: () => ({ commands: [] }),
    open: vi.fn(async () => state),
    close: vi.fn(async () => state),
    focus: vi.fn(async () => state),
    tab: vi.fn(async () => state),
    activate: vi.fn(async () => state),
    closeTab: vi.fn(async () => state),
    scroll: vi.fn(async () => ({})),
    zoom: vi.fn(async () => state),
    fitWidth: vi.fn(async () => state),
    decorationless: vi.fn(async () => state),
    theme: vi.fn(async () => state),
    panel: vi.fn(async () => state),
    search: vi.fn(async () => state),
    heading: vi.fn(async () => state),
    page: vi.fn(async () => state),
    command: vi.fn(async () => state),
    preferences: vi.fn(async () => state),
    refresh: vi.fn(async () => state),
    ...overrides,
  };
}

describe('control executor', () => {
  it('returns state and headings', async () => {
    const actions = sampleActions();
    const execute = createControlExecutor(actions);
    expect(await execute('state', {})).toEqual(sampleState());
    expect(await execute('headings', {})).toEqual({ path: '/notes.md', headings: [] });
  });

  it('validates and forwards open options', async () => {
    const actions = sampleActions();
    const execute = createControlExecutor(actions);
    await execute('open', {
      path: '/notes.md',
      pane: 'secondary',
      anchor: 'intro',
      directory: false,
    });
    expect(actions.open).toHaveBeenCalledWith('/notes.md', {
      pane: 'secondary',
      anchor: 'intro',
      directory: false,
    });
    await expect(execute('open', {})).rejects.toThrow('`path`');
    await expect(execute('open', { path: '/x.md', pane: 'side' })).rejects.toThrow('`pane`');
  });

  it('dispatches tab and scroll methods', async () => {
    const actions = sampleActions();
    const execute = createControlExecutor(actions);
    await execute('tab.next', {});
    await execute('tab.previous', {});
    expect(actions.tab).toHaveBeenNthCalledWith(1, 'next');
    expect(actions.tab).toHaveBeenNthCalledWith(2, 'previous');

    await execute('scroll.to', { y: 300 });
    await execute('scroll.by', { dy: -40, pane: 'secondary' });
    await execute('scroll.top', {});
    await execute('scroll.bottom', {});
    expect(actions.scroll).toHaveBeenNthCalledWith(1, 'main', { y: 300 });
    expect(actions.scroll).toHaveBeenNthCalledWith(2, 'secondary', { dy: -40 });
    expect(actions.scroll).toHaveBeenNthCalledWith(3, 'main', { top: true });
    expect(actions.scroll).toHaveBeenNthCalledWith(4, 'main', { bottom: true });
    await expect(execute('scroll.to', { y: '3' })).rejects.toThrow('`y`');
  });

  it('requires exactly one zoom action or value', async () => {
    const actions = sampleActions();
    const execute = createControlExecutor(actions);
    await execute('zoom', { action: 'in', target: 'ui' });
    await execute('zoom', { value: 120 });
    expect(actions.zoom).toHaveBeenNthCalledWith(1, 'ui', 'in', undefined);
    expect(actions.zoom).toHaveBeenNthCalledWith(2, 'document', undefined, 120);
    await expect(execute('zoom', {})).rejects.toThrow('action');
    await expect(execute('zoom', { action: 'in', value: 120 })).rejects.toThrow('either');
  });

  it('toggles fit-to-width, decoration-less mode, and themes', async () => {
    const actions = sampleActions();
    const execute = createControlExecutor(actions);
    await execute('fit-width', {});
    await execute('fit-width', { enabled: false });
    expect(actions.fitWidth).toHaveBeenNthCalledWith(1, undefined);
    expect(actions.fitWidth).toHaveBeenNthCalledWith(2, false);
    await execute('decorationless', {});
    await execute('decorationless', { enabled: true });
    expect(actions.decorationless).toHaveBeenNthCalledWith(1, undefined);
    expect(actions.decorationless).toHaveBeenNthCalledWith(2, true);
    await execute('theme', {});
    await execute('theme', { theme: 'latte' });
    expect(actions.theme).toHaveBeenNthCalledWith(1, 'toggle');
    expect(actions.theme).toHaveBeenNthCalledWith(2, 'latte');
  });

  it('validates panels, pages, and preference patches', async () => {
    const actions = sampleActions();
    const execute = createControlExecutor(actions);
    await execute('panel', { name: 'sidebar', action: 'off' });
    expect(actions.panel).toHaveBeenCalledWith('sidebar', 'off');
    await expect(execute('panel', { name: 'drawer' })).rejects.toThrow('`name`');
    await expect(execute('page', { page: 0 })).rejects.toThrow('positive integer');
    await expect(execute('page', { page: 2 })).resolves.toEqual(sampleState());
    const patch = { theme: 'latte', documentZoom: 120 };
    await execute('preferences.set', { patch });
    expect(actions.preferences).toHaveBeenCalledWith(patch);
    await expect(execute('preferences.set', { patch: [] })).rejects.toThrow('object');
  });

  it('dispatches document and view methods', async () => {
    const actions = sampleActions();
    const execute = createControlExecutor(actions);
    await execute('search', { query: '' });
    await execute('heading', { id: 'intro' });
    await execute('command', { id: 'next-tab' });
    await execute('close', { path: '/notes.md' });
    await execute('refresh', {});
    expect(actions.search).toHaveBeenCalledWith('');
    expect(actions.heading).toHaveBeenCalledWith('intro');
    expect(actions.command).toHaveBeenCalledWith('next-tab');
    expect(actions.close).toHaveBeenCalledWith('/notes.md');
    expect(actions.refresh).toHaveBeenCalled();
  });

  it('rejects unknown methods', async () => {
    const execute = createControlExecutor(sampleActions());
    await expect(execute('preview.explode', {})).rejects.toThrow('Unknown control method');
  });
});

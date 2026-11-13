import { describe, expect, it, vi } from 'vitest';
import { createControlExecutor, type ControlActions, type ControlState } from '../src/lib/control';
import { defaults } from '../src/lib/preferences';

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
      log: false,
      split: false,
      decorationless: false,
      query: '',
      rightTab: 'outline',
    },
    editor: {
      available: true,
      open: false,
      path: '/notes.md',
      language: 'markdown',
      dirty: false,
      busy: false,
      readOnly: false,
      status: '',
      error: null,
      cursor: null,
      selection: null,
      diagnostics: { errors: 0, warnings: 0, information: 0, hints: 0 },
    },
    explorer: { workingDirectory: '/', selected: null, expanded: [] },
    search: { open: false, query: '', matches: null },
    note: { path: '/notes.md', text: '' },
    trust: { supported: true, enabled: false },
    browser: null,
    livePreview: { available: false, visible: false, split: 50 },
    tools: { busy: false, message: '', error: '' },
    stats: { words: 1, characters: 5, minutes: 1, bytes: null, pages: null },
    selection: null,
    menu: {
      open: false,
      kind: null,
      title: '',
      x: 0,
      y: 0,
      path: null,
      directory: null,
      items: [],
    },
    recent: { files: [], folders: [], commands: [] },
    preferences: structuredClone(defaults),
    directory: '/',
    source: { label: 'Test', root: '/', live: true },
    busy: false,
    error: null,
  };
}

function sampleActions(overrides: Partial<ControlActions> = {}): ControlActions {
  const state = sampleState();
  const stateAction = () => vi.fn(async () => state);
  return {
    state: () => state,
    headings: () => ({ path: '/notes.md', headings: [] }),
    commands: () => ({ commands: [] }),
    open: vi.fn(async () => state),
    close: stateAction(),
    focus: stateAction(),
    tab: stateAction(),
    activate: stateAction(),
    closeTab: stateAction(),
    scroll: vi.fn(async () => ({})),
    zoom: stateAction(),
    fitWidth: stateAction(),
    decorationless: stateAction(),
    theme: stateAction(),
    panel: stateAction(),
    search: stateAction(),
    searchNext: stateAction(),
    searchPrevious: stateAction(),
    heading: stateAction(),
    page: stateAction(),
    command: stateAction(),
    preferences: stateAction(),
    refresh: stateAction(),
    latexStatus: vi.fn(async () => null),
    latexCancel: vi.fn(async () => false),
    editorOpen: stateAction(),
    editorClose: stateAction(),
    editorToggle: stateAction(),
    editorSave: stateAction(),
    editorReload: stateAction(),
    editorDiscard: stateAction(),
    editorGet: vi.fn(async () => ({ path: '/notes.md', text: '# Notes', dirty: false })),
    editorSet: stateAction(),
    editorReveal: stateAction(),
    editorSync: stateAction(),
    editorUndo: stateAction(),
    editorRedo: stateAction(),
    editorSelectAll: stateAction(),
    editorSelect: stateAction(),
    editorCopy: stateAction(),
    editorCut: stateAction(),
    editorPaste: stateAction(),
    editorDiagnostics: vi.fn(async () => ({ path: '/notes.md', diagnostics: [] })),
    explorerList: vi.fn(async () => ({ path: '/', entries: [] })),
    explorerCwd: stateAction(),
    explorerExpand: stateAction(),
    explorerCollapse: stateAction(),
    explorerSelect: stateAction(),
    explorerRead: vi.fn(async (path: string) => ({ path, text: '' })),
    explorerCreate: stateAction(),
    explorerRename: stateAction(),
    explorerDelete: stateAction(),
    noteGet: vi.fn(async () => ({ path: '/notes.md', text: '' })),
    noteSet: stateAction(),
    trust: stateAction(),
    rightTab: stateAction(),
    browserNavigate: stateAction(),
    browserBack: stateAction(),
    browserForward: stateAction(),
    browserReload: stateAction(),
    browserStop: stateAction(),
    browserZoom: stateAction(),
    browserWindow: stateAction(),
    browserQuote: stateAction(),
    browserSearch: stateAction(),
    pdfPassword: stateAction(),
    livePreview: stateAction(),
    livePreviewZoom: stateAction(),
    livePreviewFit: stateAction(),
    livePreviewSplit: stateAction(),
    selectionGet: vi.fn(async () => ({ text: '', source: '', preview: '' })),
    selectionCopy: stateAction(),
    selectionSet: stateAction(),
    selectionClear: stateAction(),
    toolsInstall: stateAction(),
    toolsTexlive: stateAction(),
    documentCopyRaw: stateAction(),
    settingsTab: stateAction(),
    menuOpen: stateAction(),
    menuActivate: stateAction(),
    menuClose: stateAction(),
    domQuery: vi.fn(async () => ({ selector: 'body *', count: 0, nodes: [] })),
    domGet: vi.fn(async (ref: string) => ({ ref, html: '' })),
    domFocus: stateAction(),
    domClick: stateAction(),
    domType: stateAction(),
    domAccessibility: vi.fn(async () => ({ nodes: [] })),
    screenshot: vi.fn(async () => ({ path: '/tmp/shot.png', width: 10, height: 10 })),
    input: vi.fn(async () => ({})),
    clipboardRead: vi.fn(async () => 'clipboard'),
    clipboardWrite: stateAction(),
    clipboardReadImage: vi.fn(async () => ({ path: '/tmp/clip.png' })),
    clipboardWriteImage: stateAction(),
    windowList: vi.fn(async () => []),
    windowFocus: stateAction(),
    windowCapture: vi.fn(async () => ({ path: '/tmp/window.png' })),
    waitSelector: vi.fn(async () => ({ count: 1 })),
    waitIdle: stateAction(),
    waitState: vi.fn(async () => ({ path: 'busy', value: false })),
    recordFrames: vi.fn(async () => ({ paths: [] })),
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

  it('forwards LaTeX compile status and cancellation', async () => {
    const actions = sampleActions({
      latexStatus: vi.fn(async () => ({ path: '/a.tex', engine: 'lualatex' })),
      latexCancel: vi.fn(async () => true),
    });
    const execute = createControlExecutor(actions);
    expect(await execute('latex.status', {})).toEqual({
      path: '/a.tex',
      engine: 'lualatex',
    });
    expect(await execute('latex.cancel', { path: '/a.tex' })).toBe(true);
    expect(actions.latexCancel).toHaveBeenCalledWith('/a.tex');
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
    await execute('search.next', {});
    await execute('search.previous', {});
    await execute('heading', { id: 'intro' });
    await execute('command', { id: 'next-tab' });
    await execute('close', { path: '/notes.md' });
    await execute('refresh', {});
    expect(actions.search).toHaveBeenCalledWith('');
    expect(actions.searchNext).toHaveBeenCalled();
    expect(actions.searchPrevious).toHaveBeenCalled();
    expect(actions.heading).toHaveBeenCalledWith('intro');
    expect(actions.command).toHaveBeenCalledWith('next-tab');
    expect(actions.close).toHaveBeenCalledWith('/notes.md');
    expect(actions.refresh).toHaveBeenCalled();
  });

  it('validates editor commands and positions', async () => {
    const actions = sampleActions();
    const execute = createControlExecutor(actions);
    await execute('editor.open', {});
    await execute('editor.reload', { discard: true });
    await execute('editor.set', { text: '\\section{Hi}' });
    await execute('editor.reveal', { line: 3, character: 4 });
    expect(actions.editorOpen).toHaveBeenCalled();
    expect(actions.editorReload).toHaveBeenCalledWith(true);
    expect(actions.editorSet).toHaveBeenCalledWith('\\section{Hi}');
    expect(actions.editorReveal).toHaveBeenCalledWith(3, 4);
    await expect(execute('editor.reveal', { line: -1 })).rejects.toThrow('non-negative');
    await expect(execute('editor.set', {})).rejects.toThrow('`text`');
  });

  it('dispatches editor edit primitives', async () => {
    const actions = sampleActions();
    const execute = createControlExecutor(actions);
    await execute('editor.undo', {});
    await execute('editor.redo', {});
    await execute('editor.select-all', {});
    await execute('editor.select', { from: 2, to: 8 });
    await execute('editor.copy', {});
    await execute('editor.cut', {});
    await execute('editor.paste', {});
    await execute('editor.diagnostics', {});
    expect(actions.editorUndo).toHaveBeenCalled();
    expect(actions.editorRedo).toHaveBeenCalled();
    expect(actions.editorSelectAll).toHaveBeenCalled();
    expect(actions.editorSelect).toHaveBeenCalledWith(2, 8);
    expect(actions.editorCopy).toHaveBeenCalled();
    expect(actions.editorCut).toHaveBeenCalled();
    expect(actions.editorPaste).toHaveBeenCalled();
    expect(actions.editorDiagnostics).toHaveBeenCalled();
    await expect(execute('editor.select', { from: -1, to: 2 })).rejects.toThrow('non-negative');
  });

  it('requires explicit force for explorer deletion', async () => {
    const actions = sampleActions();
    const execute = createControlExecutor(actions);
    await execute('explorer.create', {
      directory: '/notes',
      name: 'new.md',
      kind: 'markdown',
    });
    expect(actions.explorerCreate).toHaveBeenCalledWith('/notes', 'new.md', 'markdown');
    await expect(execute('explorer.delete', { path: '/notes/a.md' })).rejects.toThrow('force');
    await execute('explorer.delete', { path: '/notes/a.md', force: true });
    expect(actions.explorerDelete).toHaveBeenCalledWith('/notes/a.md');
    await expect(
      execute('explorer.create', {
        directory: '/notes',
        name: 'x',
        kind: 'script',
      }),
    ).rejects.toThrow('`kind`');
  });

  it('dispatches notes, trust, right panel, and browser actions', async () => {
    const actions = sampleActions();
    const execute = createControlExecutor(actions);
    await execute('note.get', {});
    await execute('note.set', { text: 'remember' });
    await execute('trust', { enabled: true });
    await execute('right.tab', { tab: 'gemini' });
    await execute('browser.navigate', { target: 'example.com' });
    await execute('browser.zoom', { action: 'in' });
    await execute('browser.quote', { site: 'chatgpt', text: 'quote' });
    await execute('browser.search', { text: 'search' });
    expect(actions.noteGet).toHaveBeenCalled();
    expect(actions.noteSet).toHaveBeenCalledWith('remember');
    expect(actions.trust).toHaveBeenCalledWith(true);
    expect(actions.rightTab).toHaveBeenCalledWith('gemini');
    expect(actions.browserNavigate).toHaveBeenCalledWith('example.com');
    expect(actions.browserZoom).toHaveBeenCalledWith('in');
    expect(actions.browserQuote).toHaveBeenCalledWith('chatgpt', 'quote');
    expect(actions.browserSearch).toHaveBeenCalledWith('search');
    await expect(execute('right.tab', { tab: 'drawer' })).rejects.toThrow('`tab`');
  });

  it('dispatches selection, tools, document, and settings actions', async () => {
    const actions = sampleActions();
    const execute = createControlExecutor(actions);
    await execute('selection.get', {});
    await execute('selection.copy', { kind: 'quote' });
    await execute('selection.set', { text: 'needle' });
    await execute('selection.clear', {});
    await execute('tools.install', { name: 'tinymist' });
    await execute('tools.texlive', { action: 'update' });
    await execute('document.copy', {});
    await execute('settings.tab', { tab: 'compilers' });
    expect(actions.selectionGet).toHaveBeenCalled();
    expect(actions.selectionCopy).toHaveBeenCalledWith('quote');
    expect(actions.selectionSet).toHaveBeenCalledWith('needle');
    expect(actions.selectionClear).toHaveBeenCalled();
    expect(actions.toolsInstall).toHaveBeenCalledWith('tinymist');
    expect(actions.toolsTexlive).toHaveBeenCalledWith('update');
    expect(actions.documentCopyRaw).toHaveBeenCalled();
    expect(actions.settingsTab).toHaveBeenCalledWith('compilers');
    await expect(execute('tools.install', { name: 'rival' })).rejects.toThrow('`name`');
    await expect(execute('selection.copy', { kind: 'html' })).rejects.toThrow('`kind`');
  });

  it('opens and activates menu entries', async () => {
    const actions = sampleActions();
    const execute = createControlExecutor(actions);
    await execute('menu.open', { kind: 'app', x: 10, y: 20 });
    expect(actions.menuOpen).toHaveBeenCalledWith('app', {
      path: undefined,
      directory: undefined,
      document: undefined,
      x: 10,
      y: 20,
    });
    await execute('menu.activate', { index: 2 });
    expect(actions.menuActivate).toHaveBeenCalledWith(2);
    await execute('menu.close', {});
    expect(actions.menuClose).toHaveBeenCalled();
    await expect(execute('menu.open', { kind: 'tab' })).rejects.toThrow('`path`');
    await expect(execute('menu.activate', { index: -1 })).rejects.toThrow('non-negative');
  });

  it('dispatches DOM inspection and screenshots', async () => {
    const actions = sampleActions();
    const execute = createControlExecutor(actions);
    await execute('dom.query', { selector: 'button', limit: 20, includeHidden: false });
    expect(actions.domQuery).toHaveBeenCalledWith({
      frame: 'main',
      selector: 'button',
      limit: 20,
      includeHidden: false,
    });
    await execute('dom.get', { ref: 'dom-1' });
    await execute('dom.focus', { ref: 'dom-1' });
    await execute('dom.click', { ref: 'dom-1' });
    await execute('dom.type', { ref: 'dom-1', text: 'hello' });
    await execute('dom.ax', { frame: 'preview' });
    expect(actions.domGet).toHaveBeenCalledWith('dom-1', 'main');
    expect(actions.domFocus).toHaveBeenCalledWith('dom-1', 'main');
    expect(actions.domClick).toHaveBeenCalledWith('dom-1', 'main');
    expect(actions.domType).toHaveBeenCalledWith('dom-1', 'hello', 'main');
    expect(actions.domAccessibility).toHaveBeenCalledWith('preview');
    await execute('screenshot', {
      target: 'rect',
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      clipboard: true,
    });
    expect(actions.screenshot).toHaveBeenCalledWith({
      target: 'rect',
      output: undefined,
      clipboard: true,
      ref: undefined,
      selector: undefined,
      frame: 'main',
      rect: { x: 10, y: 20, width: 100, height: 50 },
    });
    await expect(execute('screenshot', { target: 'element' })).rejects.toThrow('ref or selector');
    await expect(
      execute('screenshot', { target: 'rect', x: 0, y: 0, width: 0, height: 5 }),
    ).rejects.toThrow('positive');
  });

  it('dispatches native input, clipboard, and window actions', async () => {
    const actions = sampleActions();
    const execute = createControlExecutor(actions);
    await execute('input.click', { x: 10, y: 20, button: 'left', count: 2 });
    expect(actions.input).toHaveBeenCalledWith('click', {
      x: 10,
      y: 20,
      button: 'left',
      count: 2,
    });
    await execute('input.key', { keys: 'ctrl+l' });
    expect(actions.input).toHaveBeenCalledWith('key', { keys: 'ctrl+l' });
    await execute('clipboard.get', {});
    await execute('clipboard.set', { text: 'hello' });
    await execute('clipboard.get-image', { output: '/tmp/clip.png' });
    await execute('clipboard.set-image', { path: '/tmp/clip.png' });
    expect(actions.clipboardRead).toHaveBeenCalled();
    expect(actions.clipboardWrite).toHaveBeenCalledWith('hello');
    expect(actions.clipboardReadImage).toHaveBeenCalledWith('/tmp/clip.png');
    expect(actions.clipboardWriteImage).toHaveBeenCalledWith('/tmp/clip.png');
    await execute('window.list', {});
    await execute('window.focus', { id: 'abc' });
    await execute('window.capture', { id: 'abc', output: '/tmp/w.png', clipboard: true });
    expect(actions.windowList).toHaveBeenCalled();
    expect(actions.windowFocus).toHaveBeenCalledWith('abc');
    expect(actions.windowCapture).toHaveBeenCalledWith('abc', '/tmp/w.png', true);
  });

  it('waits for selectors, state, and idle', async () => {
    const actions = sampleActions();
    const execute = createControlExecutor(actions);
    await execute('wait.selector', {
      selector: 'button',
      frame: 'preview',
      timeoutMs: 5000,
    });
    expect(actions.waitSelector).toHaveBeenCalledWith('button', 'preview', 5000);
    await execute('wait.idle', { timeoutMs: 1000 });
    expect(actions.waitIdle).toHaveBeenCalledWith(1000);
    await execute('wait.state', { path: 'busy', equals: false, timeoutMs: 2000 });
    expect(actions.waitState).toHaveBeenCalledWith('busy', false, 2000);
    await expect(execute('wait.state', { path: 'busy' })).rejects.toThrow('equals');
  });

  it('records screenshot frame series', async () => {
    const actions = sampleActions();
    const execute = createControlExecutor(actions);
    await execute('record', {
      count: 3,
      intervalMs: 250,
      target: 'app',
      outputDir: '/tmp/frames',
    });
    expect(actions.recordFrames).toHaveBeenCalledWith({
      count: 3,
      intervalMs: 250,
      target: 'app',
      outputDir: '/tmp/frames',
    });
    await expect(
      execute('record', {
        count: 0,
        intervalMs: 250,
        target: 'app',
        outputDir: '/tmp/frames',
      }),
    ).rejects.toThrow('between 1 and 300');
  });

  it('rejects unknown methods', async () => {
    const execute = createControlExecutor(sampleActions());
    await expect(execute('preview.explode', {})).rejects.toThrow('Unknown control method');
  });
});

import { describe, expect, it } from 'vitest';
import { CONTROL_PROTOCOL, emptyAttachment } from '../src/lib/control';
import { buildControlState } from '../src/lib/control-state';
import { defaults } from '../src/lib/preferences';
import type { Workspace } from '../src/lib/workspace.svelte';

function workspace(overrides: Record<string, unknown> = {}) {
  return {
    active: '/notes.md',
    secondary: '',
    tabs: [
      { path: '/notes.md', bytes: undefined, scroll: 12.4, error: '' },
      { path: '/paper.pdf', bytes: Uint8Array.of(1), scroll: 0, error: '' },
      { path: '/paper.typ', bytes: undefined, scroll: 0, error: 'compile failed' },
    ],
    directory: '/notes',
    source: { label: 'Local filesystem', root: '/', live: true },
    busy: false,
    error: '',
    ...overrides,
  } as unknown as Workspace;
}

const view = {
  sidebar: true,
  outline: false,
  settings: false,
  palette: false,
  search: false,
  log: false,
  split: false,
  decorationless: false,
  query: '',
};

describe('control state snapshots', () => {
  it('labels tabs and reports the active document', () => {
    const state = buildControlState({
      workspace: workspace(),
      pdfPage: { path: '', page: 0, total: 0 },
      pagedDocument: false,
      view,
      preferences: structuredClone(defaults),
    });
    expect(state.protocol).toBe(CONTROL_PROTOCOL);
    expect(state.features).toContain('preview.attach');
    expect(state.features).toContain('preview.viewport');
    expect(state.features).toContain('attachment.typst');
    expect(state.attachment).toEqual(emptyAttachment());
    expect(state.active).toBe('/notes.md');
    expect(state.tabs.map((tab) => tab.kind)).toEqual(['markdown', 'pdf', 'typst-source']);
    expect(state.tabs[0].scroll).toBe(12);
    expect(state.tabs[2].error).toBe('compile failed');
  });

  it('passes through editor, explorer, search, and lock state', () => {
    const state = buildControlState({
      workspace: workspace({ active: '/paper.pdf' }),
      pdfPage: { path: '/paper.pdf', page: 0, total: 0 },
      pagedDocument: true,
      view,
      preferences: structuredClone(defaults),
      pdfLocked: true,
      editor: {
        available: false,
        open: false,
        path: '/paper.pdf',
        language: 'markdown',
        dirty: false,
        busy: false,
        readOnly: true,
        status: 'Source editing is unavailable.',
        error: null,
        cursor: null,
        selection: null,
        diagnostics: { errors: 0, warnings: 0, information: 0, hints: 0 },
      },
      explorer: { workingDirectory: '/notes', selected: '/notes/a.md', expanded: ['/notes'] },
      search: { open: true, query: 'needle', matches: 3 },
      note: { path: '/paper.pdf', text: 'note' },
      trust: { supported: false, enabled: false },
      livePreview: { available: false, visible: true, split: 50 },
      tools: { busy: true, message: 'Downloading…', error: '' },
      selection: { words: 2, characters: 9 },
      menu: {
        open: true,
        kind: 'file',
        title: 'File',
        x: 4,
        y: 8,
        path: '/notes/a.md',
        directory: false,
        items: [{ index: 0, id: 'open', label: 'Open' }],
      },
      recent: { files: ['/paper.pdf'], folders: [{ path: '/notes' }], commands: ['refresh'] },
    });
    expect(state.pdf).toEqual({ path: '/paper.pdf', page: 0, total: 0, locked: true });
    expect(state.explorer.selected).toBe('/notes/a.md');
    expect(state.search).toEqual({ open: true, query: 'needle', matches: 3 });
    expect(state.note.text).toBe('note');
    expect(state.tools.busy).toBe(true);
    expect(state.selection).toEqual({ words: 2, characters: 9 });
    expect(state.menu.kind).toBe('file');
    expect(state.menu.items[0].label).toBe('Open');
    expect(state.recent.commands).toEqual(['refresh']);
  });

  it('reports PDF state only for the active paged document', () => {
    const pdfPage = { path: '/paper.pdf', page: 2, total: 10 };
    expect(
      buildControlState({
        workspace: workspace({ active: '/paper.pdf' }),
        pdfPage,
        pagedDocument: true,
        view,
        preferences: structuredClone(defaults),
      }).pdf,
    ).toEqual({ ...pdfPage, locked: false });
    expect(
      buildControlState({
        workspace: workspace({ active: '/notes.md' }),
        pdfPage,
        pagedDocument: true,
        view,
        preferences: structuredClone(defaults),
      }).pdf,
    ).toBeNull();
    expect(
      buildControlState({
        workspace: workspace({ active: '/paper.pdf' }),
        pdfPage,
        pagedDocument: false,
        view,
        preferences: structuredClone(defaults),
      }).pdf,
    ).toBeNull();
  });

  it('reports an active external attachment', () => {
    const state = buildControlState({
      workspace: workspace(),
      pdfPage: { path: '', page: 0, total: 0 },
      pagedDocument: false,
      view,
      preferences: structuredClone(defaults),
      attachment: {
        active: true,
        owner: 'nvim-1',
        kind: 'markdown',
        root: '/notes.md',
        paths: ['/notes.md'],
        revision: 4,
      },
    });
    expect(state.attachment).toEqual({
      active: true,
      owner: 'nvim-1',
      kind: 'markdown',
      root: '/notes.md',
      paths: ['/notes.md'],
      revision: 4,
    });
  });

  it('labels every supported tab kind', () => {
    const state = buildControlState({
      workspace: workspace({
        tabs: [
          { path: '/a.md', bytes: undefined, scroll: 0, error: '' },
          { path: '/b.pdf', bytes: Uint8Array.of(1), scroll: 0, error: '' },
          { path: '/c.typ', bytes: undefined, scroll: 0, error: '' },
          { path: '/d.tex', bytes: undefined, scroll: 0, error: '' },
          { path: '/refs.bib', bytes: undefined, scroll: 0, error: '' },
        ],
      }),
      pdfPage: { path: '', page: 0, total: 0 },
      pagedDocument: false,
      view,
      preferences: structuredClone(defaults),
    });
    expect(state.tabs.map((tab) => tab.kind)).toEqual([
      'markdown',
      'pdf',
      'typst-source',
      'latex-source',
      'bibliography',
    ]);
  });

  it('falls back to an empty editor and reports paged statistics', () => {
    const tab = {
      path: '/paper.pdf',
      text: '',
      bytes: Uint8Array.of(1, 2, 3),
      scroll: 0,
      error: '',
    };
    const state = buildControlState({
      workspace: workspace({ active: '/paper.pdf', tabs: [tab], activeTab: tab }),
      pdfPage: { path: '/paper.pdf', page: 1, total: 5 },
      pagedDocument: true,
      view,
      preferences: structuredClone(defaults),
    });
    expect(state.editor.available).toBe(false);
    expect(state.editor.open).toBe(false);
    expect(state.editor.readOnly).toBe(true);
    expect(state.trust.supported).toBe(false);
    expect(state.stats).toEqual({
      words: null,
      characters: null,
      minutes: null,
      bytes: 3,
      pages: 5,
    });
  });

  it('reports a Typst attachment with its owned paths', () => {
    const state = buildControlState({
      workspace: workspace({ active: '/paper/main.typ' }),
      pdfPage: { path: '', page: 0, total: 0 },
      pagedDocument: false,
      view,
      preferences: structuredClone(defaults),
      attachment: {
        active: true,
        owner: 'nvim-1',
        kind: 'typst',
        root: '/paper/main.typ',
        paths: ['/paper/main.typ', '/paper/chapter.typ'],
        revision: 2,
      },
    });
    expect(state.attachment.kind).toBe('typst');
    expect(state.attachment.root).toBe('/paper/main.typ');
    expect(state.attachment.paths).toEqual(['/paper/main.typ', '/paper/chapter.typ']);
  });

  it('uses preview-only text for statistics', () => {
    const tab = {
      path: '/notes.md',
      text: 'disk words',
      previewText: 'live preview words',
      bytes: undefined,
      scroll: 0,
      error: '',
    };
    const state = buildControlState({
      workspace: workspace({
        tabs: [tab],
        activeTab: tab,
      }),
      pdfPage: { path: '', page: 0, total: 0 },
      pagedDocument: false,
      view,
      preferences: structuredClone(defaults),
    });
    expect(state.stats.words).toBe(3);
    expect(state.stats.characters).toBe('live preview words'.length);
  });
});

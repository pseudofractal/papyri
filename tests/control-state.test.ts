import { describe, expect, it } from 'vitest';
import { CONTROL_PROTOCOL } from '../src/lib/control';
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
  split: false,
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
    expect(state.active).toBe('/notes.md');
    expect(state.tabs.map((tab) => tab.kind)).toEqual(['markdown', 'pdf', 'typst-source']);
    expect(state.tabs[0].scroll).toBe(12);
    expect(state.tabs[2].error).toBe('compile failed');
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
    ).toEqual(pdfPage);
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
});

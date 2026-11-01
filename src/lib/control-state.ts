import { isLatex, isTypst } from './paths';
import type { Preferences } from './types';
import type { Tab, Workspace } from './workspace.svelte';
import type { ControlState, ControlTab } from './control';

export interface ControlStateInput {
  workspace: Workspace;
  pdfPage: { path: string; page: number; total: number };
  pagedDocument: boolean;
  view: ControlState['view'];
  preferences: Preferences;
}

function documentKind(tab: Tab): ControlTab['kind'] {
  if (tab.bytes) return 'pdf';
  if (isTypst(tab.path)) return 'typst-source';
  if (isLatex(tab.path)) return 'latex-source';
  return 'markdown';
}

/** Build the control API snapshot from the current workspace and view state. */
export function buildControlState({
  workspace,
  pdfPage,
  pagedDocument,
  view,
  preferences,
}: ControlStateInput): ControlState {
  return {
    protocol: 1,
    active: workspace.active || null,
    secondary: workspace.secondary || null,
    tabs: workspace.tabs.map((tab) => ({
      path: tab.path,
      kind: documentKind(tab),
      active: tab.path === workspace.active,
      secondary: tab.path === workspace.secondary,
      scroll: Math.round(tab.scroll),
      error: tab.error || null,
    })),
    pdf:
      pagedDocument && pdfPage.path === workspace.active && pdfPage.total
        ? { path: pdfPage.path, page: pdfPage.page, total: pdfPage.total }
        : null,
    view,
    preferences,
    directory: workspace.directory,
    source: workspace.source
      ? {
          label: workspace.source.label,
          root: workspace.source.root,
          live: workspace.source.live,
        }
      : null,
    busy: workspace.busy,
    error: workspace.error || null,
  };
}

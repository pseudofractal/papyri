import { isLatex, isMarkdown, isTypst } from './paths';
import {
  CONTROL_PROTOCOL,
  type ControlEditorState,
  type ControlExplorerState,
  type ControlLivePreviewState,
  type ControlMenuState,
  type ControlNoteState,
  type ControlSearchState,
  type ControlState,
  type ControlStats,
  type ControlTab,
  type ControlToolsState,
  type ControlTrustState,
} from './control';
import type { BrowserState } from './browser';
import type { RightTab } from './sites';
import type { Preferences } from './types';
import type { Tab, Workspace } from './workspace.svelte';

export interface ControlStateInput {
  workspace: Workspace;
  pdfPage: { path: string; page: number; total: number };
  pagedDocument: boolean;
  view: Omit<ControlState['view'], 'rightTab'>;
  preferences: Preferences;
  editor?: ControlEditorState;
  explorer?: ControlExplorerState;
  search?: ControlSearchState;
  note?: ControlNoteState;
  trust?: ControlTrustState;
  browser?: BrowserState | null;
  rightTab?: RightTab;
  livePreview?: ControlLivePreviewState;
  tools?: ControlToolsState;
  stats?: ControlStats;
  selection?: { words: number; characters: number } | null;
  menu?: ControlMenuState;
  recent?: {
    files: string[];
    folders: { path: string; lastFile?: string }[];
    commands: string[];
  };
  pdfLocked?: boolean;
}

function documentKind(tab: Tab): ControlTab['kind'] {
  if (tab.bytes) return 'pdf';
  if (isTypst(tab.path)) return 'typst-source';
  if (isLatex(tab.path)) return 'latex-source';
  return 'markdown';
}

const emptyEditor = (workspace: Workspace): ControlEditorState => ({
  available: false,
  open: false,
  path: workspace.active || null,
  language: isTypst(workspace.active) ? 'typst' : isLatex(workspace.active) ? 'latex' : 'markdown',
  dirty: false,
  busy: false,
  readOnly: true,
  status: 'Source editing is unavailable.',
  error: null,
  cursor: null,
  selection: null,
  diagnostics: { errors: 0, warnings: 0, information: 0, hints: 0 },
});

/** Build the control API snapshot from the current workspace and view state. */
export function buildControlState({
  workspace,
  pdfPage,
  pagedDocument,
  view,
  preferences,
  editor,
  explorer,
  search,
  note,
  trust,
  browser = null,
  rightTab = 'outline',
  livePreview,
  tools,
  stats,
  selection = null,
  menu,
  recent,
  pdfLocked = false,
}: ControlStateInput): ControlState {
  const activeTab = workspace.activeTab;
  const markdownActive = isMarkdown(workspace.active);
  return {
    protocol: CONTROL_PROTOCOL,
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
      pagedDocument && pdfPage.path === workspace.active
        ? {
            path: pdfPage.path,
            page: pdfPage.page,
            total: pdfPage.total,
            locked: pdfLocked,
          }
        : null,
    view: {
      ...view,
      rightTab,
    },
    editor: editor ?? emptyEditor(workspace),
    explorer: explorer ?? {
      workingDirectory: workspace.directory,
      selected: null,
      expanded: [],
    },
    search: search ?? { open: view.search, query: view.query, matches: null },
    note: note ?? { path: workspace.active || null, text: '' },
    trust: trust ?? { supported: markdownActive, enabled: false },
    browser,
    livePreview: livePreview ?? { available: false, visible: false, split: 50 },
    tools: tools ?? { busy: false, message: '', error: '' },
    stats: stats ?? {
      words: activeTab?.bytes
        ? null
        : activeTab?.text.trim()
          ? activeTab.text.trim().split(/\s+/).length
          : 0,
      characters: activeTab?.bytes ? null : (activeTab?.text.length ?? 0),
      minutes: null,
      bytes: activeTab?.bytes?.length ?? null,
      pages: pdfPage.path === workspace.active ? pdfPage.total : null,
    },
    selection,
    menu: menu ?? {
      open: false,
      kind: null,
      title: '',
      x: 0,
      y: 0,
      path: null,
      directory: null,
      items: [],
    },
    recent: recent ?? { files: [], folders: [], commands: [] },
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

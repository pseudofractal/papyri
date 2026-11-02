import type { ControlActions, ControlPanel, ControlState } from './control';
import { HEADINGS_POLL_MS, HEADINGS_READY_TIMEOUT_MS } from './control-timings';
import { isDocument, normalize } from './paths';
import type { PaletteCommand } from './palette';
import { mergePreferences } from './preferences';
import { scrollPreview, waitForPreview, type PreviewControls } from './preview-control';
import type { Heading, Preferences } from './types';
import {
  clampZoom,
  MAX_PDF_ZOOM,
  MAX_ZOOM,
  MIN_PDF_ZOOM,
  MIN_ZOOM,
  NARROW_VIEWPORT,
  type ZoomCommand,
} from './view';
import type { Workspace } from './workspace.svelte';

export interface ControlViewState {
  sidebar: boolean;
  outline: boolean;
  settings: boolean;
  palette: boolean;
  search: boolean;
  decorationless: boolean;
  query: string;
}

export interface ControlContext {
  workspace: Workspace;
  workspaceReady: Promise<void>;
  view: ControlViewState;
  state(): ControlState;
  headings(): Heading[];
  headingsPath(): string;
  pdfPage(): { path: string; page: number; total: number };
  pagedDocument(): boolean;
  primaryPreview(): PreviewControls | undefined;
  secondaryPreview(): PreviewControls | undefined;
  preferences(): Preferences;
  updatePreferences(value: Preferences): void;
  commands(): PaletteCommand[];
  runCommand(id: string): void;
  rememberFolder(path: string): void;
  zoom(command: ZoomCommand): void;
  split(): void;
  refresh(): Promise<void>;
}

/** Build the host-side control actions from the app's current state. */
export function createControlActions(context: ControlContext): ControlActions {
  const { workspace, view } = context;
  const closeTarget = async (path?: string) => {
    await context.workspaceReady;
    const target = path ? normalize(path) : workspace.active;
    if (!target) throw new Error('No tab is open.');
    if (!workspace.tabs.some((tab) => tab.path === target))
      throw new Error(`Tab is not open: ${target}`);
    workspace.close(target);
    return context.state();
  };
  const reveal = async (path: string) => {
    await context.workspaceReady;
    const target = normalize(path);
    await workspace.open(target);
    if (workspace.active !== target)
      throw new Error(workspace.error || `Could not open ${target}.`);
    return context.state();
  };
  return {
    state: context.state,
    async headings() {
      await context.workspaceReady;
      if (!workspace.active) throw new Error('No document is open.');
      const deadline = Date.now() + HEADINGS_READY_TIMEOUT_MS;
      while (context.headingsPath() !== workspace.active && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, HEADINGS_POLL_MS));
      if (context.headingsPath() !== workspace.active)
        throw new Error('The document is still rendering its headings.');
      return {
        path: workspace.active,
        headings: context.headings().map((heading) => ({ ...heading })),
      };
    },
    async commands() {
      await context.workspaceReady;
      return {
        commands: context.commands().map(({ id, label, group }) => ({ id, label, group })),
      };
    },
    async open(path, options) {
      await context.workspaceReady;
      const target = normalize(path);
      if (options.directory) {
        workspace.directory = workspace.searchRoot = target;
        workspace.treeRevision++;
        workspace.error = '';
        context.rememberFolder(target);
        return context.state();
      }
      if (!isDocument(target)) throw new Error('Open a Markdown, PDF, Typst, or LaTeX document.');
      if (options.pane === 'secondary' && workspace.active) {
        if (options.anchor) throw new Error('Anchors are only supported in the main pane.');
        await workspace.openSecondary(target);
        if (workspace.secondary !== target)
          throw new Error(workspace.error || `Could not open ${target}.`);
        return context.state();
      }
      await workspace.open(target, options.anchor || '');
      if (workspace.active !== target)
        throw new Error(workspace.error || `Could not open ${target}.`);
      if (window.innerWidth < NARROW_VIEWPORT) view.sidebar = false;
      return context.state();
    },
    close: closeTarget,
    focus: reveal,
    async tab(direction) {
      await context.workspaceReady;
      const tabs = workspace.tabs;
      if (!tabs.length) return context.state();
      const current = tabs.findIndex((tab) => tab.path === workspace.active);
      const step = direction === 'next' ? 1 : -1;
      const next =
        current === -1
          ? tabs[direction === 'next' ? 0 : tabs.length - 1]
          : tabs[(current + step + tabs.length) % tabs.length];
      await workspace.open(next.path);
      return context.state();
    },
    activate: reveal,
    closeTab: closeTarget,
    async scroll(pane, target) {
      await context.workspaceReady;
      const preview = await waitForPreview(
        () => (pane === 'secondary' ? workspace.secondary : workspace.active),
        () => (pane === 'secondary' ? context.secondaryPreview() : context.primaryPreview()),
        pane === 'secondary' ? 'The split pane is empty.' : 'No document is open.',
      );
      const y = await scrollPreview(preview, target);
      return { pane, y: Math.round(y) };
    },
    zoom: async (target, action, value) => {
      if (value !== undefined) {
        const paged = target === 'document' && context.pagedDocument();
        const key = target === 'ui' ? 'uiZoom' : paged ? 'pdfZoom' : 'documentZoom';
        const zoomValue = clampZoom(
          value,
          paged ? MIN_PDF_ZOOM : MIN_ZOOM,
          paged ? MAX_PDF_ZOOM : MAX_ZOOM,
        );
        const current = context.preferences();
        context.updatePreferences({
          ...current,
          [key]: zoomValue,
          fitWidth: paged ? false : current.fitWidth,
        });
      } else if (action) {
        context.zoom({ target, action });
      }
      return context.state();
    },
    fitWidth: async (enabled) => {
      const current = context.preferences();
      const value = enabled ?? !current.fitWidth;
      if (value !== current.fitWidth) context.updatePreferences({ ...current, fitWidth: value });
      return context.state();
    },
    decorationless: async (enabled) => {
      context.view.decorationless = enabled ?? !context.view.decorationless;
      return context.state();
    },
    theme: async (value) => {
      const current = context.preferences();
      const theme = value === 'toggle' ? (current.theme === 'mocha' ? 'latte' : 'mocha') : value;
      context.updatePreferences({ ...current, theme });
      return context.state();
    },
    panel: async (name: ControlPanel, action) => {
      const desired = (current: boolean) =>
        action === 'on' ? true : action === 'off' ? false : !current;
      switch (name) {
        case 'sidebar':
          view.sidebar = desired(view.sidebar);
          break;
        case 'outline':
          view.outline = desired(view.outline);
          break;
        case 'settings':
          view.settings = desired(view.settings);
          break;
        case 'palette':
          await context.workspaceReady;
          if (!workspace.source) throw new Error('No folder or document source is available.');
          view.palette = desired(view.palette);
          break;
        case 'search':
          view.search = desired(view.search);
          if (!view.search) view.query = '';
          break;
        case 'split':
          await context.workspaceReady;
          if (!workspace.active) throw new Error('No document is open.');
          if (action === 'off') workspace.secondary = '';
          else if (action === 'on')
            workspace.secondary =
              workspace.secondary ||
              workspace.tabs.find((tab) => tab.path !== workspace.active)?.path ||
              workspace.active;
          else context.split();
          break;
      }
      return context.state();
    },
    search: async (value) => {
      view.query = value;
      view.search = value.trim().length > 0;
      return context.state();
    },
    async heading(id) {
      await context.workspaceReady;
      if (!workspace.active) throw new Error('No document is open.');
      workspace.navigateAnchor(id);
      return context.state();
    },
    async page(page) {
      await context.workspaceReady;
      if (!context.pagedDocument()) throw new Error('The active document is not a PDF preview.');
      const pdf = context.pdfPage();
      if (pdf.path === workspace.active && pdf.total && page > pdf.total)
        throw new Error(`The document has ${pdf.total} pages.`);
      workspace.navigateAnchor(`page=${page}`);
      return context.state();
    },
    async command(id) {
      await context.workspaceReady;
      if (!context.commands().some((command) => command.id === id))
        throw new Error(`Unknown command: ${id}`);
      context.runCommand(id);
      return context.state();
    },
    async preferences(patch) {
      const next = mergePreferences(context.preferences(), patch);
      context.updatePreferences(next);
      return { preferences: next };
    },
    refresh: async () => {
      await context.workspaceReady;
      await context.refresh();
      return context.state();
    },
  };
}

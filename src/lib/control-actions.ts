import type {
  ControlActions,
  ControlBrowserZoom,
  ControlDomFrame,
  ControlEditorState,
  ControlEntryKind,
  ControlLivePreviewState,
  ControlMenuKind,
  ControlMenuState,
  ControlNoteState,
  ControlPanel,
  ControlSelectionKind,
  ControlSettingsTab,
  ControlScreenshotOptions,
  ControlState,
  ControlTexliveAction,
  ControlToolName,
  ControlTrustState,
} from './control';
import { HEADINGS_POLL_MS, HEADINGS_READY_TIMEOUT_MS } from './control-timings';
import { listDirectory } from './directories';
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
import type { BrowserState } from './browser';
import type { RightTab } from './sites';

export interface ControlViewState {
  sidebar: boolean;
  outline: boolean;
  settings: boolean;
  palette: boolean;
  search: boolean;
  decorationless: boolean;
  query: string;
}

export interface ControlEditorContext {
  state(): ControlEditorState;
  open(): Promise<void>;
  close(): Promise<void>;
  save(): Promise<void>;
  reload(discard: boolean): Promise<void>;
  text(): Promise<{ path: string; text: string; dirty: boolean }>;
  setText(text: string): Promise<void>;
  reveal(line: number, character: number): Promise<void>;
  sync(): Promise<void>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  selectAll(): Promise<void>;
  select(from: number, to: number): Promise<void>;
  copy(): Promise<void>;
  cut(): Promise<void>;
  paste(): Promise<void>;
  diagnostics(): Promise<{ path: string | null; diagnostics: unknown[] }>;
}

export interface ControlExplorerContext {
  state(): ControlState['explorer'];
  list(path: string): Promise<unknown>;
  cwd(path: string): Promise<void>;
  expand(path: string): Promise<void>;
  collapse(path: string): Promise<void>;
  select(path: string): Promise<void>;
  read(path: string): Promise<{ path: string; text: string }>;
  create(directory: string, name: string, kind: ControlEntryKind): Promise<string>;
  rename(path: string, name: string): Promise<string>;
  delete(path: string): Promise<void>;
}

export interface ControlNoteContext {
  get(): ControlNoteState;
  set(text: string): Promise<void>;
}

export interface ControlTrustContext {
  state(): ControlTrustState;
  set(enabled?: boolean): Promise<void>;
}

export interface ControlBrowserContext {
  state(): BrowserState | null;
  navigate(target: string): Promise<void>;
  back(): Promise<void>;
  forward(): Promise<void>;
  reload(): Promise<void>;
  stop(): Promise<void>;
  zoom(action: ControlBrowserZoom): Promise<void>;
  window(url?: string): Promise<void>;
  quote(site: 'chatgpt' | 'wikipedia' | 'gemini', text: string): Promise<void>;
  search(text: string): Promise<void>;
}

export interface ControlSearchContext {
  matches(): number | null;
  next(): Promise<void>;
  previous(): Promise<void>;
}

export interface ControlPdfContext {
  password(password: string): Promise<void>;
}

export interface ControlMenuContext {
  state(): ControlMenuState;
  open(
    kind: ControlMenuKind,
    options: { path?: string; directory?: boolean; document?: boolean; x?: number; y?: number },
  ): Promise<void>;
  activate(index: number): Promise<void>;
  close(): Promise<void>;
}

export interface ControlLivePreviewContext {
  state(): ControlLivePreviewState;
  set(enabled?: boolean): Promise<void>;
  zoom(action: 'in' | 'out' | 'reset'): Promise<void>;
  fit(): Promise<void>;
  split(value: number): Promise<void>;
}

export interface ControlSelectionContext {
  get(): Promise<{ text: string; source: string; preview: string }>;
  copy(kind: ControlSelectionKind): Promise<void>;
  set(text: string): Promise<void>;
  clear(): Promise<void>;
}

export interface ControlDomContext {
  query(options: {
    frame: ControlDomFrame;
    selector?: string;
    limit?: number;
    includeHidden?: boolean;
  }): Promise<unknown>;
  get(ref: string, frame: ControlDomFrame): Promise<unknown>;
  focus(ref: string, frame: ControlDomFrame): Promise<unknown>;
  click(ref: string, frame: ControlDomFrame): Promise<unknown>;
  type(ref: string, text: string, frame: ControlDomFrame): Promise<unknown>;
  accessibility(frame: ControlDomFrame): Promise<unknown>;
}

export interface ControlInputContext {
  inject(action: string, params: Record<string, unknown>): Promise<unknown>;
  clipboardRead(): Promise<unknown>;
  clipboardWrite(text: string): Promise<unknown>;
  clipboardReadImage(output?: string): Promise<unknown>;
  clipboardWriteImage(path: string): Promise<unknown>;
  windows(): Promise<unknown>;
  focusWindow(id: string): Promise<unknown>;
  captureWindow(id: string, output?: string, clipboard?: boolean): Promise<unknown>;
  waitSelector(selector: string, frame: ControlDomFrame, timeoutMs: number): Promise<unknown>;
  waitIdle(timeoutMs: number): Promise<unknown>;
  waitState(path: string, equals: unknown, timeoutMs: number): Promise<unknown>;
  recordFrames(options: {
    count: number;
    intervalMs: number;
    target: 'screen' | 'app';
    outputDir: string;
  }): Promise<unknown>;
}

export interface ControlScreenshotContext {
  capture(options: ControlScreenshotOptions): Promise<unknown>;
}

export interface ControlToolsContext {
  state(): ControlState['tools'];
  install(name: ControlToolName): Promise<unknown>;
  texlive(action: ControlTexliveAction): Promise<unknown>;
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
  editor: ControlEditorContext;
  explorer: ControlExplorerContext;
  note: ControlNoteContext;
  trust: ControlTrustContext;
  rightTab(tab: RightTab): Promise<void>;
  browser: ControlBrowserContext;
  search: ControlSearchContext;
  pdf: ControlPdfContext;
  livePreview: ControlLivePreviewContext;
  selection: ControlSelectionContext;
  menu: ControlMenuContext;
  dom: ControlDomContext;
  screenshot: ControlScreenshotContext;
  input: ControlInputContext;
  tools: ControlToolsContext;
  documentCopyRaw(): Promise<void>;
  settingsTab(tab: ControlSettingsTab): Promise<void>;
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
  const requireBrowser = () => {
    const state = context.browser.state();
    if (!state) throw new Error('The web browser requires the Linux app.');
    return state;
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
    searchNext: async () => {
      await context.workspaceReady;
      await context.search.next();
      return context.state();
    },
    searchPrevious: async () => {
      await context.workspaceReady;
      await context.search.previous();
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
    async pdfPassword(password) {
      await context.workspaceReady;
      await context.pdf.password(password);
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
    editorOpen: async () => {
      await context.workspaceReady;
      await context.editor.open();
      return context.state();
    },
    editorClose: async () => {
      await context.workspaceReady;
      await context.editor.close();
      return context.state();
    },
    editorToggle: async () => {
      await context.workspaceReady;
      if (context.editor.state().open) await context.editor.close();
      else await context.editor.open();
      return context.state();
    },
    editorSave: async () => {
      await context.workspaceReady;
      await context.editor.save();
      return context.state();
    },
    editorReload: async (discard) => {
      await context.workspaceReady;
      await context.editor.reload(discard);
      return context.state();
    },
    editorDiscard: async () => {
      await context.workspaceReady;
      await context.editor.reload(true);
      return context.state();
    },
    editorGet: async () => {
      await context.workspaceReady;
      return context.editor.text();
    },
    editorSet: async (text) => {
      await context.workspaceReady;
      await context.editor.setText(text);
      return context.state();
    },
    editorReveal: async (line, character) => {
      await context.workspaceReady;
      await context.editor.reveal(line, character);
      return context.state();
    },
    editorSync: async () => {
      await context.workspaceReady;
      await context.editor.sync();
      return context.state();
    },
    editorUndo: async () => {
      await context.workspaceReady;
      await context.editor.undo();
      return context.state();
    },
    editorRedo: async () => {
      await context.workspaceReady;
      await context.editor.redo();
      return context.state();
    },
    editorSelectAll: async () => {
      await context.workspaceReady;
      await context.editor.selectAll();
      return context.state();
    },
    editorSelect: async (from, to) => {
      await context.workspaceReady;
      await context.editor.select(from, to);
      return context.state();
    },
    editorCopy: async () => {
      await context.workspaceReady;
      await context.editor.copy();
      return context.state();
    },
    editorCut: async () => {
      await context.workspaceReady;
      await context.editor.cut();
      return context.state();
    },
    editorPaste: async () => {
      await context.workspaceReady;
      await context.editor.paste();
      return context.state();
    },
    editorDiagnostics: async () => {
      await context.workspaceReady;
      return context.editor.diagnostics();
    },
    explorerList: async (path) => {
      await context.workspaceReady;
      const source = workspace.source;
      if (!source) throw new Error('No folder or document source is available.');
      const target = normalize(path || context.explorer.state().workingDirectory);
      return {
        path: target,
        entries: await listDirectory(source, target),
      };
    },
    explorerCwd: async (path) => {
      await context.workspaceReady;
      await context.explorer.cwd(normalize(path));
      return context.state();
    },
    explorerExpand: async (path) => {
      await context.workspaceReady;
      await context.explorer.expand(normalize(path));
      return context.state();
    },
    explorerCollapse: async (path) => {
      await context.workspaceReady;
      await context.explorer.collapse(normalize(path));
      return context.state();
    },
    explorerSelect: async (path) => {
      await context.workspaceReady;
      await context.explorer.select(normalize(path));
      return context.state();
    },
    explorerRead: async (path) => {
      await context.workspaceReady;
      return context.explorer.read(normalize(path));
    },
    explorerCreate: async (directory, name, kind) => {
      await context.workspaceReady;
      const path = await context.explorer.create(normalize(directory), name, kind);
      return { path, state: context.state() };
    },
    explorerRename: async (path, name) => {
      await context.workspaceReady;
      const next = await context.explorer.rename(normalize(path), name);
      return { path: next, state: context.state() };
    },
    explorerDelete: async (path) => {
      await context.workspaceReady;
      await context.explorer.delete(normalize(path));
      return context.state();
    },
    noteGet: async () => {
      await context.workspaceReady;
      return context.note.get();
    },
    noteSet: async (text) => {
      await context.workspaceReady;
      await context.note.set(text);
      return { note: context.note.get(), state: context.state() };
    },
    trust: async (enabled) => {
      await context.workspaceReady;
      await context.trust.set(enabled);
      return context.state();
    },
    rightTab: async (tab) => {
      await context.workspaceReady;
      await context.rightTab(tab);
      return context.state();
    },
    browserNavigate: async (target) => {
      await context.workspaceReady;
      requireBrowser();
      await context.browser.navigate(target);
      return context.state();
    },
    browserBack: async () => {
      await context.workspaceReady;
      requireBrowser();
      await context.browser.back();
      return context.state();
    },
    browserForward: async () => {
      await context.workspaceReady;
      requireBrowser();
      await context.browser.forward();
      return context.state();
    },
    browserReload: async () => {
      await context.workspaceReady;
      requireBrowser();
      await context.browser.reload();
      return context.state();
    },
    browserStop: async () => {
      await context.workspaceReady;
      requireBrowser();
      await context.browser.stop();
      return context.state();
    },
    browserZoom: async (action) => {
      await context.workspaceReady;
      requireBrowser();
      await context.browser.zoom(action);
      return context.state();
    },
    browserWindow: async (url) => {
      await context.workspaceReady;
      requireBrowser();
      await context.browser.window(url);
      return context.state();
    },
    browserQuote: async (site, text) => {
      await context.workspaceReady;
      requireBrowser();
      await context.browser.quote(site, text);
      return context.state();
    },
    browserSearch: async (text) => {
      await context.workspaceReady;
      requireBrowser();
      await context.browser.search(text);
      return context.state();
    },
    livePreview: async (enabled) => {
      await context.workspaceReady;
      await context.livePreview.set(enabled);
      return context.state();
    },
    livePreviewZoom: async (action) => {
      await context.workspaceReady;
      await context.livePreview.zoom(action);
      return context.state();
    },
    livePreviewFit: async () => {
      await context.workspaceReady;
      await context.livePreview.fit();
      return context.state();
    },
    livePreviewSplit: async (value) => {
      await context.workspaceReady;
      await context.livePreview.split(value);
      return context.state();
    },
    selectionGet: async () => {
      await context.workspaceReady;
      return context.selection.get();
    },
    selectionCopy: async (kind) => {
      await context.workspaceReady;
      await context.selection.copy(kind);
      return { copied: true, kind };
    },
    selectionSet: async (text) => {
      await context.workspaceReady;
      await context.selection.set(text);
      return context.state();
    },
    selectionClear: async () => {
      await context.workspaceReady;
      await context.selection.clear();
      return context.state();
    },
    toolsInstall: async (name) => {
      await context.workspaceReady;
      return context.tools.install(name);
    },
    toolsTexlive: async (action) => {
      await context.workspaceReady;
      return context.tools.texlive(action);
    },
    documentCopyRaw: async () => {
      await context.workspaceReady;
      await context.documentCopyRaw();
      return { copied: true };
    },
    settingsTab: async (tab) => {
      await context.workspaceReady;
      await context.settingsTab(tab);
      return context.state();
    },
    menuOpen: async (kind, options) => {
      await context.workspaceReady;
      await context.menu.open(kind, options);
      return context.state();
    },
    menuActivate: async (index) => {
      await context.workspaceReady;
      await context.menu.activate(index);
      return context.state();
    },
    menuClose: async () => {
      await context.workspaceReady;
      await context.menu.close();
      return context.state();
    },
    domQuery: async (options) => {
      await context.workspaceReady;
      return context.dom.query(options);
    },
    domGet: async (ref, frame) => {
      await context.workspaceReady;
      return context.dom.get(ref, frame);
    },
    domFocus: async (ref, frame) => {
      await context.workspaceReady;
      await context.dom.focus(ref, frame);
      return context.state();
    },
    domClick: async (ref, frame) => {
      await context.workspaceReady;
      await context.dom.click(ref, frame);
      return context.state();
    },
    domType: async (ref, text, frame) => {
      await context.workspaceReady;
      await context.dom.type(ref, text, frame);
      return context.state();
    },
    domAccessibility: async (frame) => {
      await context.workspaceReady;
      return context.dom.accessibility(frame);
    },
    screenshot: async (options) => {
      await context.workspaceReady;
      return context.screenshot.capture(options);
    },
    input: async (action, params) => {
      await context.workspaceReady;
      return context.input.inject(action, params);
    },
    clipboardRead: async () => {
      await context.workspaceReady;
      return context.input.clipboardRead();
    },
    clipboardWrite: async (text) => {
      await context.workspaceReady;
      await context.input.clipboardWrite(text);
      return { copied: true, characters: text.length };
    },
    clipboardReadImage: async (output) => {
      await context.workspaceReady;
      return context.input.clipboardReadImage(output);
    },
    clipboardWriteImage: async (path) => {
      await context.workspaceReady;
      await context.input.clipboardWriteImage(path);
      return { copied: true, path };
    },
    windowList: async () => {
      await context.workspaceReady;
      return context.input.windows();
    },
    windowFocus: async (id) => {
      await context.workspaceReady;
      await context.input.focusWindow(id);
      return { focused: id };
    },
    windowCapture: async (id, output, clipboard) => {
      await context.workspaceReady;
      return context.input.captureWindow(id, output, clipboard);
    },
    waitSelector: async (selector, frame, timeoutMs) => {
      await context.workspaceReady;
      return context.input.waitSelector(selector, frame, timeoutMs);
    },
    waitIdle: async (timeoutMs) => {
      await context.workspaceReady;
      return context.input.waitIdle(timeoutMs);
    },
    waitState: async (path, equals, timeoutMs) => {
      await context.workspaceReady;
      return context.input.waitState(path, equals, timeoutMs);
    },
    recordFrames: async (options) => {
      await context.workspaceReady;
      return context.input.recordFrames(options);
    },
  };
}

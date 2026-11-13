import type { Preferences } from './types';
import type { BrowserState } from './browser';
import type { RightTab } from './sites';

/** Keep in sync with `PROTOCOL_VERSION` in `src-tauri/src/control.rs`. */
export const CONTROL_PROTOCOL = 1;

export type ControlLanguage = 'markdown' | 'typst' | 'latex';
export type ControlEntryKind = 'folder' | 'markdown' | 'typst' | 'latex';
export type ControlSettingsTab = 'appearance' | 'reading' | 'documents' | 'compilers';
export type ControlToolName = 'marksman' | 'tinymist' | 'texlab' | 'typst';
export type ControlSelectionKind = 'source' | 'text' | 'quote';
export type ControlBrowserZoom = 'in' | 'out' | 'reset';
export type ControlTexliveAction = 'install' | 'update';

export interface ControlCursor {
  line: number;
  character: number;
}

export interface ControlTextSelection extends ControlCursor {
  from: number;
  to: number;
  text: string;
}

export interface ControlEditorState {
  available: boolean;
  open: boolean;
  path: string | null;
  language: ControlLanguage;
  dirty: boolean;
  busy: boolean;
  readOnly: boolean;
  status: string;
  error: string | null;
  cursor: ControlCursor | null;
  selection: ControlTextSelection | null;
  diagnostics: { errors: number; warnings: number; information: number; hints: number };
}

export interface ControlExplorerState {
  workingDirectory: string;
  selected: string | null;
  expanded: string[];
}

export interface ControlSearchState {
  open: boolean;
  query: string;
  matches: number | null;
}

export interface ControlNoteState {
  path: string | null;
  text: string;
}

export interface ControlTrustState {
  supported: boolean;
  enabled: boolean;
}

export interface ControlLivePreviewState {
  available: boolean;
  visible: boolean;
  split: number;
}

export interface ControlToolsState {
  busy: boolean;
  message: string;
  error: string;
}

export type ControlDomFrame = 'main' | 'preview' | 'browser';

export type ControlScreenshotTarget = 'screen' | 'app' | 'element' | 'rect';

export interface ControlScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ControlScreenshotOptions {
  target: ControlScreenshotTarget;
  output?: string;
  clipboard?: boolean;
  ref?: string;
  selector?: string;
  frame?: ControlDomFrame;
  rect?: ControlScreenRect;
}

export type ControlMenuKind = 'app' | 'document' | 'tab' | 'file' | 'selection';

export interface ControlMenuItem {
  index: number;
  id: string;
  label: string;
  shortcut?: string;
  separator?: boolean;
}

export interface ControlMenuState {
  open: boolean;
  kind: ControlMenuKind | null;
  title: string;
  x: number;
  y: number;
  path: string | null;
  directory: boolean | null;
  items: ControlMenuItem[];
}

export interface ControlStats {
  words: number | null;
  characters: number | null;
  minutes: number | null;
  bytes: number | null;
  pages: number | null;
}

/** State exposed to the control socket and `papyri ctl state`. */
export interface ControlState {
  protocol: number;
  active: string | null;
  secondary: string | null;
  tabs: ControlTab[];
  pdf: { path: string; page: number; total: number; locked: boolean } | null;
  view: {
    sidebar: boolean;
    outline: boolean;
    settings: boolean;
    palette: boolean;
    search: boolean;
    log: boolean;
    split: boolean;
    decorationless: boolean;
    query: string;
    rightTab: RightTab;
  };
  editor: ControlEditorState;
  explorer: ControlExplorerState;
  search: ControlSearchState;
  note: ControlNoteState;
  trust: ControlTrustState;
  browser: BrowserState | null;
  livePreview: ControlLivePreviewState;
  tools: ControlToolsState;
  stats: ControlStats;
  selection: { words: number; characters: number } | null;
  menu: ControlMenuState;
  recent: {
    files: string[];
    folders: { path: string; lastFile?: string }[];
    commands: string[];
  };
  preferences: Preferences;
  directory: string;
  source: { label: string; root: string; live: boolean } | null;
  busy: boolean;
  error: string | null;
}

export interface ControlTab {
  path: string;
  kind: 'markdown' | 'pdf' | 'typst-source' | 'latex-source' | 'bibliography';
  active: boolean;
  secondary: boolean;
  scroll: number;
  error: string | null;
}

export type ControlPane = 'main' | 'secondary';
export type ControlPanel =
  'sidebar' | 'outline' | 'settings' | 'palette' | 'search' | 'split' | 'log';
export type ToggleAction = 'on' | 'off' | 'toggle';

export type ScrollTarget = { y: number } | { dy: number } | { top: true } | { bottom: true };

export interface OpenOptions {
  pane: ControlPane;
  anchor?: string;
  directory?: boolean;
}

/** The host implements these actions; the control bridge only validates and dispatches. */
export interface ControlActions {
  state(): ControlState;
  headings(): unknown;
  commands(): unknown;
  open(path: string, options: OpenOptions): Promise<unknown>;
  close(path?: string): Promise<unknown>;
  focus(path: string): Promise<unknown>;
  tab(direction: 'next' | 'previous'): Promise<unknown>;
  activate(path: string): Promise<unknown>;
  closeTab(path?: string): Promise<unknown>;
  scroll(pane: ControlPane, target: ScrollTarget): Promise<unknown>;
  zoom(
    target: 'document' | 'ui',
    action?: 'in' | 'out' | 'reset',
    value?: number,
  ): Promise<unknown>;
  fitWidth(enabled?: boolean): Promise<unknown>;
  decorationless(enabled?: boolean): Promise<unknown>;
  theme(theme: 'latte' | 'mocha' | 'toggle'): Promise<unknown>;
  panel(name: ControlPanel, action: ToggleAction): Promise<unknown>;
  search(query: string): Promise<unknown>;
  searchNext(): Promise<unknown>;
  searchPrevious(): Promise<unknown>;
  heading(id: string): Promise<unknown>;
  page(page: number): Promise<unknown>;
  command(id: string): Promise<unknown>;
  preferences(patch: Record<string, unknown>): Promise<unknown>;
  refresh(): Promise<unknown>;
  latexStatus(): Promise<unknown>;
  latexCancel(path?: string): Promise<unknown>;
  editorOpen(): Promise<unknown>;
  editorClose(): Promise<unknown>;
  editorToggle(): Promise<unknown>;
  editorSave(): Promise<unknown>;
  editorReload(discard: boolean): Promise<unknown>;
  editorDiscard(): Promise<unknown>;
  editorGet(): Promise<unknown>;
  editorSet(text: string): Promise<unknown>;
  editorReveal(line: number, character: number): Promise<unknown>;
  editorSync(): Promise<unknown>;
  editorUndo(): Promise<unknown>;
  editorRedo(): Promise<unknown>;
  editorSelectAll(): Promise<unknown>;
  editorSelect(from: number, to: number): Promise<unknown>;
  editorCopy(): Promise<unknown>;
  editorCut(): Promise<unknown>;
  editorPaste(): Promise<unknown>;
  editorDiagnostics(): Promise<unknown>;
  explorerList(path?: string): Promise<unknown>;
  explorerCwd(path: string): Promise<unknown>;
  explorerExpand(path: string): Promise<unknown>;
  explorerCollapse(path: string): Promise<unknown>;
  explorerSelect(path: string): Promise<unknown>;
  explorerRead(path: string): Promise<unknown>;
  explorerCreate(directory: string, name: string, kind: ControlEntryKind): Promise<unknown>;
  explorerRename(path: string, name: string): Promise<unknown>;
  explorerDelete(path: string): Promise<unknown>;
  noteGet(): Promise<unknown>;
  noteSet(text: string): Promise<unknown>;
  trust(enabled?: boolean): Promise<unknown>;
  rightTab(tab: RightTab): Promise<unknown>;
  browserNavigate(target: string): Promise<unknown>;
  browserBack(): Promise<unknown>;
  browserForward(): Promise<unknown>;
  browserReload(): Promise<unknown>;
  browserStop(): Promise<unknown>;
  browserZoom(action: ControlBrowserZoom): Promise<unknown>;
  browserWindow(url?: string): Promise<unknown>;
  browserQuote(site: 'chatgpt' | 'wikipedia' | 'gemini', text: string): Promise<unknown>;
  browserSearch(text: string): Promise<unknown>;
  pdfPassword(password: string): Promise<unknown>;
  livePreview(enabled?: boolean): Promise<unknown>;
  livePreviewZoom(action: 'in' | 'out' | 'reset'): Promise<unknown>;
  livePreviewFit(): Promise<unknown>;
  livePreviewSplit(value: number): Promise<unknown>;
  selectionGet(): Promise<unknown>;
  selectionCopy(kind: ControlSelectionKind): Promise<unknown>;
  selectionSet(text: string): Promise<unknown>;
  selectionClear(): Promise<unknown>;
  toolsInstall(name: ControlToolName): Promise<unknown>;
  toolsTexlive(action: ControlTexliveAction): Promise<unknown>;
  documentCopyRaw(): Promise<unknown>;
  settingsTab(tab: ControlSettingsTab): Promise<unknown>;
  menuOpen(
    kind: ControlMenuKind,
    options: { path?: string; directory?: boolean; document?: boolean; x?: number; y?: number },
  ): Promise<unknown>;
  menuActivate(index: number): Promise<unknown>;
  menuClose(): Promise<unknown>;
  domQuery(options: {
    frame: ControlDomFrame;
    selector?: string;
    limit?: number;
    includeHidden?: boolean;
  }): Promise<unknown>;
  domGet(ref: string, frame: ControlDomFrame): Promise<unknown>;
  domFocus(ref: string, frame: ControlDomFrame): Promise<unknown>;
  domClick(ref: string, frame: ControlDomFrame): Promise<unknown>;
  domType(ref: string, text: string, frame: ControlDomFrame): Promise<unknown>;
  domAccessibility(frame: ControlDomFrame): Promise<unknown>;
  screenshot(options: ControlScreenshotOptions): Promise<unknown>;
  input(action: string, params: Record<string, unknown>): Promise<unknown>;
  clipboardRead(): Promise<unknown>;
  clipboardWrite(text: string): Promise<unknown>;
  clipboardReadImage(output?: string): Promise<unknown>;
  clipboardWriteImage(path: string): Promise<unknown>;
  windowList(): Promise<unknown>;
  windowFocus(id: string): Promise<unknown>;
  windowCapture(id: string, output?: string, clipboard?: boolean): Promise<unknown>;
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

const PANELS: ControlPanel[] = [
  'sidebar',
  'outline',
  'settings',
  'palette',
  'search',
  'split',
  'log',
];
const ACTIONS = ['on', 'off', 'toggle'] as const;
const PANES = ['main', 'secondary'] as const;
const ZOOM_TARGETS = ['document', 'ui'] as const;
const ZOOM_ACTIONS = ['in', 'out', 'reset'] as const;
const THEMES = ['latte', 'mocha', 'toggle'] as const;
const ENTRY_KINDS: ControlEntryKind[] = ['folder', 'markdown', 'typst', 'latex'];
const RIGHT_TABS: RightTab[] = ['outline', 'notes', 'chatgpt', 'wikipedia', 'gemini'];
const SITES = ['chatgpt', 'wikipedia', 'gemini'] as const;
const BROWSER_ZOOMS: ControlBrowserZoom[] = ['in', 'out', 'reset'];
const SELECTION_KINDS: ControlSelectionKind[] = ['source', 'text', 'quote'];
const TOOL_NAMES: ControlToolName[] = ['marksman', 'tinymist', 'texlab', 'typst'];
const TEXLIVE_ACTIONS: ControlTexliveAction[] = ['install', 'update'];
const SETTINGS_TABS: ControlSettingsTab[] = ['appearance', 'reading', 'documents', 'compilers'];
const MENU_KINDS: ControlMenuKind[] = ['app', 'document', 'tab', 'file', 'selection'];
const SCREENSHOT_TARGETS: ControlScreenshotTarget[] = ['screen', 'app', 'element', 'rect'];
const DOM_FRAMES: ControlDomFrame[] = ['main', 'preview', 'browser'];
const INPUT_ACTIONS = ['move', 'click', 'drag', 'scroll', 'key', 'type'] as const;

/** Validate a control request and invoke the corresponding host action. */
export function createControlExecutor(
  actions: ControlActions,
): (method: string, params: Record<string, unknown>) => Promise<unknown> {
  return async (method, rawParams) => {
    const params = requestObject(rawParams);
    switch (method) {
      case 'state':
        return actions.state();
      case 'headings':
        return actions.headings();
      case 'commands':
        return actions.commands();
      case 'open': {
        const path = requiredString(params, 'path');
        const pane = optionalEnum(params, 'pane', PANES, 'main');
        const anchor = optionalString(params, 'anchor');
        const directory = optionalBoolean(params, 'directory') ?? false;
        return actions.open(path, { pane, anchor, directory });
      }
      case 'close':
        return actions.close(optionalString(params, 'path'));
      case 'focus':
        return actions.focus(requiredString(params, 'path'));
      case 'tab.next':
        return actions.tab('next');
      case 'tab.previous':
        return actions.tab('previous');
      case 'tab.activate':
        return actions.activate(requiredString(params, 'path'));
      case 'tab.close':
        return actions.closeTab(optionalString(params, 'path'));
      case 'scroll.to':
        return actions.scroll(paneParameter(params), { y: requiredNumber(params, 'y') });
      case 'scroll.by':
        return actions.scroll(paneParameter(params), { dy: requiredNumber(params, 'dy') });
      case 'scroll.top':
        return actions.scroll(paneParameter(params), { top: true });
      case 'scroll.bottom':
        return actions.scroll(paneParameter(params), { bottom: true });
      case 'zoom': {
        const target = optionalEnum(params, 'target', ZOOM_TARGETS, 'document');
        const action = optionalEnum(params, 'action', ZOOM_ACTIONS, undefined);
        const value = optionalNumber(params, 'value');
        if (action === undefined && value === undefined)
          throw new Error('zoom needs an `action` or a `value`.');
        if (action !== undefined && value !== undefined)
          throw new Error('zoom accepts either an `action` or a `value`, not both.');
        return actions.zoom(target, action, value);
      }
      case 'fit-width':
        return actions.fitWidth(optionalBoolean(params, 'enabled'));
      case 'decorationless':
        return actions.decorationless(optionalBoolean(params, 'enabled'));
      case 'theme':
        return actions.theme(optionalEnum(params, 'theme', THEMES, 'toggle'));
      case 'panel':
        return actions.panel(
          requiredEnum(params, 'name', PANELS),
          optionalEnum(params, 'action', ACTIONS, 'toggle'),
        );
      case 'search':
        return actions.search(requiredString(params, 'query', true));
      case 'search.next':
        return actions.searchNext();
      case 'search.previous':
        return actions.searchPrevious();
      case 'heading':
        return actions.heading(requiredString(params, 'id'));
      case 'page': {
        const page = requiredNumber(params, 'page');
        if (!Number.isInteger(page) || page < 1)
          throw new Error('`page` must be a positive integer.');
        return actions.page(page);
      }
      case 'pdf.password':
        return actions.pdfPassword(requiredString(params, 'password', true));
      case 'command':
        return actions.command(requiredString(params, 'id'));
      case 'preferences.set': {
        const patch = params.patch;
        if (!patch || typeof patch !== 'object' || Array.isArray(patch))
          throw new Error('`patch` must be an object.');
        return actions.preferences(patch as Record<string, unknown>);
      }
      case 'refresh':
        return actions.refresh();
      case 'latex.status':
        return actions.latexStatus();
      case 'latex.cancel':
        return actions.latexCancel(optionalString(params, 'path'));
      case 'editor.open':
        return actions.editorOpen();
      case 'editor.close':
        return actions.editorClose();
      case 'editor.toggle':
        return actions.editorToggle();
      case 'editor.save':
        return actions.editorSave();
      case 'editor.reload':
        return actions.editorReload(optionalBoolean(params, 'discard') ?? false);
      case 'editor.discard':
        return actions.editorDiscard();
      case 'editor.get':
        return actions.editorGet();
      case 'editor.set':
        return actions.editorSet(requiredString(params, 'text', true));
      case 'editor.reveal':
        return actions.editorReveal(
          requiredInteger(params, 'line'),
          optionalInteger(params, 'character') ?? 0,
        );
      case 'editor.sync':
        return actions.editorSync();
      case 'editor.undo':
        return actions.editorUndo();
      case 'editor.redo':
        return actions.editorRedo();
      case 'editor.select-all':
        return actions.editorSelectAll();
      case 'editor.select':
        return actions.editorSelect(requiredInteger(params, 'from'), requiredInteger(params, 'to'));
      case 'editor.copy':
        return actions.editorCopy();
      case 'editor.cut':
        return actions.editorCut();
      case 'editor.paste':
        return actions.editorPaste();
      case 'editor.diagnostics':
        return actions.editorDiagnostics();
      case 'explorer.list':
        return actions.explorerList(optionalString(params, 'path'));
      case 'explorer.cwd':
        return actions.explorerCwd(requiredString(params, 'path'));
      case 'explorer.expand':
        return actions.explorerExpand(requiredString(params, 'path'));
      case 'explorer.collapse':
        return actions.explorerCollapse(requiredString(params, 'path'));
      case 'explorer.select':
        return actions.explorerSelect(requiredString(params, 'path'));
      case 'explorer.read':
        return actions.explorerRead(requiredString(params, 'path'));
      case 'explorer.create':
        return actions.explorerCreate(
          requiredString(params, 'directory'),
          requiredString(params, 'name'),
          requiredEnum(params, 'kind', ENTRY_KINDS),
        );
      case 'explorer.rename':
        return actions.explorerRename(
          requiredString(params, 'path'),
          requiredString(params, 'name'),
        );
      case 'explorer.delete':
        if (params.force !== true) throw new Error('Deleting a file requires `force: true`.');
        return actions.explorerDelete(requiredString(params, 'path'));
      case 'note.get':
        return actions.noteGet();
      case 'note.set':
        return actions.noteSet(requiredString(params, 'text', true));
      case 'trust':
        return actions.trust(optionalBoolean(params, 'enabled'));
      case 'right.tab':
        return actions.rightTab(requiredEnum(params, 'tab', RIGHT_TABS));
      case 'browser.navigate':
        return actions.browserNavigate(requiredString(params, 'target'));
      case 'browser.back':
        return actions.browserBack();
      case 'browser.forward':
        return actions.browserForward();
      case 'browser.reload':
        return actions.browserReload();
      case 'browser.stop':
        return actions.browserStop();
      case 'browser.zoom':
        return actions.browserZoom(requiredEnum(params, 'action', BROWSER_ZOOMS));
      case 'browser.window':
        return actions.browserWindow(optionalString(params, 'url'));
      case 'browser.quote':
        return actions.browserQuote(
          requiredEnum(params, 'site', SITES),
          requiredString(params, 'text', true),
        );
      case 'browser.search':
        return actions.browserSearch(requiredString(params, 'text', true));
      case 'live-preview':
        return actions.livePreview(optionalBoolean(params, 'enabled'));
      case 'live-preview.zoom':
        return actions.livePreviewZoom(requiredEnum(params, 'action', ZOOM_ACTIONS));
      case 'live-preview.fit':
        return actions.livePreviewFit();
      case 'live-preview.split': {
        const value = requiredNumber(params, 'value');
        if (value < 10 || value > 90) throw new Error('`value` must be between 10 and 90.');
        return actions.livePreviewSplit(value);
      }
      case 'selection.get':
        return actions.selectionGet();
      case 'selection.copy':
        return actions.selectionCopy(requiredEnum(params, 'kind', SELECTION_KINDS));
      case 'selection.set':
        return actions.selectionSet(requiredString(params, 'text'));
      case 'selection.clear':
        return actions.selectionClear();
      case 'tools.install':
        return actions.toolsInstall(requiredEnum(params, 'name', TOOL_NAMES));
      case 'tools.texlive':
        return actions.toolsTexlive(requiredEnum(params, 'action', TEXLIVE_ACTIONS));
      case 'document.copy':
        return actions.documentCopyRaw();
      case 'settings.tab':
        return actions.settingsTab(requiredEnum(params, 'tab', SETTINGS_TABS));
      case 'menu.open': {
        const kind = requiredEnum(params, 'kind', MENU_KINDS);
        const path = optionalString(params, 'path');
        if ((kind === 'tab' || kind === 'file') && !path)
          throw new Error(`menu.open ${kind} needs a \`path\`.`);
        return actions.menuOpen(kind, {
          path,
          directory: optionalBoolean(params, 'directory'),
          document: optionalBoolean(params, 'document'),
          x: optionalNumber(params, 'x'),
          y: optionalNumber(params, 'y'),
        });
      }
      case 'menu.activate':
        return actions.menuActivate(requiredInteger(params, 'index'));
      case 'menu.close':
        return actions.menuClose();
      case 'dom.query':
        return actions.domQuery({
          frame: optionalEnum(params, 'frame', DOM_FRAMES, 'main'),
          selector: optionalString(params, 'selector'),
          limit: optionalInteger(params, 'limit'),
          includeHidden: optionalBoolean(params, 'includeHidden') ?? false,
        });
      case 'dom.get':
        return actions.domGet(
          requiredString(params, 'ref'),
          optionalEnum(params, 'frame', DOM_FRAMES, 'main'),
        );
      case 'dom.focus':
        return actions.domFocus(
          requiredString(params, 'ref'),
          optionalEnum(params, 'frame', DOM_FRAMES, 'main'),
        );
      case 'dom.click':
        return actions.domClick(
          requiredString(params, 'ref'),
          optionalEnum(params, 'frame', DOM_FRAMES, 'main'),
        );
      case 'dom.type':
        return actions.domType(
          requiredString(params, 'ref'),
          requiredString(params, 'text', true),
          optionalEnum(params, 'frame', DOM_FRAMES, 'main'),
        );
      case 'dom.ax':
        return actions.domAccessibility(optionalEnum(params, 'frame', DOM_FRAMES, 'main'));
      case 'input.move':
      case 'input.click':
      case 'input.drag':
      case 'input.scroll':
      case 'input.key':
      case 'input.type': {
        const action = method.slice('input.'.length);
        const paramsOut: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(params)) paramsOut[key] = value;
        if (!INPUT_ACTIONS.includes(action as (typeof INPUT_ACTIONS)[number]))
          throw new Error(`Unknown input action: ${action}`);
        return actions.input(action, paramsOut);
      }
      case 'clipboard.get':
        return actions.clipboardRead();
      case 'clipboard.set':
        return actions.clipboardWrite(requiredString(params, 'text', true));
      case 'clipboard.get-image':
        return actions.clipboardReadImage(optionalString(params, 'output'));
      case 'clipboard.set-image':
        return actions.clipboardWriteImage(requiredString(params, 'path'));
      case 'window.list':
        return actions.windowList();
      case 'window.focus':
        return actions.windowFocus(requiredString(params, 'id'));
      case 'wait.selector':
        return actions.waitSelector(
          requiredString(params, 'selector'),
          optionalEnum(params, 'frame', DOM_FRAMES, 'main'),
          optionalInteger(params, 'timeoutMs') ?? 30_000,
        );
      case 'wait.idle':
        return actions.waitIdle(optionalInteger(params, 'timeoutMs') ?? 30_000);
      case 'record': {
        const count = requiredInteger(params, 'count');
        const intervalMs = requiredInteger(params, 'intervalMs');
        const target = requiredEnum(params, 'target', ['screen', 'app']);
        if (count < 1 || count > 300) throw new Error('`count` must be between 1 and 300.');
        if (intervalMs < 100 || intervalMs > 60_000)
          throw new Error('`intervalMs` must be between 100 and 60000.');
        return actions.recordFrames({
          count,
          intervalMs,
          target,
          outputDir: requiredString(params, 'outputDir'),
        });
      }
      case 'wait.state':
        if (!('equals' in params)) throw new Error('`equals` is required.');
        return actions.waitState(
          requiredString(params, 'path'),
          params.equals,
          optionalInteger(params, 'timeoutMs') ?? 30_000,
        );
      case 'window.capture': {
        const id = requiredString(params, 'id');
        return actions.windowCapture(
          id,
          optionalString(params, 'output'),
          optionalBoolean(params, 'clipboard') ?? false,
        );
      }
      case 'screenshot': {
        const target = requiredEnum(params, 'target', SCREENSHOT_TARGETS);
        const output = optionalString(params, 'output');
        const clipboard = optionalBoolean(params, 'clipboard') ?? false;
        const ref = optionalString(params, 'ref');
        const selector = optionalString(params, 'selector');
        const frame = optionalEnum(params, 'frame', DOM_FRAMES, 'main');
        if (target === 'element' && !ref && !selector)
          throw new Error('Element screenshots need a ref or selector.');
        let rect: ControlScreenRect | undefined;
        if (target === 'rect') {
          rect = {
            x: requiredNumber(params, 'x'),
            y: requiredNumber(params, 'y'),
            width: requiredNumber(params, 'width'),
            height: requiredNumber(params, 'height'),
          };
          if (rect.width <= 0 || rect.height <= 0)
            throw new Error('Screenshot rectangle width and height must be positive.');
        }
        return actions.screenshot({
          target,
          output,
          clipboard,
          ref,
          selector,
          frame,
          rect,
        });
      }
      default:
        throw new Error(`Unknown control method: ${method}`);
    }
  };
}

function paneParameter(params: Record<string, unknown>): ControlPane {
  return optionalEnum(params, 'pane', PANES, 'main');
}

function requestObject(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value))
    throw new Error('Control parameters must be an object.');
  return value as Record<string, unknown>;
}

function requiredString(params: Record<string, unknown>, key: string, allowEmpty = false): string {
  const value = params[key];
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()))
    throw new Error(`\`${key}\` must be a ${allowEmpty ? 'string' : 'non-empty string'}.`);
  return value;
}

function optionalString(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error(`\`${key}\` must be a string.`);
  return value;
}

function requiredNumber(params: Record<string, unknown>, key: string): number {
  const value = params[key];
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`\`${key}\` must be a finite number.`);
  return value;
}

function optionalNumber(params: Record<string, unknown>, key: string): number | undefined {
  const value = params[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`\`${key}\` must be a finite number.`);
  return value;
}

function requiredInteger(params: Record<string, unknown>, key: string): number {
  const value = requiredNumber(params, key);
  if (!Number.isInteger(value) || value < 0)
    throw new Error(`\`${key}\` must be a non-negative integer.`);
  return value;
}

function optionalInteger(params: Record<string, unknown>, key: string): number | undefined {
  const value = optionalNumber(params, key);
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 0)
    throw new Error(`\`${key}\` must be a non-negative integer.`);
  return value;
}

function optionalBoolean(params: Record<string, unknown>, key: string): boolean | undefined {
  const value = params[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw new Error(`\`${key}\` must be a boolean.`);
  return value;
}

function requiredEnum<T extends string>(
  params: Record<string, unknown>,
  key: string,
  values: readonly T[],
): T {
  const value = params[key];
  if (typeof value !== 'string' || !values.includes(value as T))
    throw new Error(`\`${key}\` must be one of: ${values.join(', ')}.`);
  return value as T;
}

function optionalEnum<T extends string>(
  params: Record<string, unknown>,
  key: string,
  values: readonly T[],
  fallback: T,
): T;
function optionalEnum<T extends string>(
  params: Record<string, unknown>,
  key: string,
  values: readonly T[],
  fallback: undefined,
): T | undefined;
function optionalEnum<T extends string>(
  params: Record<string, unknown>,
  key: string,
  values: readonly T[],
  fallback: T | undefined,
): T | undefined {
  const value = params[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string' || !values.includes(value as T))
    throw new Error(`\`${key}\` must be one of: ${values.join(', ')}.`);
  return value as T;
}

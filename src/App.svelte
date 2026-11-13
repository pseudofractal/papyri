<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import DOMPurify from 'dompurify';
  import 'katex/dist/katex.min.css';
  import { openDialog } from './lib/dialog';
  import {
    FolderOpen,
    Search,
    Settings as SettingsIcon,
    PanelLeft,
    PanelRight,
    Columns2,
    X,
    ChevronRight,
    ArrowUp,
    RefreshCw,
    Shield,
    FileText,
    CircleHelp,
    Maximize2,
    Copy,
    Check,
    History,
    Code,
    Type as TypeIcon,
    TextQuote,
    Save,
    Plus,
    FolderPlus,
    FilePlus2,
    FolderSearch,
    Clipboard,
    Link2,
    Pencil,
    Trash2,
    ExternalLink,
    SquareTerminal,
  } from '@lucide/svelte';
  import ZoomControls from './components/ZoomControls.svelte';
  import SidebarResize from './components/SidebarResize.svelte';
  import EditorSplitHandle from './components/EditorSplitHandle.svelte';
  import SidePanel from './components/SidePanel.svelte';
  import SiteIcon from './components/SiteIcon.svelte';
  import {
    changeZoom,
    viewShortcut,
    MIN_SIDEBAR_WIDTH,
    MAX_SIDEBAR_WIDTH,
    MIN_BROWSER_WIDTH,
    MAX_BROWSER_WIDTH,
    MIN_PDF_ZOOM,
    MAX_PDF_ZOOM,
    MIN_ZOOM,
    MAX_ZOOM,
    NARROW_VIEWPORT,
    clampZoom,
    type ZoomCommand,
    type ViewCommand,
  } from './lib/view';
  import Explorer from './components/Explorer.svelte';
  import FileIcon from './components/FileIcon.svelte';
  import CreateEntry from './components/CreateEntry.svelte';
  import { readExplorerState, writeExplorerState, type ExplorerState } from './lib/explorer-state';
  import { listDirectory } from './lib/directories';
  import Preview from './components/Preview.svelte';
  import BibliographyView from './components/BibliographyView.svelte';
  import LatexLivePreview from './components/LatexLivePreview.svelte';
  import { EditorDraft } from './lib/editor-draft';
  import { loadLatexProject, type LatexProjectMetadata } from './lib/latex-project';
  import type { PreviewLocation } from './lib/typst-live-preview';
  import Settings from './components/Settings.svelte';
  import CompileLog from './components/CompileLog.svelte';
  import CommandPalette from './components/CommandPalette.svelte';
  import { invokeHost } from './lib/native';
  import { SITES, isSiteTab, type RightTab, type SiteId } from './lib/sites';
  import {
    browserAvailable,
    browserBack,
    browserForward,
    browserNavigate,
    browserOpenWindow,
    browserReload,
    browserSetZoom,
    browserQuote,
    browserSearchWikipedia,
    browserSelect,
    browserSetVisible,
    browserStop,
    browserTarget,
    emptyBrowserState,
    listenBrowser,
    type BrowserState,
  } from './lib/browser';
  import { Workspace } from './lib/workspace.svelte';
  import { desktop, desktopSource, importedSource, browserDirectory } from './lib/sources';
  import { demoSource } from './lib/demo';
  import {
    loadPreferences,
    mergePreferences,
    withoutConfiguredPreferences,
  } from './lib/preferences';
  import {
    loadRecentFolders,
    persistRecentFolders,
    rememberRecentFolder,
    startupRecentProject,
    type RecentFolder,
  } from './lib/recent';
  import { traceStartup } from './lib/startup-trace';
  import {
    basename,
    dirname,
    isDocument,
    isMarkdown,
    isPdf,
    isTypst,
    isLatex,
    isBibliography,
    isRootPath,
    normalize,
    displayPath,
    displayPathMessage,
    expandHomePath,
    relativeProjectPath,
    resolveLink,
  } from './lib/paths';
  import type { Heading, LatexEngine, Preferences, Source } from './lib/types';
  import type { LspDiagnostic } from './lib/editor-lsp';
  import { buildFailureFromLspDiagnostics, type BuildFailure } from './lib/build-diagnostics';
  import type { PaletteCommand } from './lib/palette';
  import { createControlExecutor, type ControlState } from './lib/control';
  import type {
    ControlEditorState,
    ControlEntryKind,
    ControlMenuKind,
    ControlMenuState,
    ControlSettingsTab,
    ControlToolName,
    ControlTexliveAction,
  } from './lib/control';
  import { installControl, markControlReady, publishControlEvent } from './lib/control-host';
  import { buildControlState } from './lib/control-state';
  import { CONTROL_PUBLISH_INTERVAL_MS } from './lib/control-timings';
  import type { PreviewControls } from './lib/preview-control';
  import { createControlActions, type ControlViewState } from './lib/control-actions';
  const workspace = new Workspace();
  const startsDecorationless =
    (window as unknown as { __PAPYRI_DECORATIONLESS__?: boolean }).__PAPYRI_DECORATIONLESS__ ===
    true;
  let savedPreferences = loadPreferences();
  let preferences = $state(structuredClone(savedPreferences));
  let configuredPreferences: Record<string, unknown> = {};
  let sidebar = $state(window.innerWidth >= NARROW_VIEWPORT);
  let outline = $state(window.innerWidth >= 1100);
  let rightTab = $state<RightTab>('outline');
  let browser = $state<BrowserState>({ ...emptyBrowserState, url: '' });
  let recentOpen = $state(false);
  let createTarget = $state.raw<{
    source: Source;
    directory: string;
    initialKind?: 'folder' | 'markdown';
  } | null>(null);
  let explorerState = $state.raw<ExplorerState>({ workingDirectory: '/', expanded: [] });
  let renamePath = $state('');
  let renameBusy = $state(false);
  let explorerSelection = $state('');
  $effect(() => {
    const root = workspace.directory;
    const source = workspace.source;
    explorerState =
      desktop && source?.create
        ? readExplorerState(root, localStorage)
        : { workingDirectory: root, expanded: [] };
    explorerSelection = '';
  });
  function updateExplorerState(state: ExplorerState) {
    explorerState = state;
    if (desktop && workspace.source?.create) {
      try {
        writeExplorerState(workspace.directory, state, localStorage);
      } catch {
        workspace.error = 'Explorer navigation could not be saved.';
      }
    }
  }
  function toggleExplorerFolder(path: string) {
    const expanded = explorerState.expanded.includes(path)
      ? explorerState.expanded.filter((item) => item !== path)
      : [...explorerState.expanded, path];
    updateExplorerState({ workingDirectory: path, expanded });
  }
  async function renameExplorerFile(path: string, name: string, strict = false) {
    const source = workspace.source;
    if (!source?.rename || renameBusy) {
      if (strict) throw new Error('This source cannot rename files right now.');
      return path;
    }
    if (editorBusy || workspace.busy) {
      if (strict) throw new Error('Wait for the current document operation before renaming.');
      workspace.error = 'Wait for the current document operation before renaming.';
      return path;
    }
    renameBusy = true;
    try {
      const next = await source.rename(path, name);
      if (workspace.source !== source) return path;
      if (next === path) {
        renamePath = '';
        return path;
      }
      const sourceDrafts = drafts.get(source);
      const previousDraft = sourceDrafts?.get(path);
      if (previousDraft && next !== path) {
        const replacement = new EditorDraft(
          next,
          previousDraft.expectedText,
          previousDraft.expectedStamp,
        );
        replacement.text = previousDraft.text;
        sourceDrafts!.delete(path);
        sourceDrafts!.set(next, replacement);
        if (editorDraft === previousDraft) editorDraft = replacement;
      }
      for (const tab of workspace.tabs) if (tab.path === path) tab.path = next;
      if (workspace.active === path) workspace.active = next;
      if (workspace.secondary === path) workspace.secondary = next;
      workspace.recentFiles = workspace.recentFiles.map((item) => (item === path ? next : item));
      recentFolders = recentFolders.map((folder) =>
        folder.lastFile === path ? { ...folder, lastFile: next } : folder,
      );
      persistRecentFolders(recentFolders);
      if (headingsPath === path) headingsPath = next;
      if (explorerSelection === path) explorerSelection = next;
      if (path in workspace.secondaryScroll) {
        workspace.secondaryScroll[next] = workspace.secondaryScroll[path];
        delete workspace.secondaryScroll[path];
      }
      const session = typstPreviewSessions.get(path);
      if (session) {
        typstPreviewSessions.delete(path);
        typstPreviewSessions.set(next, session);
      }
      for (const paths of typstPreviewSessions.values()) if (paths.delete(path)) paths.add(next);
      if (typstPreviewRoot === path) typstPreviewRoot = next;
      if (latexPreviewRoot === path) latexPreviewRoot = next;
      if (trustedPath === path) trustedPath = '';
      workspace.treeRevision++;
      editorRevision++;
      renamePath = '';
      return next;
    } catch (error) {
      if (strict) throw error;
      workspace.error = `Could not rename file: ${String(error)}`;
      return path;
    } finally {
      renameBusy = false;
    }
  }
  let copyState = $state<'idle' | 'copied' | 'error'>('idle');
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  let settings = $state(false);
  let compileLogOpen = $state(false);
  let help = $state(false);
  let searchOpen = $state(false);
  let paletteOpen = $state(false);
  let decorationless = $state(startsDecorationless);
  let query = $state('');
  $effect(() => {
    if (workspace.active) return;
    searchOpen = false;
    query = '';
  });
  let pathInput = $derived(displayPath(workspace.directory));
  let headings = $state<Heading[]>([]);
  let headingsPath = $state('');
  let recentCommands = $state<string[]>([]);
  let recentFolders = $state<RecentFolder[]>(loadRecentFolders());
  let pdfPage = $state({ path: '', page: 0, total: 0 });
  let trustedPath = $state('');
  let trustedRevision = $state(-1);
  let trustedSource = $state.raw<Source | null>(null);
  let trustDialog = $state(false);
  let fileInput: HTMLInputElement;
  let folderInput: HTMLInputElement;
  let searchInput = $state<HTMLInputElement>();
  let refreshing = false;
  let viewportWidth = $state(window.innerWidth);
  let viewportHeight = $state(window.innerHeight);
  let selectionMenu = $state<{
    text: string;
    source: string;
    preview: string;
    x: number;
    y: number;
  } | null>(null);
  let previewSource = $state(false);
  let previewPinned = $state(false);
  type ContextMenuTarget =
    | { kind: 'app' }
    | { kind: 'document' }
    | { kind: 'tab'; path: string }
    | { kind: 'file'; path: string; directory: boolean; document: boolean };
  type ContextMenuEntry =
    { label: string; shortcut?: string; run: () => void } | { separator: true };
  let contextMenu = $state<{
    x: number;
    y: number;
    target: ContextMenuTarget;
  } | null>(null);
  let selectionStats = $state<{ words: number; characters: number } | null>(null);
  let searchMatches = $state<number | null>(null);
  let pdfLocked = $state(false);
  let toolBusy = $state(false);
  let toolMessage = $state('');
  let toolError = $state('');
  let primaryPreview = $state<
    PreviewControls & {
      requestSelection: () => Promise<{ text: string; source: string; preview: string }>;
      dom: (action: string, params?: Record<string, unknown>) => Promise<unknown>;
      frameRect: () => { x: number; y: number; width: number; height: number } | null;
      selectText: (text: string) => Promise<boolean>;
      clearSelection: () => Promise<void>;
      searchNext: (previous?: boolean) => void;
      unlockPdf: (password: string) => void;
    }
  >();
  let secondaryPreview = $state<PreviewControls>();
  const drafts = new Map<Source, Map<string, EditorDraft>>();
  let editorDraft = $state.raw<EditorDraft | null>(null);
  let SourceEditor = $state.raw<typeof import('./components/SourceEditor.svelte').default>();
  let TypstLivePreview =
    $state.raw<typeof import('./components/TypstLivePreview.svelte').default>();
  let sourceEditor = $state<{
    reveal: (line: number, character: number) => void;
    getState: () => {
      cursor: { line: number; character: number };
      selection: {
        from: number;
        to: number;
        line: number;
        character: number;
        text: string;
      } | null;
      diagnostics: {
        path: string;
        line: number;
        character: number;
        endLine: number;
        endCharacter: number;
        severity: 1 | 2 | 3 | 4;
        message: string;
        source?: string;
      }[];
    } | null;
    setText: (text: string) => void;
    undoEdit: () => void;
    redoEdit: () => void;
    selectAllText: () => void;
    selectRange: (from: number, to: number) => void;
    deleteSelection: () => void;
    replaceSelection: (text: string) => void;
  }>();
  let editorServerStatus = $state('');
  let editorDiagnostics = $state<LspDiagnostic[]>([]);
  let latexEditorFailure = $state<BuildFailure | null>(null);
  let latexProjectMetadata = $state.raw<LatexProjectMetadata | undefined>(undefined);
  let latexProjectRevision = 0;
  let sidePanel = $state<{ setNote: (value: string) => void }>();
  let settingsPanel = $state<{ showTab: (tab: ControlSettingsTab) => void }>();
  let typstPreview = $state<{
    updateDocument: (path: string, text: string) => void;
    reveal: (path: string, line: number, character: number) => void;
    zoomBy: (action: 'in' | 'out') => void;
    fit: () => void;
  }>();
  let typstPreviewRoot = $state('');
  let latexPreviewRoot = $state('');
  let latexPreview = $state<{ reveal: (path: string, line: number) => void }>();
  let markdownPreview = $state<{ revealSource: (line: number) => void }>();
  let markdownPreviewText = $state('');
  let markdownPreviewScroll = $state(0);
  let markdownUpdateTimer: ReturnType<typeof setTimeout> | undefined;
  let typstLiveVisible = $state(true);
  let typstSourceShare = $state(50);
  const typstPreviewSessions = new Map<string, Set<string>>();
  let typstPreviewPaths = new Set<string>();
  let previewJumpRequest = 0;
  let editorSource = $state.raw<Source | null>(null);
  let editing = $state(false);
  $effect(() => {
    if (!editing) {
      if (editorDiagnostics.length) editorDiagnostics = [];
      if (latexEditorFailure) latexEditorFailure = null;
    }
  });
  let editorBusy = $state(false);
  let editorRevision = $state(0);
  let editorInstanceRevision = $state(0);
  let editorError = $state('');
  workspace.canClose = (path) => {
    const source = workspace.source;
    const sourceDrafts = source && drafts.get(source);
    const session = typstPreviewSessions.get(path);
    const paths = session ? [...session] : [path];
    if (editorBusy && editorDraft && paths.includes(editorDraft.path)) return false;
    if (
      paths.some((item) => sourceDrafts?.get(item)?.dirty) &&
      !window.confirm(`Discard unsaved changes associated with ${basename(path)}?`)
    )
      return false;
    typstPreviewSessions.delete(path);
    for (const item of paths) {
      const usedByAnotherSession = [...typstPreviewSessions.values()].some((other) =>
        other.has(item),
      );
      const openInAnotherTab = item !== path && workspace.tabs.some((tab) => tab.path === item);
      if (!usedByAnotherSession && !openInAnotherTab) sourceDrafts?.delete(item);
    }
    if (path === typstPreviewRoot) {
      typstPreviewRoot = '';
      typstPreviewPaths = new Set();
      previewJumpRequest++;
    }
    if (path === latexPreviewRoot) latexPreviewRoot = '';
    if (
      editorDraft &&
      (editorDraft.path === path ||
        (session && editorSource === source && workspace.active === path))
    ) {
      editorDraft = null;
      editorSource = null;
      editing = false;
    }
    return true;
  };
  workspace.canChangeSource = () => {
    if (editorBusy) return false;
    const source = workspace.source;
    const pending =
      source && [...(drafts.get(source)?.values() ?? [])].some((draft) => draft.dirty);
    if (pending && !window.confirm('Discard unsaved changes before switching folders?'))
      return false;
    if (source) drafts.delete(source);
    editorDraft = null;
    editorSource = null;
    editing = false;
    typstPreviewRoot = '';
    latexPreviewRoot = '';
    typstPreviewSessions.clear();
    typstPreviewPaths = new Set();
    previewJumpRequest++;
    return true;
  };
  const hasCompilableTab = $derived(
    workspace.tabs.some((tab) => isLatex(tab.path) || isTypst(tab.path)),
  );
  const hasCompilableContext = $derived(
    hasCompilableTab ||
      (workspace.busy && (isLatex(workspace.openingPath) || isTypst(workspace.openingPath))),
  );
  $effect(() => {
    if (compileLogOpen && !hasCompilableContext) compileLogOpen = false;
  });
  const editorVisible = $derived(
    editing &&
      editorSource === workspace.source &&
      (editorDraft?.path === workspace.active ||
        ((typstPreviewRoot === workspace.active || latexPreviewRoot === workspace.active) &&
          !!editorDraft)),
  );
  const editorText = $derived.by(() => {
    void editorRevision;
    return editorDraft?.text ?? '';
  });
  const latexOverlays = $derived.by(() => {
    void editorRevision;
    const sourceDrafts = editorSource && drafts.get(editorSource);
    return [...typstPreviewPaths].flatMap((path) => {
      const draft = sourceDrafts?.get(path);
      return draft && draft.dirty && path !== latexPreviewRoot
        ? [[path, draft.text] as [string, string]]
        : [];
    });
  });
  const editorDirty = $derived.by(() => {
    void editorRevision;
    return editorDraft?.dirty ?? false;
  });
  const editorLanguage = $derived(
    isTypst(workspace.active) ? 'typst' : isLatex(workspace.active) ? 'latex' : 'markdown',
  );
  const languageServerRoot = $derived(
    workspace.directory && workspace.directory !== '/' ? workspace.directory : undefined,
  );
  const editorBuildFailure = $derived(
    editorLanguage === 'typst'
      ? buildFailureFromLspDiagnostics(
          editorDiagnostics,
          'typst',
          editorDraft?.path ?? workspace.active,
        )
      : latexEditorFailure,
  );

  async function openEditor() {
    const source = workspace.source;
    const path = workspace.active;
    if (!source || !path || isPdf(path) || isBibliography(path) || !source.write || editorBusy)
      return;
    editorBusy = true;
    editorError = '';
    editorDiagnostics = [];
    latexEditorFailure = null;
    try {
      SourceEditor ??= (await import('./components/SourceEditor.svelte')).default;
      if (desktop && isTypst(path))
        TypstLivePreview ??= (await import('./components/TypstLivePreview.svelte')).default;
      if (workspace.source !== source || workspace.active !== path) return;
      let sourceDrafts = drafts.get(source);
      if (!sourceDrafts) {
        sourceDrafts = new Map();
        drafts.set(source, sourceDrafts);
      }
      let draft = sourceDrafts.get(path);
      if (!draft) {
        const file = await (source.readSource ?? source.read)(path);
        if (workspace.source !== source || workspace.active !== path) return;
        draft = new EditorDraft(path, file.text, file.stamp);
        sourceDrafts.set(path, draft);
      }
      editorSource = source;
      editorDraft = draft;
      clearTimeout(markdownUpdateTimer);
      markdownPreviewText = draft.text;
      markdownPreviewScroll = 0;
      if (desktop && isTypst(path)) {
        typstPreviewPaths = typstPreviewSessions.get(path) ?? new Set([path]);
        typstPreviewSessions.set(path, typstPreviewPaths);
        typstPreviewRoot = path;
      } else {
        typstPreviewRoot = '';
        typstPreviewPaths = new Set();
      }
      latexPreviewRoot = desktop && isLatex(path) ? path : '';
      if (latexPreviewRoot) {
        typstPreviewPaths = typstPreviewSessions.get(path) ?? new Set([path]);
        typstPreviewSessions.set(path, typstPreviewPaths);
      }
      editorRevision++;
      editing = true;
    } catch (error) {
      editorError = String(error);
    } finally {
      editorBusy = false;
    }
  }

  async function refreshLatexProjectMetadata() {
    const bibliography = isBibliography(workspace.active);
    const source = bibliography ? workspace.source : editorSource;
    const draft = bibliography ? null : editorDraft;
    const path = bibliography ? workspace.active : draft?.path;
    if (
      !source ||
      !path ||
      (!bibliography && (editorLanguage !== 'latex' || !editorVisible || !draft))
    ) {
      latexProjectMetadata = undefined;
      return;
    }
    const projectRoot = bibliography
      ? workspace.directory && workspace.directory !== '/'
        ? workspace.directory
        : dirname(path)
      : (languageServerRoot ?? dirname(path));
    const revision = ++latexProjectRevision;
    latexProjectMetadata = undefined;
    try {
      const metadata = await loadLatexProject(source, projectRoot, {
        draftText: (projectPath) => drafts.get(source)?.get(projectPath)?.text,
      });
      if (
        revision === latexProjectRevision &&
        (bibliography
          ? workspace.active === path
          : editorSource === source && editorDraft?.path === draft?.path)
      ) {
        latexProjectMetadata = metadata;
      }
    } catch (error) {
      console.warn('Could not load LaTeX project metadata:', error);
    }
  }

  $effect(() => {
    void refreshLatexProjectMetadata();
  });

  function updateEditor(text: string) {
    if (!editorDraft) return;
    editorDraft.text = text;
    typstPreview?.updateDocument(editorDraft.path, text);
    if (editorLanguage === 'markdown') {
      clearTimeout(markdownUpdateTimer);
      markdownUpdateTimer = setTimeout(() => (markdownPreviewText = text), 250);
    }
    editorRevision++;
  }
  function syncSourcePosition(line: number, character: number) {
    if (!editorDraft) return;
    if (editorLanguage === 'markdown') markdownPreview?.revealSource(line);
    else if (editorLanguage === 'latex') latexPreview?.reveal(editorDraft.path, line);
    else typstPreview?.reveal(editorDraft.path, line, character);
  }

  function typstDocuments() {
    const sourceDrafts = editorSource && drafts.get(editorSource);
    return [...typstPreviewPaths].flatMap((path) => {
      const draft = sourceDrafts?.get(path);
      return draft ? [{ path, text: draft.text }] : [];
    });
  }

  async function openPreviewSource(location: PreviewLocation) {
    const source = editorSource;
    const root = typstPreviewRoot || latexPreviewRoot;
    if (!source || !root || workspace.active !== root || !editing) return;
    const request = ++previewJumpRequest;
    try {
      let sourceDrafts = drafts.get(source);
      if (!sourceDrafts) {
        sourceDrafts = new Map();
        drafts.set(source, sourceDrafts);
      }
      let draft = sourceDrafts.get(location.path);
      if (!draft) {
        const file = await (source.readSource ?? source.read)(location.path);
        if (request !== previewJumpRequest || workspace.active !== root || editorSource !== source)
          return;
        draft = new EditorDraft(location.path, file.text, file.stamp);
        sourceDrafts.set(location.path, draft);
      }
      typstPreviewPaths.add(location.path);
      editorDraft = draft;
      editorRevision++;
      typstPreview?.updateDocument(location.path, draft.text);
      await tick();
      if (request === previewJumpRequest && editorDraft === draft)
        sourceEditor?.reveal(location.line, location.character);
    } catch (error) {
      if (request === previewJumpRequest) editorError = `Could not open source: ${String(error)}`;
    }
  }

  async function reloadEditor(force = false) {
    if (!editorDraft || !editorSource || editorBusy) return;
    if (
      editorDraft.dirty &&
      !force &&
      !window.confirm('Discard unsaved changes and reload the source?')
    )
      return;
    const source = editorSource;
    const path = editorDraft.path;
    editorBusy = true;
    try {
      const file = await (source.readSource ?? source.read)(path);
      if (editorSource !== source || editorDraft?.path !== path) return;
      const draft = new EditorDraft(path, file.text, file.stamp);
      drafts.get(source)?.set(path, draft);
      clearTimeout(markdownUpdateTimer);
      markdownPreviewText = draft.text;
      editorDraft = draft;
      editorInstanceRevision++;
      editorRevision++;
      typstPreview?.updateDocument(path, draft.text);
    } catch (error) {
      editorError = String(error);
    } finally {
      editorBusy = false;
    }
  }
  async function saveEditor() {
    const draft = editorDraft;
    const source = editorSource;
    if (!draft || !source?.write || editorBusy || !draft.dirty) return;
    const text = draft.text;
    editorBusy = true;
    editorError = '';
    try {
      const saved = await source.write(draft.path, text, {
        text: draft.expectedText,
        stamp: draft.expectedStamp,
      });
      draft.saved(text, saved.stamp);
      editorRevision++;
      if (workspace.source === source) await workspace.refresh();
      void refreshLatexProjectMetadata();
    } catch (error) {
      editorError = String(error);
    } finally {
      editorBusy = false;
    }
  }
  let resolveWorkspaceReady = () => {};
  const workspaceReady = new Promise<void>((resolve) => {
    resolveWorkspaceReady = resolve;
  });
  const uiScale = $derived(preferences.uiZoom / 100);
  const pagedDocument = $derived(!!workspace.activeTab?.bytes);
  const layoutWidth = $derived(viewportWidth / uiScale);
  const MIN_DOCUMENT_WIDTH = 420;
  const MIN_HEADER_BRAND_WIDTH = 320;
  const PANEL_VIEWPORT_FRACTION = 0.95;
  const maximumSidebarWidth = $derived(
    Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, layoutWidth * PANEL_VIEWPORT_FRACTION)),
  );
  const sidebarWidth = $derived(Math.min(preferences.sidebarWidth, maximumSidebarWidth));
  const maximumBrowserWidth = $derived(
    Math.max(MIN_BROWSER_WIDTH, Math.min(MAX_BROWSER_WIDTH, layoutWidth * PANEL_VIEWPORT_FRACTION)),
  );
  const browserWidth = $derived(Math.min(preferences.browserWidth, maximumBrowserWidth));
  const panelWidth = $derived(browserWidth);
  const browserVisible = $derived(
    !settings && !help && !trustDialog && !paletteOpen && !compileLogOpen && !decorationless,
  );
  let previousLayoutWidth: number | undefined;
  $effect(() => {
    const width = layoutWidth;
    const previous = previousLayoutWidth;
    previousLayoutWidth = width;
    const narrowed = previous !== undefined && width < previous;
    if (!narrowed || !sidebar || !outline) return;
    const sidebarPreference = untrack(() => preferences.sidebarWidth);
    const panelWidth = untrack(() => browserWidth);
    if (width - sidebarPreference - panelWidth < MIN_DOCUMENT_WIDTH) sidebar = false;
  });
  const canCopyRaw = $derived(!!workspace.activeTab && !workspace.activeTab.bytes);
  const documentStats = $derived.by(() => {
    const tab = workspace.activeTab;
    if (!tab) return null;
    if (tab.bytes)
      return {
        words: null,
        characters: null,
        minutes: null,
        bytes: tab.bytes.length,
        pages: pdfPage.path === tab.path ? pdfPage.total : 0,
      };
    const words = tab.text.trim() ? tab.text.trim().split(/\s+/).filter(Boolean).length : 0;
    return {
      words,
      characters: tab.text.length,
      minutes: Math.max(1, Math.round(words / 250)),
      bytes: null,
      pages: null,
    };
  });
  const liveStatus = $derived(
    workspace.busy
      ? 'Opening…'
      : workspace.source?.live
        ? `${workspace.source.label} · Live · checks every 2s`
        : 'Snapshot · import again to update',
  );
  let activeScrollProgress = $state<{ path: string; value: number }>({ path: '', value: 0 });
  const documentProgress = $derived(
    activeScrollProgress.path === workspace.active ? activeScrollProgress.value : 0,
  );
  const progressPercent = $derived(Math.round(documentProgress * 100));
  const refreshLabel = $derived(
    workspace.busy
      ? 'Opening…'
      : workspace.source?.live
        ? '2s'
        : workspace.source
          ? 'Snapshot'
          : '—',
  );
  const showProgress = $derived(!!workspace.active && !editorVisible && !workspace.busy);
  $effect(() => {
    if (!browserAvailable() || (outline && isSiteTab(rightTab))) return;
    void browserSetVisible(false).catch(() => {});
  });
  $effect(() => {
    void workspace.source;
    void workspace.active;
    void workspace.activeTab?.revision;
    headings = [];
    headingsPath = '';
    pdfPage = { path: '', page: 0, total: 0 };
    selectionStats = null;
    searchMatches = null;
    pdfLocked = false;
  });
  $effect(() => {
    document.documentElement.dataset.theme = preferences.theme;
    document.documentElement.style.zoom = String(uiScale);
    document.documentElement.style.setProperty('--ui-scale', String(uiScale));
    document.documentElement.style.setProperty('--ui-font', preferences.uiFont);
    document.documentElement.style.setProperty('--palette-width', String(preferences.paletteWidth));
    document.documentElement.style.setProperty(
      '--palette-height',
      String(preferences.paletteHeight),
    );
    document.documentElement.style.setProperty(
      '--palette-max-width',
      `${preferences.paletteMaxWidth}px`,
    );
    document.documentElement.style.setProperty(
      '--palette-max-height',
      `${preferences.paletteMaxHeight}px`,
    );
  });
  function viewCommand(command: ViewCommand) {
    if (command.target === 'view') {
      decorationless = !decorationless;
      return;
    }
    if (command.target === 'palette') {
      if (workspace.source && !settings && !help && !trustDialog) paletteOpen = true;
      return;
    }
    if (command.target === 'tabs') {
      if (!workspace.tabs.length) return;
      const current = workspace.tabs.findIndex((tab) => tab.path === workspace.active);
      const direction = command.action === 'next' ? 1 : -1;
      const next = (current + direction + workspace.tabs.length) % workspace.tabs.length;
      void workspace.open(workspace.tabs[next].path);
      return;
    }
    if (command.action === 'fit-width') {
      updatePreferences({ ...preferences, fitWidth: !preferences.fitWidth });
      return;
    }
    zoom(command);
  }
  function zoom(command: ZoomCommand) {
    const pagedDocumentZoom = command.target === 'document' && pagedDocument;
    const key = command.target === 'ui' ? 'uiZoom' : pagedDocumentZoom ? 'pdfZoom' : 'documentZoom';
    const value = changeZoom(
      preferences[key],
      command.action,
      pagedDocumentZoom ? MIN_PDF_ZOOM : MIN_ZOOM,
      pagedDocumentZoom ? MAX_PDF_ZOOM : MAX_ZOOM,
    );
    if (value === preferences[key] && command.action !== 'reset') return;
    updatePreferences({
      ...preferences,
      [key]: value,
      fitWidth: pagedDocumentZoom ? false : preferences.fitWidth,
    });
  }
  const trusted = $derived(
    trustedPath === workspace.active &&
      trustedRevision === workspace.activeTab?.revision &&
      trustedSource === workspace.source &&
      !!trustedPath,
  );
  $effect(() => {
    if (workspace.active !== trustedPath) trustedPath = '';
  });
  function updatePreferences(value: Preferences) {
    preferences = value;
    try {
      savedPreferences = withoutConfiguredPreferences(
        value,
        savedPreferences,
        configuredPreferences,
      );
      localStorage.setItem(
        'papyri.preferences',
        JSON.stringify({ ...savedPreferences, version: 2 }),
      );
    } catch {
      workspace.error = 'Preferences could not be persisted; browser storage is unavailable.';
    }
  }
  const managedToolLanguages: Record<ControlToolName, keyof Preferences['languageServerPaths']> = {
    marksman: 'markdown',
    tinymist: 'typst',
    texlab: 'latex',
    typst: 'typst',
  };
  async function downloadManagedTools(names: ControlToolName[]): Promise<unknown> {
    toolBusy = true;
    toolError = '';
    const installed: { name: ControlToolName; path: string; version: string }[] = [];
    const errors: string[] = [];
    try {
      for (const name of names) {
        toolMessage = `Downloading ${name}…`;
        try {
          const result = await invokeHost<{ path: string; version: string }>('install_tool', {
            name,
          });
          if (name === 'typst') updatePreferences({ ...preferences, typstPath: result.path });
          else {
            const language = managedToolLanguages[name];
            updatePreferences({
              ...preferences,
              languageServerPaths: { ...preferences.languageServerPaths, [language]: result.path },
            });
          }
          installed.push({ name, path: result.path, version: result.version });
        } catch (reason) {
          errors.push(`${name}: ${String(reason)}`);
        }
      }
      toolMessage = installed.length
        ? `Installed ${installed.map((item) => `${item.name} ${item.version}`).join(', ')}. Reopen the source editor or refresh the preview to use updates.`
        : '';
      toolError = errors.join('\n');
      if (errors.length && !installed.length) throw new Error(toolError);
      return { installed, preferences: $state.snapshot(preferences) };
    } finally {
      toolBusy = false;
    }
  }
  async function manageTexLive(action: ControlTexliveAction): Promise<unknown> {
    toolBusy = true;
    toolError = '';
    toolMessage =
      action === 'install'
        ? 'Installing TeX Live. This can take a long time; keep Papyri open.'
        : 'Updating the Papyri-managed TeX Live installation…';
    try {
      const paths = await invokeHost<Preferences['latexPaths']>('manage_texlive', { action });
      updatePreferences({ ...preferences, latexPaths: paths });
      toolMessage = 'TeX Live is ready. Refresh the preview to use the updated engines.';
      return { paths, preferences: $state.snapshot(preferences) };
    } catch (reason) {
      toolMessage = '';
      toolError = String(reason);
      throw reason;
    } finally {
      toolBusy = false;
    }
  }
  async function showSettingsTab(tab: ControlSettingsTab) {
    settings = true;
    await tick();
    settingsPanel?.showTab(tab);
  }
  function updateRecentFolders(path: string, lastFile?: string | null) {
    recentFolders = rememberRecentFolder(recentFolders, path, lastFile);
    persistRecentFolders(recentFolders);
  }
  function useFolder(path: string, project: boolean, lastFile?: string | null) {
    workspace.directory = path;
    if (project) workspace.searchRoot = path;
    workspace.treeRevision++;
    updateRecentFolders(path, lastFile);
  }
  async function openRecentProject(path: string, lastFile?: string) {
    useFolder(path, true, lastFile);
    if (lastFile) {
      await workspace.open(lastFile);
      if (workspace.active !== lastFile) updateRecentFolders(path, null);
    }
    if (lastFile && window.innerWidth < NARROW_VIEWPORT) sidebar = false;
  }
  $effect(() => {
    const file = workspace.recentFiles[0];
    if (!file) return;
    untrack(() => updateRecentFolders(dirname(file), file));
  });
  async function chooseFolder() {
    try {
      if (desktop) {
        const selected = await invokeHost<string | null>('pick_path', { directory: true });
        if (typeof selected === 'string') useFolder(selected, true);
      } else await workspace.selectSource(await browserDirectory());
    } catch (error) {
      workspace.error = String(error);
    }
  }
  async function chooseFile() {
    try {
      if (desktop) {
        const selected = await invokeHost<string | null>('pick_path', { directory: false });
        if (typeof selected === 'string') {
          workspace.directory = dirname(selected);
          workspace.searchRoot = dirname(selected);
          await workspace.open(selected);
        }
      } else fileInput.click();
    } catch (error) {
      workspace.error = String(error);
    }
  }
  async function importFiles(event: Event) {
    const files = [...((event.target as HTMLInputElement).files || [])];
    try {
      if (files.length) await workspace.selectSource(importedSource(files));
    } catch (error) {
      workspace.error = String(error);
    }
    (event.target as HTMLInputElement).value = '';
  }
  async function openDocument(path: string) {
    await workspace.open(path);
    if (window.innerWidth < NARROW_VIEWPORT) sidebar = false;
  }
  async function cancelOpeningCompile() {
    if (!isLatex(workspace.openingPath)) return;
    try {
      await invokeHost('latex_cancel_compile', { path: workspace.openingPath });
    } catch (reason) {
      workspace.error = String(reason);
    }
  }
  async function entryCreated(
    source: Source,
    path: string,
    kind: 'folder' | 'markdown' | 'typst' | 'latex',
  ) {
    createTarget = null;
    if (workspace.source !== source) return;
    workspace.treeRevision++;
    if (kind === 'folder') return;
    await openDocument(path);
    if (workspace.source === source && workspace.active === path) await openEditor();
  }
  async function follow(href: string, documentPath = workspace.active) {
    const target = resolveLink(documentPath, href);
    if (target.kind === 'anchor') {
      workspace.navigateAnchor(target.anchor);
    }
    if (target.kind === 'local') {
      if (!isDocument(target.path)) {
        workspace.error = 'This link is not a supported Markdown, PDF, Typst, or LaTeX document.';
        return;
      }
      await workspace.open(target.path, target.anchor);
    }
    if (target.kind === 'external') {
      try {
        if (desktop) {
          await invokeHost('open_external', { url: target.url });
        } else window.open(target.url, '_blank', 'noopener,noreferrer');
      } catch (error) {
        workspace.error = String(error);
      }
    }
    if (target.kind === 'blocked')
      workspace.error = 'This link uses an unsupported or unsafe URL scheme.';
  }
  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      await workspace.refresh();
      void refreshLatexProjectMetadata();
    } finally {
      refreshing = false;
    }
  }
  function split() {
    workspace.secondary = workspace.secondary
      ? ''
      : workspace.tabs.find((tab) => tab.path !== workspace.active)?.path || workspace.active;
  }
  async function ensureBrowser(site: SiteId) {
    if (!browserAvailable()) return;
    await tick();
    try {
      await browserSelect(site);
    } catch (error) {
      workspace.error = String(error);
    }
  }
  function makeRoomForPanel() {
    const remaining = layoutWidth - sidebarWidth - browserWidth;
    if (sidebar && remaining < MIN_DOCUMENT_WIDTH) sidebar = false;
  }
  function showExplorer() {
    if (outline && preferences.sidebarWidth + browserWidth > layoutWidth - MIN_DOCUMENT_WIDTH)
      outline = false;
    sidebar = true;
  }
  function toggleExplorer() {
    if (sidebar) sidebar = false;
    else showExplorer();
  }
  function resizeSidebar(width: number) {
    if (outline && width + browserWidth > layoutWidth - MIN_DOCUMENT_WIDTH) outline = false;
    preferences = { ...preferences, sidebarWidth: width };
  }
  function resizeBrowser(width: number) {
    if (sidebar && width + sidebarWidth > layoutWidth - MIN_DOCUMENT_WIDTH) sidebar = false;
    preferences = { ...preferences, browserWidth: width };
  }
  async function openRightTab(tab: RightTab) {
    rightTab = tab;
    if (!outline) makeRoomForPanel();
    outline = true;
    if (isSiteTab(tab)) await ensureBrowser(tab);
  }
  function toggleRightPanel() {
    if (outline) {
      outline = false;
      return;
    }
    makeRoomForPanel();
    outline = true;
    if (isSiteTab(rightTab)) void ensureBrowser(rightTab);
  }
  function toggleOutlinePanel() {
    if (outline && rightTab === 'outline') {
      outline = false;
      return;
    }
    rightTab = 'outline';
    outline = true;
  }
  async function toggleBrowser() {
    if (!browserAvailable()) return;
    if (outline && isSiteTab(rightTab)) {
      outline = false;
      return;
    }
    await openRightTab(isSiteTab(rightTab) ? rightTab : 'chatgpt');
  }
  async function writeClipboard(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.append(area);
      area.select();
      try {
        return document.execCommand('copy');
      } finally {
        area.remove();
      }
    }
  }
  async function readClipboard(): Promise<string> {
    try {
      return await navigator.clipboard.readText();
    } catch (error) {
      throw new Error('Could not read from the clipboard.', { cause: error });
    }
  }
  async function copyBuildLog(text: string) {
    if (!(await writeClipboard(text))) workspace.error = 'Could not copy the build log.';
  }
  async function copyRawDocument(): Promise<boolean> {
    const text = workspace.activeTab?.text;
    if (!text) return false;
    const copied = await writeClipboard(text);
    copyState = copied ? 'copied' : 'error';
    if (!copied) workspace.error = 'Could not copy the active document to the clipboard.';
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copyState = 'idle'), 1800);
    return copied;
  }
  function navigateBrowser(url: string) {
    updatePreferences({ ...preferences, browserUrl: url });
    browserNavigate(url).catch((error) => (workspace.error = String(error)));
  }
  function browserAction(action: () => Promise<void>) {
    action().catch((error) => (workspace.error = String(error)));
  }
  function openBrowserExternal() {
    const url = browser.url || preferences.browserUrl;
    if (!/^https?:\/\//i.test(url)) return;
    if (desktop)
      invokeHost('open_external', { url }).catch((error) => (workspace.error = String(error)));
    else window.open(url, '_blank', 'noopener,noreferrer');
  }
  function openBrowserWindow() {
    const url = browser.url || preferences.browserUrl;
    if (!browserAvailable() || !/^https?:\/\//i.test(url)) return;
    browserOpenWindow(url).catch((error) => (workspace.error = String(error)));
  }
  function zoomBrowser(action: 'in' | 'out' | 'reset') {
    const current = Math.round((browser.zoom || 1) * 100);
    const next =
      action === 'reset'
        ? 100
        : action === 'in'
          ? Math.min(500, current + 10)
          : Math.max(25, current - 10);
    browserSetZoom(next / 100).catch((error) => (workspace.error = String(error)));
  }
  function openSelectionMenu(info: {
    text: string;
    source: string;
    preview: string;
    x: number;
    y: number;
  }) {
    closeContextMenu();
    // Frame bounds and pointer coordinates are viewport pixels, while the host
    // shell is magnified by CSS zoom. Divide before assigning CSS offsets so
    // the menu lands under the pointer at every UI zoom level.
    const menuWidth = 430 * uiScale;
    const menuHeight = 340 * uiScale;
    const x = Math.max(8, Math.min(info.x, viewportWidth - menuWidth - 8));
    const y = Math.max(8, Math.min(info.y, viewportHeight - menuHeight - 8));
    const preview = DOMPurify.sanitize(info.preview, {
      FORBID_TAGS: [
        'img',
        'picture',
        'source',
        'video',
        'audio',
        'iframe',
        'object',
        'embed',
        'form',
        'input',
        'button',
        'textarea',
        'select',
        'option',
        'style',
        'link',
        'meta',
        'base',
      ],
      FORBID_ATTR: ['id', 'srcset'],
    });
    previewSource = false;
    previewPinned = false;
    selectionMenu = {
      ...info,
      preview: preview.length <= 20_000 ? preview : '',
      x: x / uiScale,
      y: y / uiScale,
    };
    requestAnimationFrame(() =>
      document.querySelector<HTMLButtonElement>('.selection-menu [role="menuitem"]')?.focus(),
    );
  }
  function closeSelectionMenu() {
    selectionMenu = null;
    previewSource = false;
    previewPinned = false;
  }
  function setPreviewSource(source: boolean) {
    previewSource = source || previewPinned;
  }
  function togglePreviewSource() {
    previewPinned = !previewPinned;
    previewSource = true;
  }
  function openContextMenu(target: ContextMenuTarget, x: number, y: number) {
    if (settings || help || trustDialog || paletteOpen) return;
    closeSelectionMenu();
    const menuWidth = 260 * uiScale;
    const menuHeight = 420 * uiScale;
    contextMenu = {
      x: Math.max(8, Math.min(x, viewportWidth - menuWidth - 8)) / uiScale,
      y: Math.max(8, Math.min(y, viewportHeight - menuHeight - 8)) / uiScale,
      target,
    };
    requestAnimationFrame(() =>
      document.querySelector<HTMLButtonElement>('.context-menu [role="menuitem"]')?.focus(),
    );
  }
  function closeContextMenu() {
    contextMenu = null;
  }
  function openPageContext(info: { x: number; y: number }) {
    openContextMenu({ kind: 'document' }, info.x, info.y);
  }
  function runContextMenuEntry(entry: ContextMenuEntry) {
    if ('separator' in entry) return;
    closeContextMenu();
    entry.run();
  }
  function contextMenuKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      closeContextMenu();
      event.stopPropagation();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const menu = event.currentTarget as HTMLElement;
      const items = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      items[(current + step + items.length) % items.length]?.focus();
      event.stopPropagation();
    }
  }
  async function copyPath(path: string) {
    const copied = await writeClipboard(path);
    if (!copied) workspace.error = 'Could not copy the path.';
  }
  async function copyExplorerContents(path: string) {
    const source = workspace.source;
    if (!source) return;
    try {
      const draft = drafts.get(source)?.get(path);
      const content = draft
        ? draft.text
        : source.readText
          ? await source.readText(path)
          : (await (source.readSource ?? source.read)(path)).text;
      if (!(await writeClipboard(content))) throw new Error('Clipboard is unavailable.');
    } catch (error) {
      workspace.error = `Could not copy file contents: ${String(error)}`;
    }
  }
  async function deleteExplorerFile(path: string, confirmed = false, strict = false) {
    const source = workspace.source;
    if (!source?.deleteFile || editorBusy) {
      if (strict) throw new Error('This source cannot delete files right now.');
      return;
    }
    const sourceDrafts = drafts.get(source);
    if (sourceDrafts?.get(path)?.dirty) {
      if (strict)
        throw new Error(`Save or discard the unsaved changes in ${basename(path)} first.`);
      workspace.error = `Save or discard the unsaved changes in ${basename(path)} before deleting it.`;
      return;
    }
    if (
      !confirmed &&
      !window.confirm(`Permanently delete ${basename(path)}? This cannot be undone.`)
    )
      return;
    editorBusy = true;
    try {
      await source.deleteFile(path);
      if (workspace.source !== source) return;
      const related = typstPreviewSessions.get(path);
      const hasUnsaved =
        sourceDrafts?.get(path)?.dirty ||
        [...(related ?? [])].some((item) => sourceDrafts?.get(item)?.dirty);
      if (!hasUnsaved && workspace.tabs.some((tab) => tab.path === path)) {
        editorBusy = false;
        workspace.close(path);
      } else if (hasUnsaved || editorDraft?.path === path) {
        workspace.error = 'The file was deleted; its open editor has been retained.';
      }
      workspace.treeRevision++;
      if (explorerSelection === path) explorerSelection = '';
    } catch (error) {
      if (strict) throw error;
      workspace.error = `Could not delete file: ${String(error)}`;
    } finally {
      editorBusy = false;
    }
  }
  async function copySelection(kind: 'source' | 'text' | 'quote') {
    const menu = selectionMenu;
    if (!menu) return;
    closeSelectionMenu();
    const value =
      kind === 'source'
        ? menu.source
        : kind === 'quote'
          ? menu.text
              .split(/\r?\n/)
              .map((line) => `> ${line}`)
              .join('\n')
          : menu.text;
    await copyText(value);
  }
  async function copyText(value: string) {
    if (!value.trim()) return;
    const copied = await writeClipboard(value);
    if (!copied) workspace.error = 'Could not copy the selection.';
  }
  async function appendBibliographyEntry(entry: string): Promise<boolean> {
    const tab = workspace.activeTab;
    if (!tab || !isBibliography(tab.path) || !entry.trim()) return false;
    const current = tab.text.trimEnd();
    return workspace.writeText(tab.path, `${current}${current ? '\n\n' : ''}${entry.trim()}\n`);
  }
  async function copyPreviewSelection(kind: 'source' | 'text', text: string, source: string) {
    await copyText(kind === 'source' ? source : text);
  }
  async function sendSelectionTo(site: SiteId) {
    const menu = selectionMenu;
    if (!menu) return;
    closeSelectionMenu();
    const text = menu.text.trim();
    if (!text) return;
    try {
      await openRightTab(site);
      await browserQuote(site, text);
    } catch (error) {
      workspace.error = String(error);
    }
  }
  async function searchSelectionWikipedia() {
    const menu = selectionMenu;
    if (!menu) return;
    closeSelectionMenu();
    const text = menu.text.trim();
    if (!text) return;
    try {
      await openRightTab('wikipedia');
      await browserSearchWikipedia(text);
    } catch (error) {
      workspace.error = String(error);
    }
  }
  function selectionMenuActions() {
    const actions: {
      id: string;
      label: string;
      shortcut?: string;
      run: () => Promise<void> | void;
    }[] = [
      {
        id: 'copy-source',
        label: 'Copy source',
        shortcut: 'Ctrl C',
        run: () => copySelection('source'),
      },
      {
        id: 'copy-text',
        label: 'Copy selected text',
        shortcut: 'Ctrl Shift C',
        run: () => copySelection('text'),
      },
      { id: 'copy-quote', label: 'Copy as quote', run: () => copySelection('quote') },
    ];
    if (browserAvailable()) {
      actions.push(
        { id: 'send-chatgpt', label: 'Send to ChatGPT', run: () => sendSelectionTo('chatgpt') },
        { id: 'send-gemini', label: 'Send to Gemini', run: () => sendSelectionTo('gemini') },
        {
          id: 'search-wikipedia',
          label: 'Search Wikipedia',
          run: () => searchSelectionWikipedia(),
        },
      );
    }
    return actions;
  }
  async function openSelectionMenuControl(x?: number, y?: number) {
    const selection = await selectionControl();
    if (!selection.text.trim() && !selection.source.trim())
      throw new Error('Select text in the preview first.');
    openSelectionMenu({
      ...selection,
      x: x ?? viewportWidth / 2,
      y: y ?? viewportHeight / 2,
    });
  }

  const paletteCommands = $derived.by(() => {
    const commands: PaletteCommand[] = [
      { id: 'open-file', label: 'Open file', shortcut: 'Ctrl O', run: () => void chooseFile() },
      {
        id: 'open-folder',
        label: 'Open folder',
        shortcut: 'Ctrl Shift O',
        run: () => void chooseFolder(),
      },
      {
        id: 'explorer',
        label: 'Toggle explorer',
        shortcut: 'Ctrl B',
        keywords: 'sidebar file tree',
        run: toggleExplorer,
      },
      {
        id: 'outline',
        label: 'Toggle table of contents',
        keywords: 'outline headings',
        run: toggleOutlinePanel,
      },
      ...(desktop && hasCompilableTab
        ? [
            {
              id: 'compile-log',
              label: 'Open compilation log',
              keywords: 'log compile latex typst diagnostics',
              run: () => (compileLogOpen = true),
            },
          ]
        : []),
      ...(browserAvailable()
        ? [
            {
              id: 'browser',
              label: 'Toggle web browser',
              shortcut: 'Ctrl Shift B',
              keywords: 'chatgpt web internet address',
              run: () => void toggleBrowser(),
            },
            ...SITES.map((site) => ({
              id: `site-${site.id}`,
              label: `Open ${site.label}`,
              keywords: `website tab ${site.label}`,
              run: () => void openRightTab(site.id),
            })),
            {
              id: 'browser-window',
              label: 'Open browser in new window',
              keywords: 'chatgpt web internet popup sign in',
              run: openBrowserWindow,
            },
            {
              id: 'browser-zoom-in',
              label: 'Zoom web page in',
              keywords: 'browser page zoom',
              run: () => zoomBrowser('in'),
            },
            {
              id: 'browser-zoom-out',
              label: 'Zoom web page out',
              keywords: 'browser page zoom',
              run: () => zoomBrowser('out'),
            },
            {
              id: 'browser-zoom-reset',
              label: 'Reset web page zoom',
              keywords: 'browser page zoom',
              run: () => zoomBrowser('reset'),
            },
          ]
        : []),
      {
        id: 'decorationless',
        label: 'Toggle decoration-less mode',
        shortcut: 'Ctrl Shift D',
        keywords: 'fullscreen full screen zen focus reading hide ui chrome',
        run: () => viewCommand({ target: 'view', action: 'decorationless' }),
      },
      {
        id: 'theme',
        label: 'Toggle color theme',
        keywords: 'light dark appearance',
        run: () =>
          updatePreferences({
            ...preferences,
            theme: preferences.theme === 'mocha' ? 'latte' : 'mocha',
          }),
      },
      {
        id: 'light',
        label: 'Use light theme',
        keywords: 'latte appearance',
        run: () => updatePreferences({ ...preferences, theme: 'latte' }),
      },
      {
        id: 'dark',
        label: 'Use dark theme',
        keywords: 'mocha appearance',
        run: () => updatePreferences({ ...preferences, theme: 'mocha' }),
      },
      {
        id: 'network',
        label: preferences.network ? 'Block external resources' : 'Allow external resources',
        keywords: 'network images links privacy',
        run: () => updatePreferences({ ...preferences, network: !preferences.network }),
      },
      {
        id: 'settings',
        label: 'Open settings',
        shortcut: 'Ctrl ,',
        keywords: 'preferences configuration',
        run: () => (settings = true),
      },
      {
        id: 'refresh',
        label: 'Refresh files',
        keywords: 'reload rescan',
        run: () => void refresh(),
      },
      {
        id: 'help',
        label: 'Keyboard shortcuts and help',
        keywords: 'keys help',
        run: () => (help = true),
      },
      {
        id: 'ui-in',
        label: 'Zoom in interface',
        shortcut: 'Ctrl Alt +',
        keywords: 'increase ui size',
        run: () => zoom({ target: 'ui', action: 'in' }),
      },
      {
        id: 'ui-out',
        label: 'Zoom out interface',
        shortcut: 'Ctrl Alt -',
        keywords: 'decrease ui size',
        run: () => zoom({ target: 'ui', action: 'out' }),
      },
      {
        id: 'ui-reset',
        label: 'Reset interface zoom',
        shortcut: 'Ctrl Alt 0',
        keywords: 'ui size 100',
        run: () => zoom({ target: 'ui', action: 'reset' }),
      },
    ];
    if (!desktop)
      commands.push({
        id: 'import-folder',
        label: 'Import folder snapshot',
        keywords: 'upload directory',
        run: () => folderInput.click(),
      });
    if (desktop)
      for (const engine of ['lualatex', 'pdflatex', 'xelatex'] as LatexEngine[])
        commands.push({
          id: `latex-${engine}`,
          label: `Use ${engine} for LaTeX`,
          keywords: 'compiler engine tex',
          run: () => updatePreferences({ ...preferences, latexEngine: engine }),
        });
    if (!isRootPath(workspace.directory) && workspace.directory !== workspace.source?.root)
      commands.push({
        id: 'parent',
        label: 'Go to parent folder',
        keywords: 'directory up',
        run: () => {
          workspace.directory = dirname(workspace.directory);
          workspace.treeRevision++;
        },
      });
    if (workspace.active) {
      commands.push(
        {
          id: 'search',
          label: 'Find in document',
          shortcut: 'Ctrl F',
          keywords: 'search text',
          run: () => {
            searchOpen = true;
            setTimeout(() => searchInput?.focus());
          },
        },
        {
          id: 'split',
          label: 'Toggle split view',
          shortcut: 'Ctrl \\',
          keywords: 'panes',
          run: split,
        },
        {
          id: 'fit',
          label: 'Toggle fit to width',
          shortcut: 'Ctrl =',
          keywords: 'wrap document',
          run: () => viewCommand({ target: 'document', action: 'fit-width' }),
        },
        {
          id: 'document-in',
          label: 'Zoom in document',
          shortcut: 'Ctrl +',
          keywords: 'increase text page size',
          run: () => zoom({ target: 'document', action: 'in' }),
        },
        {
          id: 'document-out',
          label: 'Zoom out document',
          shortcut: 'Ctrl -',
          keywords: 'decrease text page size',
          run: () => zoom({ target: 'document', action: 'out' }),
        },
        {
          id: 'document-reset',
          label: 'Reset document zoom',
          shortcut: 'Ctrl 0',
          keywords: 'text page size 100',
          run: () => zoom({ target: 'document', action: 'reset' }),
        },
        {
          id: 'close-tab',
          label: 'Close current tab',
          shortcut: 'Ctrl W',
          keywords: 'document file',
          run: () => workspace.close(workspace.active),
        },
        {
          id: 'show-folder',
          label: 'Show current document folder',
          keywords: 'reveal directory explorer',
          run: () => {
            workspace.directory = dirname(workspace.active);
            workspace.treeRevision++;
            showExplorer();
          },
        },
      );
    }
    if (pagedDocument && pdfPage.path === workspace.active && pdfPage.total) {
      commands.push(
        { id: 'pdf-first', label: 'First PDF page', run: () => workspace.navigateAnchor('page=1') },
        {
          id: 'pdf-previous',
          label: 'Previous PDF page',
          run: () => workspace.navigateAnchor(`page=${Math.max(1, pdfPage.page - 1)}`),
        },
        {
          id: 'pdf-next',
          label: 'Next PDF page',
          run: () => workspace.navigateAnchor(`page=${Math.min(pdfPage.total, pdfPage.page + 1)}`),
        },
        {
          id: 'pdf-last',
          label: 'Last PDF page',
          run: () => workspace.navigateAnchor(`page=${pdfPage.total}`),
        },
        { id: 'pdf-go-page', label: 'Go to PDF page…', keywords: 'page number', run: () => {} },
      );
    }
    if (searchOpen)
      commands.push({
        id: 'close-search',
        label: 'Close document search',
        run: () => {
          searchOpen = false;
          query = '';
        },
      });
    if (workspace.secondary)
      commands.push({
        id: 'close-split',
        label: 'Close split view',
        keywords: 'pane',
        run: () => (workspace.secondary = ''),
      });
    if (workspace.tabs.length > 1)
      commands.push(
        {
          id: 'next-tab',
          label: 'Next tab',
          shortcut: 'Ctrl Tab',
          keywords: 'next document',
          run: () => viewCommand({ target: 'tabs', action: 'next' }),
        },
        {
          id: 'previous-tab',
          label: 'Previous tab',
          shortcut: 'Ctrl Shift Tab',
          keywords: 'previous document',
          run: () => viewCommand({ target: 'tabs', action: 'previous' }),
        },
        {
          id: 'close-others',
          label: 'Close other tabs',
          keywords: 'documents',
          run: () => {
            for (const tab of [...workspace.tabs])
              if (tab.path !== workspace.active) workspace.close(tab.path);
          },
        },
      );
    if (workspace.tabs.length)
      commands.push({
        id: 'close-all',
        label: 'Close all tabs',
        keywords: 'documents',
        run: () => {
          for (const tab of [...workspace.tabs]) workspace.close(tab.path);
        },
      });
    const groupFor = (id: string) => {
      if (id.startsWith('pdf-')) return 'PDF';
      if (
        ['open-file', 'open-folder', 'import-folder', 'parent', 'show-folder', 'refresh'].includes(
          id,
        )
      )
        return 'Files';
      if (['next-tab', 'previous-tab', 'close-tab', 'close-others', 'close-all'].includes(id))
        return 'Tabs';
      if (['settings', 'network', 'help'].includes(id) || id.startsWith('latex-'))
        return 'Settings';
      return 'View';
    };
    return commands.map((command) => ({ ...command, group: groupFor(command.id) }));
  });
  const contextMenuTitle = $derived.by(() => {
    const menu = contextMenu;
    if (!menu) return '';
    if (menu.target.kind === 'file') return menu.target.directory ? 'Folder' : 'File';
    if (menu.target.kind === 'tab') return 'Tab';
    if (menu.target.kind === 'document') return 'Document';
    return 'Application';
  });
  const contextIcons: Record<string, typeof Copy> = {
    Open: ExternalLink,
    'Open folder': FolderOpen,
    'Open file…': FileText,
    'Open folder…': FolderOpen,
    'New file…': FilePlus2,
    'New folder…': FolderPlus,
    Rename: Pencil,
    'Show in explorer': FolderSearch,
    'Copy file contents': Clipboard,
    'Copy relative path': Link2,
    'Copy full path': Copy,
    'Copy path': Copy,
    'Delete file…': Trash2,
    'Refresh files': RefreshCw,
    'Split to the right': Columns2,
    'Close tab': X,
    'Close other tabs': X,
    'Close all tabs': X,
    'Copy raw source': Code,
    'Find in document…': Search,
    'Toggle outline': PanelRight,
    'Toggle split view': Columns2,
    'Fit to width': Maximize2,
    'Reset document zoom': RefreshCw,
    'Command palette…': Search,
    'Toggle explorer': PanelLeft,
    'Toggle right panel': PanelRight,
    'Settings…': SettingsIcon,
    'Keyboard shortcuts': CircleHelp,
  };
  const contextMenuItems = $derived.by(() => {
    const menu = contextMenu;
    const entries: ContextMenuEntry[] = [];
    if (!menu) return entries;
    const add = (label: string, run: () => void, shortcut?: string) =>
      entries.push({ label, run, shortcut });
    const separator = () => {
      if (entries.length && !('separator' in entries[entries.length - 1]))
        entries.push({ separator: true });
    };
    const openSearch = () => {
      searchOpen = true;
      setTimeout(() => searchInput?.focus());
    };
    const openPalette = () => viewCommand({ target: 'palette', action: 'open' });
    if (menu.target.kind === 'tab') {
      const path = menu.target.path;
      const other = workspace.tabs.find((tab) => tab.path !== path);
      if (other)
        add('Split to the right', () => {
          workspace.secondary = path === workspace.active ? other.path : path;
        });
      add('Show in explorer', () => {
        workspace.directory = dirname(path);
        workspace.treeRevision++;
        showExplorer();
      });
      add('Copy path', () => void copyPath(path));
      separator();
      add('Close tab', () => workspace.close(path), 'Ctrl W');
      add('Close other tabs', () => {
        for (const tab of [...workspace.tabs]) if (tab.path !== path) workspace.close(tab.path);
      });
      add('Close all tabs', () => {
        for (const tab of [...workspace.tabs]) workspace.close(tab.path);
      });
    } else if (menu.target.kind === 'file') {
      const path = menu.target.path;
      const directory = menu.target.directory ? path : dirname(path);
      if (menu.target.directory)
        add('Open folder', () => {
          workspace.directory = path;
          workspace.treeRevision++;
          showExplorer();
        });
      else if (menu.target.document) add('Open', () => void openDocument(path));
      if (workspace.source?.create) {
        const source = workspace.source;
        add('New file…', () => (createTarget = { source, directory, initialKind: 'markdown' }));
        add('New folder…', () => (createTarget = { source, directory, initialKind: 'folder' }));
      }
      separator();
      if (!menu.target.directory && workspace.source?.rename)
        add('Rename', () => (renamePath = path), 'F2');
      if (!menu.target.directory)
        add('Show in explorer', () => {
          workspace.directory = dirname(path);
          workspace.treeRevision++;
          showExplorer();
        });
      if (
        !menu.target.directory &&
        !isPdf(path) &&
        (workspace.source?.readText || menu.target.document)
      )
        add('Copy file contents', () => void copyExplorerContents(path));
      add(
        'Copy relative path',
        () => void copyPath(relativeProjectPath(workspace.directory, path)),
      );
      add('Copy full path', () => void copyPath(path));
      separator();
      add('Refresh files', () => {
        workspace.treeRevision++;
      });
      if (!menu.target.directory && workspace.source?.deleteFile) {
        separator();
        add('Delete file…', () => void deleteExplorerFile(path));
      }
    } else if (menu.target.kind === 'document') {
      if (canCopyRaw) add('Copy raw source', () => void copyRawDocument());
      add('Find in document…', openSearch, 'Ctrl F');
      add('Toggle outline', toggleOutlinePanel);
      add('Toggle split view', split, 'Ctrl \\');
      add('Fit to width', () => viewCommand({ target: 'document', action: 'fit-width' }), 'Ctrl =');
      add('Reset document zoom', () => zoom({ target: 'document', action: 'reset' }), 'Ctrl 0');
      separator();
      add('Command palette…', openPalette, 'Ctrl K');
      add('Settings…', () => (settings = true), 'Ctrl ,');
      add('Keyboard shortcuts', () => (help = true));
    } else {
      add('Open file…', () => void chooseFile(), 'Ctrl O');
      add('Open folder…', () => void chooseFolder(), 'Ctrl Shift O');
      separator();
      add('Command palette…', openPalette, 'Ctrl K');
      add('Toggle explorer', toggleExplorer, 'Ctrl B');
      add('Toggle right panel', toggleRightPanel, 'Ctrl Shift B');
      add('Settings…', () => (settings = true), 'Ctrl ,');
      add('Keyboard shortcuts', () => (help = true));
    }
    while (entries.length && 'separator' in entries[entries.length - 1]) entries.pop();
    return entries;
  });
  function menuItemId(label: string): string {
    return label
      .toLowerCase()
      .replace(/…/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
  function menuControlState(): ControlMenuState {
    if (selectionMenu) {
      return {
        open: true,
        kind: 'selection',
        title: 'Selection actions',
        x: selectionMenu.x,
        y: selectionMenu.y,
        path: workspace.active || null,
        directory: null,
        items: selectionMenuActions().map((action, index) => ({
          index,
          id: action.id,
          label: action.label,
          ...(action.shortcut ? { shortcut: action.shortcut } : {}),
        })),
      };
    }
    if (contextMenu) {
      return {
        open: true,
        kind: contextMenu.target.kind,
        title: contextMenuTitle,
        x: contextMenu.x,
        y: contextMenu.y,
        path: 'path' in contextMenu.target ? contextMenu.target.path : null,
        directory: contextMenu.target.kind === 'file' ? contextMenu.target.directory : null,
        items: contextMenuItems.map((item, index) =>
          'separator' in item
            ? { index, id: 'separator', label: '', separator: true }
            : {
                index,
                id: menuItemId(item.label),
                label: item.label,
                ...(item.shortcut ? { shortcut: item.shortcut } : {}),
              },
        ),
      };
    }
    return {
      open: false,
      kind: null,
      title: '',
      x: 0,
      y: 0,
      path: null,
      directory: null,
      items: [],
    };
  }
  async function openMenuControl(
    kind: ControlMenuKind,
    options: { path?: string; directory?: boolean; document?: boolean; x?: number; y?: number },
  ) {
    if (kind === 'selection') {
      await openSelectionMenuControl(options.x, options.y);
      return;
    }
    if (kind === 'app' || kind === 'document') {
      openContextMenu({ kind }, options.x ?? viewportWidth / 2, options.y ?? viewportHeight / 2);
      return;
    }
    const path = options.path ? normalize(options.path) : '';
    if (!path) throw new Error(`menu.open ${kind} needs a path.`);
    if (kind === 'tab') {
      if (!workspace.tabs.some((tab) => tab.path === path))
        throw new Error(`Tab is not open: ${path}`);
      openContextMenu(
        { kind: 'tab', path },
        options.x ?? viewportWidth / 2,
        options.y ?? viewportHeight / 2,
      );
      return;
    }
    let directory = options.directory;
    let document = options.document;
    if (directory === undefined) {
      const source = workspace.source;
      if (!source) throw new Error('No folder or document source is available.');
      const entries = await listDirectory(source, dirname(path));
      const entry = entries.find((item) => item.path === path);
      directory = entry?.directory ?? false;
      if (document === undefined) document = !directory && isDocument(path);
    }
    openContextMenu(
      { kind: 'file', path, directory, document: document ?? false },
      options.x ?? viewportWidth / 2,
      options.y ?? viewportHeight / 2,
    );
    if (!contextMenu) throw new Error('Close open dialogs before opening a menu.');
  }
  async function activateMenuControl(index: number) {
    if (selectionMenu) {
      const action = selectionMenuActions()[index];
      if (!action) throw new Error(`No selection menu item at index ${index}.`);
      await action.run();
      return;
    }
    if (!contextMenu) throw new Error('No context menu is open.');
    const entry = contextMenuItems[index];
    if (!entry || 'separator' in entry) throw new Error(`No menu item at index ${index}.`);
    runContextMenuEntry(entry);
  }
  async function closeMenuControl() {
    closeSelectionMenu();
    closeContextMenu();
  }
  let domRefSequence = 0;
  const domRefs = new Map<string, Element>();
  const domRefByElement = new WeakMap<Element, string>();
  function domRef(element: Element): string {
    const existing = domRefByElement.get(element);
    if (existing && domRefs.get(existing) === element) return existing;
    if (domRefs.size > 5000) domRefs.clear();
    const ref = `dom-${++domRefSequence}`;
    domRefs.set(ref, element);
    domRefByElement.set(element, ref);
    return ref;
  }
  function domElement(ref: string): Element {
    const element = domRefs.get(ref);
    if (!element || !element.isConnected) throw new Error(`DOM reference is not available: ${ref}`);
    return element;
  }
  function domSelector(element: Element): string {
    if (element.id && document.querySelectorAll(`#${CSS.escape(element.id)}`).length === 1)
      return `#${CSS.escape(element.id)}`;
    const parts: string[] = [];
    let current: Element | null = element;
    while (current && current !== document.documentElement) {
      let part = current.tagName.toLowerCase();
      if (current.classList.length)
        part +=
          '.' +
          [...current.classList]
            .slice(0, 2)
            .map((name) => CSS.escape(name))
            .join('.');
      const parent: Element | null = current.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter(
          (sibling) => sibling.tagName === current!.tagName,
        );
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }
      parts.unshift(part);
      current = parent;
    }
    return parts.join(' > ');
  }
  function domRect(element: Element) {
    const rect = element.getBoundingClientRect();
    return {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    };
  }
  function domVisible(element: Element): boolean {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0'
    );
  }
  function domNodeSummary(element: Element) {
    const rect = domRect(element);
    const style = getComputedStyle(element);
    const input = element as HTMLInputElement;
    return {
      ref: domRef(element),
      selector: domSelector(element),
      tag: element.tagName.toLowerCase(),
      id: element.id || null,
      classes: [...element.classList],
      role: element.getAttribute('role'),
      ariaLabel: element.getAttribute('aria-label'),
      text: (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 500),
      value:
        'value' in element && typeof input.value === 'string' ? input.value.slice(0, 500) : null,
      rect,
      visible: domVisible(element),
      interactive: element.matches(
        'a,button,input,select,textarea,summary,details,[role],[tabindex]',
      ),
      disabled: 'disabled' in element ? Boolean(input.disabled) : false,
      checked: 'checked' in element ? Boolean(input.checked) : null,
      display: style.display,
    };
  }
  async function browserDom(action: string, params: Record<string, unknown>) {
    return invokeHost('browser_dom', { action, params });
  }
  async function domQueryControl(options: {
    frame: 'main' | 'preview' | 'browser';
    selector?: string;
    limit?: number;
    includeHidden?: boolean;
  }) {
    if (options.frame === 'browser')
      return browserDom('query', {
        selector: options.selector,
        limit: options.limit,
        includeHidden: options.includeHidden,
      });
    if (options.frame === 'preview') {
      if (!primaryPreview) throw new Error('The preview is not ready.');
      return primaryPreview.dom('query', {
        selector: options.selector,
        limit: options.limit,
        includeHidden: options.includeHidden,
      });
    }
    const selector = (options.selector ?? 'body *').trim();
    if (!selector) throw new Error('The selector must not be empty.');
    const limit = Math.max(1, Math.min(1000, options.limit ?? 200));
    let elements: Element[];
    try {
      elements = [...document.querySelectorAll(selector)];
    } catch (error) {
      throw new Error(`Invalid selector: ${String(error)}`, { cause: error });
    }
    const nodes = [];
    for (const element of elements) {
      if (!options.includeHidden && !domVisible(element)) continue;
      nodes.push(domNodeSummary(element));
      if (nodes.length >= limit) break;
    }
    return { selector, count: nodes.length, nodes };
  }
  async function domGetControl(ref: string, frame: 'main' | 'preview' | 'browser' = 'main') {
    if (frame === 'browser') return browserDom('get', { ref });
    if (frame === 'preview') {
      if (!primaryPreview) throw new Error('The preview is not ready.');
      return primaryPreview.dom('get', { ref });
    }
    const element = domElement(ref);
    const attributes: Record<string, string> = {};
    for (const attribute of [...element.attributes].slice(0, 200))
      attributes[attribute.name] = attribute.value.slice(0, 2000);
    const style = getComputedStyle(element);
    return {
      ...domNodeSummary(element),
      html: element.outerHTML.slice(0, 200_000),
      text: (element as HTMLElement).innerText?.slice(0, 100_000) ?? '',
      attributes,
      computed: {
        display: style.display,
        visibility: style.visibility,
        position: style.position,
        color: style.color,
        backgroundColor: style.backgroundColor,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        marginTop: style.marginTop,
        marginBottom: style.marginBottom,
        paddingTop: style.paddingTop,
        paddingBottom: style.paddingBottom,
        rowGap: style.rowGap,
        columnGap: style.columnGap,
        overflow: style.overflow,
        opacity: style.opacity,
        zIndex: style.zIndex,
      },
    };
  }
  async function domFocusControl(ref: string, frame: 'main' | 'preview' | 'browser' = 'main') {
    if (frame === 'browser') return browserDom('focus', { ref });
    if (frame === 'preview') {
      if (!primaryPreview) throw new Error('The preview is not ready.');
      return primaryPreview.dom('focus', { ref });
    }
    const element = domElement(ref);
    element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    (element as HTMLElement).focus?.();
  }
  async function domClickControl(ref: string, frame: 'main' | 'preview' | 'browser' = 'main') {
    if (frame === 'browser') return browserDom('click', { ref });
    if (frame === 'preview') {
      if (!primaryPreview) throw new Error('The preview is not ready.');
      return primaryPreview.dom('click', { ref });
    }
    const element = domElement(ref);
    element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    (element as HTMLElement).focus?.();
    (element as HTMLElement).click?.();
  }
  async function domTypeControl(
    ref: string,
    text: string,
    frame: 'main' | 'preview' | 'browser' = 'main',
  ) {
    if (frame === 'browser') return browserDom('type', { ref, text });
    if (frame === 'preview') {
      if (!primaryPreview) throw new Error('The preview is not ready.');
      return primaryPreview.dom('type', { ref, text });
    }
    const element = domElement(ref);
    const input = element as HTMLInputElement;
    (element as HTMLElement).focus?.();
    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement
    ) {
      input.value = text;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    if ((element as HTMLElement).isContentEditable) {
      element.textContent = text;
      element.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
      return;
    }
    throw new Error('This DOM node is not an input, select, textarea, or editable element.');
  }
  async function domAccessibilityControl(frame: 'main' | 'preview' | 'browser' = 'main') {
    if (frame === 'browser') return browserDom('ax', {});
    if (frame === 'preview') {
      if (!primaryPreview) throw new Error('The preview is not ready.');
      return primaryPreview.dom('ax', {});
    }
    const nodes = [];
    for (const node of document.querySelectorAll(
      'a,button,input,select,textarea,summary,img,h1,h2,h3,h4,h5,h6,[role],[aria-label],[tabindex]',
    )) {
      if (!domVisible(node)) continue;
      const rect = domRect(node);
      const input = node as HTMLInputElement;
      const role =
        node.getAttribute('role') ||
        (node.tagName === 'A'
          ? 'link'
          : node.tagName === 'BUTTON'
            ? 'button'
            : /^H[1-6]$/.test(node.tagName)
              ? 'heading'
              : node.tagName === 'IMG'
                ? 'img'
                : node.tagName === 'INPUT'
                  ? input.type || 'input'
                  : node.tagName.toLowerCase());
      const name =
        node.getAttribute('aria-label') ||
        node.getAttribute('title') ||
        (node.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 300) ||
        node.getAttribute('alt') ||
        node.getAttribute('placeholder') ||
        '';
      nodes.push({
        ref: domRef(node),
        role,
        name,
        tag: node.tagName.toLowerCase(),
        disabled: Boolean(input.disabled),
        checked: 'checked' in input ? Boolean(input.checked) : null,
        value: typeof input.value === 'string' ? input.value.slice(0, 300) : null,
        rect,
      });
      if (nodes.length >= 500) break;
    }
    return { nodes };
  }
  async function recordFramesControl(options: {
    count: number;
    intervalMs: number;
    target: 'screen' | 'app';
    outputDir: string;
  }) {
    const paths: string[] = [];
    for (let index = 0; index < options.count; index++) {
      const output = `${options.outputDir.replace(/\/+$/, '')}/frame-${String(index + 1).padStart(4, '0')}.png`;
      const result = (await captureScreenshotControl({
        target: options.target,
        output,
      })) as { path?: string };
      if (result?.path) paths.push(result.path);
      if (index + 1 < options.count)
        await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
    }
    return { paths, count: paths.length, target: options.target };
  }
  async function waitForSelectorControl(
    selector: string,
    frame: 'main' | 'preview' | 'browser',
    timeoutMs: number,
  ) {
    const deadline = Date.now() + Math.max(1000, Math.min(timeoutMs, 60_000));
    while (Date.now() < deadline) {
      const result = await domQueryControl({ selector, frame });
      if (result && typeof result === 'object' && 'count' in result && Number(result.count) > 0)
        return result;
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    throw new Error(`Timed out waiting for selector: ${selector}`);
  }
  async function waitForIdleControl(timeoutMs: number) {
    const deadline = Date.now() + Math.max(1000, Math.min(timeoutMs, 60_000));
    while (Date.now() < deadline) {
      const state = controlState();
      if (!state.busy && !state.editor.busy && !state.tools.busy && !state.browser?.loading)
        return state;
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    throw new Error('Timed out waiting for the app to become idle.');
  }
  async function waitForStateControl(path: string, equals: unknown, timeoutMs: number) {
    const deadline = Date.now() + Math.max(1000, Math.min(timeoutMs, 60_000));
    const parts = path.split('.').filter(Boolean);
    while (Date.now() < deadline) {
      let value: unknown = controlState();
      for (const part of parts)
        value =
          value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined;
      if (JSON.stringify(value) === JSON.stringify(equals)) return { path, value };
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    throw new Error(`Timed out waiting for state: ${path}`);
  }
  async function captureScreenshotControl(options: {
    target: 'screen' | 'app' | 'element' | 'rect';
    output?: string;
    clipboard?: boolean;
    ref?: string;
    selector?: string;
    frame?: 'main' | 'preview' | 'browser';
    rect?: { x: number; y: number; width: number; height: number };
  }) {
    const output = options.output ? expandHomePath(options.output) : undefined;
    const clipboard = options.clipboard === true;
    if (options.target === 'screen' || options.target === 'rect')
      return invokeHost('capture_screen', {
        region: options.target === 'rect' ? options.rect : null,
        output,
        clipboard,
        target: options.target,
      });
    if (options.target === 'app')
      return invokeHost('capture_webview', {
        rect: null,
        output,
        clipboard,
        target: options.target,
      });
    const frameName = options.frame ?? 'main';
    if (frameName === 'preview') {
      if (!primaryPreview) throw new Error('The preview is not ready.');
      let node: { rect?: { x: number; y: number; width: number; height: number } } | undefined;
      if (options.ref)
        node = (await primaryPreview.dom('get', { ref: options.ref })) as typeof node;
      else if (options.selector) {
        const found = (await primaryPreview.dom('query', {
          selector: options.selector,
          limit: 1,
        })) as { nodes?: { rect: { x: number; y: number; width: number; height: number } }[] };
        node = found.nodes?.[0];
      }
      if (!node?.rect) throw new Error('The element was not found in the preview.');
      const outer = primaryPreview.frameRect();
      if (!outer) throw new Error('The preview frame is not visible.');
      const rect = {
        x: outer.x + node.rect.x,
        y: outer.y + node.rect.y,
        width: node.rect.width,
        height: node.rect.height,
      };
      const width = window.innerWidth;
      const height = window.innerHeight;
      return invokeHost('capture_webview', {
        target: 'element',
        rect: {
          x: Math.max(0, rect.x) / width,
          y: Math.max(0, rect.y) / height,
          width: Math.min(width, rect.x + rect.width) / width - Math.max(0, rect.x) / width,
          height: Math.min(height, rect.y + rect.height) / height - Math.max(0, rect.y) / height,
        },
        output,
        clipboard,
      });
    }
    if (frameName === 'browser') {
      let node:
        | {
            rect?: { x: number; y: number; width: number; height: number };
            viewport?: { width: number; height: number };
          }
        | undefined;
      if (options.ref) node = (await browserDom('get', { ref: options.ref })) as typeof node;
      else if (options.selector) {
        const found = (await browserDom('query', {
          selector: options.selector,
          limit: 1,
        })) as {
          nodes?: { rect: { x: number; y: number; width: number; height: number } }[];
          viewport?: { width: number; height: number };
        };
        node = { rect: found.nodes?.[0]?.rect, viewport: found.viewport };
      }
      if (!node?.rect || !node.viewport)
        throw new Error('The element was not found in the browser page.');
      return invokeHost('browser_capture', {
        rect: {
          x: node.rect.x / node.viewport.width,
          y: node.rect.y / node.viewport.height,
          width: node.rect.width / node.viewport.width,
          height: node.rect.height / node.viewport.height,
        },
        output,
        clipboard,
      });
    }
    let element: Element | null = null;
    if (options.ref) element = domElement(options.ref);
    else if (options.selector) {
      try {
        element = document.querySelector(options.selector);
      } catch (error) {
        throw new Error(`Invalid selector: ${String(error)}`, { cause: error });
      }
    }
    if (!element) throw new Error('The element was not found.');
    if (!domVisible(element)) throw new Error('The element is not visible.');
    const rect = domRect(element);
    const width = window.innerWidth;
    const height = window.innerHeight;
    if (
      rect.x >= width ||
      rect.y >= height ||
      rect.x + rect.width <= 0 ||
      rect.y + rect.height <= 0
    )
      throw new Error('The element is outside the visible viewport.');
    return invokeHost('capture_webview', {
      target: options.target,
      rect: {
        x: Math.max(0, rect.x) / width,
        y: Math.max(0, rect.y) / height,
        width: Math.min(width, rect.x + rect.width) / width - Math.max(0, rect.x) / width,
        height: Math.min(height, rect.y + rect.height) / height - Math.max(0, rect.y) / height,
      },
      output,
      clipboard,
    });
  }
  function runPaletteCommand(id: string) {
    const command = paletteCommands.find((item) => item.id === id);
    if (!command) return;
    recentCommands = [id, ...recentCommands.filter((item) => item !== id)].slice(0, 20);
    command.run();
  }
  function dismiss() {
    if (recentOpen) {
      recentOpen = false;
      return;
    }
    if (settings) {
      settings = false;
      return;
    }
    if (help) {
      help = false;
      return;
    }
    if (trustDialog) {
      trustDialog = false;
      return;
    }
    if (searchOpen) {
      searchOpen = false;
      query = '';
      return;
    }
    if (decorationless) decorationless = false;
  }
  function keyboard(event: KeyboardEvent) {
    if (paletteOpen || compileLogOpen) return;
    const command = viewShortcut(event);
    if (command) {
      event.preventDefault();
      viewCommand(command);
      return;
    }
    const modifier = event.ctrlKey || event.metaKey;
    if (event.key === 'Escape') {
      if (selectionMenu) closeSelectionMenu();
      else if (contextMenu) closeContextMenu();
      else dismiss();
      return;
    }
    const key = event.key.toLowerCase();
    const copyKey = key === 'c' || event.code === 'KeyC';
    if (modifier && selectionMenu && copyKey && !event.altKey) {
      event.preventDefault();
      void copySelection(event.shiftKey ? 'text' : 'source');
      return;
    }
    if (!modifier) return;
    if (!['o', 'b', 'f', 'w', '\\', ','].includes(key)) return;
    event.preventDefault();
    if (key === 'o') void (event.shiftKey ? chooseFolder() : chooseFile());
    if (key === 'b') {
      if (event.shiftKey) void toggleBrowser();
      else toggleExplorer();
    }
    if (key === 'f') {
      if (!workspace.active) return;
      searchOpen = true;
      setTimeout(() => searchInput?.focus());
    }
    if (key === 'w') workspace.close(workspace.active);
    if (key === '\\' && workspace.active) split();
    if (key === ',') settings = !settings;
  }
  function editorControlState(): ControlEditorState {
    const state = editorVisible ? sourceEditor?.getState() : null;
    return {
      available: !!workspace.source?.write && !isPdf(workspace.active),
      open: editorVisible,
      path: editorDraft?.path ?? (workspace.active || null),
      language: editorLanguage,
      dirty: editorDirty,
      busy: editorBusy,
      readOnly: !workspace.source?.write,
      status: editorServerStatus,
      error: editorError || null,
      cursor: state?.cursor ?? null,
      selection: state?.selection ?? null,
      diagnostics: {
        errors: state?.diagnostics.filter((item) => item.severity === 1).length ?? 0,
        warnings: state?.diagnostics.filter((item) => item.severity === 2).length ?? 0,
        information: state?.diagnostics.filter((item) => item.severity === 3).length ?? 0,
        hints: state?.diagnostics.filter((item) => item.severity === 4).length ?? 0,
      },
    };
  }
  function explorerControlState() {
    return {
      workingDirectory: explorerState.workingDirectory,
      selected: explorerSelection || null,
      expanded: [...explorerState.expanded],
    };
  }
  function noteKey(path = workspace.active): string {
    return `papyri.note:${path}`;
  }
  function noteControlState() {
    return {
      path: workspace.active || null,
      text: workspace.active ? (localStorage.getItem(noteKey()) ?? '') : '',
    };
  }
  function trustControlState() {
    return {
      supported: isMarkdown(workspace.active) && !pagedDocument,
      enabled: trusted,
    };
  }
  function livePreviewControlState() {
    return {
      available:
        editorVisible &&
        (!!typstPreviewRoot || editorLanguage === 'markdown' || editorLanguage === 'latex'),
      visible: typstLiveVisible,
      split: typstSourceShare,
    };
  }
  async function openEditorForControl() {
    const source = workspace.source;
    const path = workspace.active;
    if (!source || !path || isPdf(path))
      throw new Error('Open a Markdown, Typst, or LaTeX document first.');
    if (!source.write) throw new Error('This source is read-only.');
    if (editorVisible) return;
    await openEditor();
    if (!editorVisible) throw new Error(editorError || 'Could not open the source editor.');
  }
  async function openEditorAt(line?: number, character = 0) {
    await openEditorForControl();
    if (line === undefined) return;
    await tick();
    sourceEditor?.reveal(line, character);
  }
  async function requireEditor() {
    await openEditorForControl();
    await tick();
    if (!sourceEditor) throw new Error('The source editor is not ready.');
    return sourceEditor;
  }
  async function copyEditorSelection() {
    const editor = await requireEditor();
    const state = editor.getState();
    if (!state?.selection) throw new Error('Select text in the source editor first.');
    if (!(await writeClipboard(state.selection.text)))
      throw new Error('Could not copy the source selection.');
  }
  async function cutEditorSelection() {
    const editor = await requireEditor();
    const state = editor.getState();
    if (!state?.selection) throw new Error('Select text in the source editor first.');
    if (!(await writeClipboard(state.selection.text)))
      throw new Error('Could not cut the source selection.');
    editor.deleteSelection();
  }
  async function pasteEditorClipboard() {
    const editor = await requireEditor();
    editor.replaceSelection(await readClipboard());
  }
  async function editorTextControl() {
    if (editorDraft)
      return { path: editorDraft.path, text: editorDraft.text, dirty: editorDraft.dirty };
    const tab = workspace.activeTab;
    if (!tab || isPdf(tab.path)) throw new Error('Open a source document first.');
    if (!tab.bytes) return { path: tab.path, text: tab.text, dirty: false };
    if (tab && workspace.source?.readSource) {
      const file = await workspace.source.readSource(tab.path);
      return { path: tab.path, text: file.text, dirty: false };
    }
    throw new Error('Open a source document first.');
  }
  async function setEditorTextControl(text: string) {
    await openEditorForControl();
    await tick();
    if (!sourceEditor) throw new Error('The source editor is not ready.');
    sourceEditor.setText(text);
    await tick();
  }
  async function explorerCwdControl(path: string) {
    const source = workspace.source;
    if (!source) throw new Error('No folder or document source is available.');
    const entries = await listDirectory(source, path);
    void entries;
    updateExplorerState({ ...explorerState, workingDirectory: path });
    showExplorer();
  }
  async function explorerExpandControl(path: string) {
    const expanded = [...new Set([...explorerState.expanded, path])];
    updateExplorerState({ workingDirectory: path, expanded });
    showExplorer();
  }
  async function explorerCollapseControl(path: string) {
    updateExplorerState({
      ...explorerState,
      expanded: explorerState.expanded.filter((item) => item !== path),
    });
  }
  async function explorerCreateControl(
    directory: string,
    name: string,
    kind: ControlEntryKind,
  ): Promise<string> {
    const source = workspace.source;
    if (!source?.create) throw new Error('This source cannot create files.');
    const trimmed = name.trim();
    if (!trimmed || trimmed === '.' || trimmed === '..' || /[/\\]/.test(trimmed))
      throw new Error('Enter a single file or folder name.');
    const extension = { markdown: '.md', typst: '.typ', latex: '.tex', folder: '' }[kind];
    const filename =
      extension && !trimmed.toLowerCase().endsWith(extension) ? trimmed + extension : trimmed;
    const path = await source.create(directory, filename, kind);
    workspace.treeRevision++;
    return path;
  }
  async function setTrustControl(enabled?: boolean) {
    if (!isMarkdown(workspace.active) || !workspace.source)
      throw new Error('Scripts can only be enabled for Markdown documents.');
    const next = enabled ?? !trusted;
    if (next) {
      trustedPath = workspace.active;
      trustedRevision = workspace.activeTab?.revision ?? -1;
      trustedSource = workspace.source;
    } else trustedPath = '';
  }
  async function setLivePreviewControl(enabled?: boolean) {
    if (!livePreviewControlState().available)
      throw new Error('The live preview is not available in the current view.');
    typstLiveVisible = enabled ?? !typstLiveVisible;
  }
  async function livePreviewZoomControl(action: 'in' | 'out' | 'reset') {
    if (typstPreviewRoot && typstPreview) {
      if (action === 'reset') typstPreview.fit();
      else typstPreview.zoomBy(action);
    } else if (action === 'reset')
      updatePreferences({ ...preferences, documentZoom: 100, pdfZoom: 100, fitWidth: false });
    else zoom({ target: 'document', action });
  }
  async function livePreviewFitControl() {
    if (typstPreviewRoot && typstPreview) typstPreview.fit();
    else updatePreferences({ ...preferences, documentZoom: 100, pdfZoom: 100, fitWidth: true });
  }
  async function selectionControl() {
    if (!primaryPreview) throw new Error('The document preview is not ready.');
    try {
      return await primaryPreview.requestSelection();
    } catch (error) {
      throw new Error(String(error), { cause: error });
    }
  }
  async function setSelectionControl(text: string) {
    if (!primaryPreview) throw new Error('The document preview is not ready.');
    const found = await primaryPreview.selectText(text);
    if (!found) throw new Error('That text is not visible in the preview.');
  }
  async function clearSelectionControl() {
    if (!primaryPreview) throw new Error('The document preview is not ready.');
    await primaryPreview.clearSelection();
  }
  async function copySelectionControl(kind: 'source' | 'text' | 'quote') {
    const selection = await selectionControl();
    const value =
      kind === 'source'
        ? selection.source
        : kind === 'quote'
          ? selection.text
              .split(/\r?\n/)
              .map((line) => `> ${line}`)
              .join('\n')
          : selection.text;
    if (!value.trim()) throw new Error('Select text in the preview first.');
    if (!(await writeClipboard(value))) throw new Error('Could not copy the selection.');
  }
  async function copyRawControl() {
    if (!(await copyRawDocument())) throw new Error('Could not copy the active document.');
  }
  function recentControlState() {
    return {
      files: [...workspace.recentFiles],
      folders: recentFolders.map((folder) => ({
        path: folder.path,
        ...(folder.lastFile ? { lastFile: folder.lastFile } : {}),
      })),
      commands: [...recentCommands],
    };
  }
  function controlState(): ControlState {
    return buildControlState({
      workspace,
      pdfPage,
      pagedDocument,
      view: {
        sidebar,
        outline,
        settings,
        palette: paletteOpen,
        search: searchOpen,
        log: compileLogOpen,
        split: !!workspace.secondary,
        decorationless,
        query,
      },
      preferences: $state.snapshot(preferences) as Preferences,
      editor: editorControlState(),
      explorer: explorerControlState(),
      search: { open: searchOpen, query, matches: searchMatches },
      note: noteControlState(),
      trust: trustControlState(),
      browser: browserAvailable() ? ($state.snapshot(browser) as BrowserState) : null,
      rightTab,
      livePreview: livePreviewControlState(),
      tools: { busy: toolBusy, message: toolMessage, error: toolError },
      stats: documentStats ?? {
        words: null,
        characters: null,
        minutes: null,
        bytes: null,
        pages: null,
      },
      selection: selectionStats,
      menu: menuControlState(),
      recent: recentControlState(),
      pdfLocked,
    });
  }
  const controlView: ControlViewState = {
    get sidebar() {
      return sidebar;
    },
    set sidebar(value) {
      if (value) showExplorer();
      else sidebar = false;
    },
    get outline() {
      return outline;
    },
    set outline(value) {
      if (value) makeRoomForPanel();
      outline = value;
    },
    get settings() {
      return settings;
    },
    set settings(value) {
      settings = value;
    },
    get palette() {
      return paletteOpen;
    },
    set palette(value) {
      paletteOpen = value;
    },
    get log() {
      return compileLogOpen;
    },
    set log(value) {
      compileLogOpen = value;
    },
    get search() {
      return searchOpen;
    },
    set search(value) {
      searchOpen = value;
    },
    get decorationless() {
      return decorationless;
    },
    set decorationless(value) {
      decorationless = value;
    },
    get query() {
      return query;
    },
    set query(value) {
      query = value;
    },
  };
  const controlActions = createControlActions({
    workspace,
    workspaceReady,
    view: controlView,
    state: controlState,
    headings: () => headings,
    headingsPath: () => headingsPath,
    pdfPage: () => pdfPage,
    pagedDocument: () => pagedDocument,
    primaryPreview: () => primaryPreview,
    secondaryPreview: () => secondaryPreview,
    preferences: () => $state.snapshot(preferences) as Preferences,
    updatePreferences,
    commands: () => paletteCommands,
    runCommand: runPaletteCommand,
    rememberFolder: (path) => updateRecentFolders(path),
    zoom,
    split,
    refresh,
    latexStatus: () => invokeHost('latex_compile_status'),
    latexCancel: (path?: string) => invokeHost('latex_cancel_compile', { path }),
    editor: {
      state: editorControlState,
      open: () => openEditorForControl(),
      close: async () => {
        editing = false;
      },
      save: async () => {
        if (!editorDraft) throw new Error('Open the source editor first.');
        await saveEditor();
        if (editorError) throw new Error(editorError);
      },
      reload: async (discard) => {
        if (!editorDraft) throw new Error('Open the source editor first.');
        await reloadEditor(discard);
        if (editorError) throw new Error(editorError);
      },
      text: editorTextControl,
      setText: setEditorTextControl,
      reveal: async (line, character) => {
        await openEditorAt(line, character);
      },
      sync: async () => {
        await openEditorForControl();
        await tick();
        const state = sourceEditor?.getState();
        if (state) syncSourcePosition(state.cursor.line, state.cursor.character);
      },
      undo: async () => {
        (await requireEditor()).undoEdit();
      },
      redo: async () => {
        (await requireEditor()).redoEdit();
      },
      selectAll: async () => {
        (await requireEditor()).selectAllText();
      },
      select: async (from, to) => {
        (await requireEditor()).selectRange(from, to);
      },
      copy: copyEditorSelection,
      cut: cutEditorSelection,
      paste: pasteEditorClipboard,
      diagnostics: async () => {
        await openEditorForControl();
        await tick();
        return {
          path: editorDraft?.path ?? null,
          diagnostics: sourceEditor?.getState()?.diagnostics ?? [],
        };
      },
    },
    explorer: {
      state: explorerControlState,
      list: async (path) => {
        const source = workspace.source;
        if (!source) throw new Error('No folder or document source is available.');
        return { path, entries: await listDirectory(source, path) };
      },
      cwd: async (path) => {
        await explorerCwdControl(path);
      },
      expand: async (path) => {
        await explorerExpandControl(path);
      },
      collapse: async (path) => {
        await explorerCollapseControl(path);
      },
      select: async (path) => {
        explorerSelection = path;
        showExplorer();
      },
      read: async (path) => {
        const source = workspace.source;
        if (!source) throw new Error('No folder or document source is available.');
        const draft = drafts.get(source)?.get(path);
        const text = draft
          ? draft.text
          : source.readText
            ? await source.readText(path)
            : (await (source.readSource ?? source.read)(path)).text;
        return { path, text };
      },
      create: (directory, name, kind) => explorerCreateControl(directory, name, kind),
      rename: (path, name) => renameExplorerFile(path, name, true),
      delete: async (path) => {
        await deleteExplorerFile(path, true, true);
      },
    },
    note: {
      get: noteControlState,
      set: async (text) => {
        if (!workspace.active) throw new Error('No document is open.');
        localStorage.setItem(noteKey(), text);
        sidePanel?.setNote(text);
      },
    },
    trust: {
      state: trustControlState,
      set: setTrustControl,
    },
    rightTab: async (tab) => {
      if (isSiteTab(tab) && !browserAvailable())
        throw new Error('The embedded web browser is unavailable in this build.');
      await openRightTab(tab);
    },
    browser: {
      state: () => (browserAvailable() ? ($state.snapshot(browser) as BrowserState) : null),
      navigate: async (target) => {
        const url = browserTarget(target);
        updatePreferences({ ...preferences, browserUrl: url });
        await browserNavigate(url);
      },
      back: () => browserBack(),
      forward: () => browserForward(),
      reload: () => browserReload(),
      stop: () => browserStop(),
      zoom: async (action) => {
        const current = Math.round((browser.zoom || 1) * 100);
        const next =
          action === 'reset'
            ? 100
            : action === 'in'
              ? Math.min(500, current + 10)
              : Math.max(25, current - 10);
        await browserSetZoom(next / 100);
      },
      window: async (url) => {
        const target = url || browser.url || preferences.browserUrl;
        if (!/^https?:\/\//i.test(target)) throw new Error('Open an HTTP(S) address first.');
        await browserOpenWindow(target);
      },
      quote: async (site, text) => {
        await openRightTab(site);
        await browserQuote(site, text);
      },
      search: async (text) => {
        await openRightTab('wikipedia');
        await browserSearchWikipedia(text);
      },
    },
    search: {
      matches: () => searchMatches,
      next: async () => {
        if (!primaryPreview) throw new Error('The document preview is not ready.');
        primaryPreview.searchNext(false);
      },
      previous: async () => {
        if (!primaryPreview) throw new Error('The document preview is not ready.');
        primaryPreview.searchNext(true);
      },
    },
    pdf: {
      password: async (password) => {
        if (!pagedDocument || !primaryPreview) throw new Error('No PDF preview is open.');
        primaryPreview.unlockPdf(password);
      },
    },
    livePreview: {
      state: livePreviewControlState,
      set: setLivePreviewControl,
      zoom: livePreviewZoomControl,
      fit: livePreviewFitControl,
      split: async (value) => {
        typstSourceShare = Math.max(10, Math.min(90, value));
      },
    },
    selection: {
      get: selectionControl,
      copy: copySelectionControl,
      set: setSelectionControl,
      clear: clearSelectionControl,
    },
    tools: {
      state: () => ({ busy: toolBusy, message: toolMessage, error: toolError }),
      install: (name) => downloadManagedTools([name]),
      texlive: (action) => manageTexLive(action),
    },
    documentCopyRaw: copyRawControl,
    settingsTab: showSettingsTab,
    menu: {
      state: menuControlState,
      open: openMenuControl,
      activate: activateMenuControl,
      close: closeMenuControl,
    },
    dom: {
      query: domQueryControl,
      get: domGetControl,
      focus: domFocusControl,
      click: domClickControl,
      type: domTypeControl,
      accessibility: domAccessibilityControl,
    },
    screenshot: { capture: captureScreenshotControl },
    input: {
      inject: (action, params) => invokeHost('input_inject', { action, params }),
      clipboardRead: () => invokeHost<string>('clipboard_read'),
      clipboardWrite: (text) => invokeHost('clipboard_write', { text }),
      clipboardReadImage: (output) =>
        invokeHost('clipboard_read_image', { output: output ? expandHomePath(output) : null }),
      clipboardWriteImage: (path) =>
        invokeHost('clipboard_write_image', { path: expandHomePath(path) }),
      windows: () => invokeHost('window_list'),
      focusWindow: (id) => invokeHost('window_focus', { id }),
      captureWindow: (id, output, clipboard) =>
        invokeHost('window_capture', {
          id,
          output: output ? expandHomePath(output) : null,
          clipboard,
        }),
      waitSelector: waitForSelectorControl,
      waitIdle: waitForIdleControl,
      waitState: waitForStateControl,
      recordFrames: recordFramesControl,
    },
  });
  const executeAction = createControlExecutor(controlActions);
  const executeControl = async (method: string, params: Record<string, unknown>) => {
    if (method === 'prepare-window-close') {
      if (editorBusy) throw new Error('Wait for the source operation to finish before closing.');
      const hasUnsavedDrafts = [...drafts.values()].some((items) =>
        [...items.values()].some((draft) => draft.dirty),
      );
      if (hasUnsavedDrafts && !window.confirm('Discard unsaved source changes and quit?'))
        throw new Error('Close cancelled.');
      return { ready: true };
    }
    if (method === 'prepare-quit') {
      if (
        editorBusy ||
        [...drafts.values()].some((items) => [...items.values()].some((draft) => draft.dirty))
      )
        throw new Error('Save or discard unsaved source changes before quitting.');
      return { ready: true };
    }
    return executeAction(method, params);
  };
  let controlPublishTimer: ReturnType<typeof setTimeout> | undefined;
  let lastPublishedState = '';
  let lastPublishedHeadings = '';
  function scheduleControlPublish() {
    if (!desktop || controlPublishTimer) return;
    controlPublishTimer = setTimeout(() => {
      controlPublishTimer = undefined;
      const state = controlState();
      const key = JSON.stringify(state);
      if (key === lastPublishedState) return;
      lastPublishedState = key;
      publishControlEvent('state', state);
    }, CONTROL_PUBLISH_INTERVAL_MS);
  }
  $effect(() => {
    if (!desktop) return;
    void controlState();
    scheduleControlPublish();
  });
  $effect(() => {
    if (!desktop) return;
    const value = {
      path: headingsPath === workspace.active ? workspace.active : null,
      headings: headingsPath === workspace.active ? headings : [],
    };
    const key = JSON.stringify(value);
    if (key === lastPublishedHeadings) return;
    lastPublishedHeadings = key;
    publishControlEvent('headings', value);
  });
  let lastPublishedBrowser = '';
  $effect(() => {
    if (!desktop) return;
    const value = { ...browser };
    const key = JSON.stringify(value);
    if (key === lastPublishedBrowser) return;
    lastPublishedBrowser = key;
    publishControlEvent('browser', value);
  });
  let lastPublishedSelection = '';
  $effect(() => {
    if (!desktop) return;
    const key = JSON.stringify(selectionStats);
    if (key === lastPublishedSelection) return;
    lastPublishedSelection = key;
    publishControlEvent('selection', selectionStats);
  });
  onMount(() => {
    let disposed = false;
    const protectDrafts = (event: BeforeUnloadEvent) => {
      if (![...drafts.values()].some((items) => [...items.values()].some((draft) => draft.dirty)))
        return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', protectDrafts);
    let uninstallControl: (() => void) | undefined;
    let unlistenBrowser: (() => void) | undefined;
    const handleContextMenu = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('input, textarea, [contenteditable]:not([contenteditable="false"])'))
        return;
      event.preventDefault();
      if (
        target?.closest(
          '.selection-menu-layer, .context-menu-layer, .selection-menu, .context-menu',
        )
      )
        return;
      if (settings || compileLogOpen || help || trustDialog || paletteOpen) return;
      const tab = target?.closest('.tab-item[data-path]') as HTMLElement | null;
      if (tab?.dataset.path) {
        openContextMenu({ kind: 'tab', path: tab.dataset.path }, event.clientX, event.clientY);
        return;
      }
      const row = target?.closest('.file-row[data-path]') as HTMLElement | null;
      if (row?.dataset.path) {
        explorerSelection = row.dataset.path;
        if (row.dataset.directory === 'true')
          updateExplorerState({ ...explorerState, workingDirectory: row.dataset.path });
        openContextMenu(
          {
            kind: 'file',
            path: row.dataset.path,
            directory: row.dataset.directory === 'true',
            document: row.dataset.document === 'document',
          },
          event.clientX,
          event.clientY,
        );
        return;
      }
      openContextMenu({ kind: 'app' }, event.clientX, event.clientY);
    };
    document.addEventListener('contextmenu', handleContextMenu);
    if (browserAvailable()) {
      void browserSetVisible(false).catch(() => {});
      void listenBrowser((value) => {
        if (!disposed) browser = value;
      })
        .then((unlisten) => {
          if (!unlisten) return;
          if (disposed) unlisten();
          else unlistenBrowser = unlisten;
        })
        .catch((error) => console.error('Browser events unavailable:', error));
    }
    (async () => {
      let configurationError = '';
      if (desktop) {
        try {
          const configured = await invokeHost<Record<string, unknown> | null>(
            'declarative_preferences',
          );
          if (configured && !disposed) {
            preferences = mergePreferences($state.snapshot(preferences), configured);
            configuredPreferences = configured;
          }
        } catch (error) {
          configurationError = `Could not load configuration: ${String(error)}`;
        }
        try {
          uninstallControl = await installControl(executeControl);
          if (disposed) {
            uninstallControl();
            uninstallControl = undefined;
            resolveWorkspaceReady();
            return;
          }
          await markControlReady();
        } catch (error) {
          console.error('Control bridge unavailable:', error);
        }
      }
      try {
        if (desktop) {
          const { source, initial } = await desktopSource(() => preferences);
          traceStartup('source-ready');
          if (disposed) return;
          await workspace.changeSource(source);
          const home = (window as unknown as { __PAPYRI_HOME__?: string }).__PAPYRI_HOME__ ?? '';
          const recent = startupRecentProject(initial, recentFolders, home);
          let startup = initial;
          let startupFile: string | undefined;
          if (recent) {
            try {
              await source.list(recent.path);
              startup = { ...initial, path: recent.path, directory: true };
              startupFile = recent.lastFile;
            } catch {
              recentFolders = recentFolders.filter((folder) => folder.path !== recent.path);
              persistRecentFolders(recentFolders);
            }
          }
          if (startup.directory) {
            workspace.directory = workspace.searchRoot = startup.path;
            if (startupFile) {
              updateRecentFolders(startup.path, startupFile);
              await workspace.open(startupFile);
              if (workspace.active !== startupFile) updateRecentFolders(startup.path, null);
            } else {
              updateRecentFolders(startup.path);
            }
          } else {
            workspace.directory = dirname(startup.path);
            workspace.searchRoot = dirname(startup.path);
            await workspace.open(startup.path);
            if (workspace.active === startup.path) traceStartup('file-ready');
          }
        } else {
          await workspace.changeSource(demoSource());
          await workspace.open('/welcome.md');
        }
      } catch (error) {
        workspace.error = String(error);
      } finally {
        if (configurationError && !disposed)
          workspace.error = [workspace.error, configurationError].filter(Boolean).join('\n');
        resolveWorkspaceReady();
      }
    })();
    const timer = setInterval(() => {
      if (!document.hidden && workspace.source?.live) void refresh();
    }, 2000);
    return () => {
      disposed = true;
      uninstallControl?.();
      unlistenBrowser?.();
      document.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('beforeunload', protectDrafts);
      if (copyTimer) clearTimeout(copyTimer);
      if (controlPublishTimer) clearTimeout(controlPublishTimer);
      clearInterval(timer);
    };
  });
</script>

<svelte:window
  onkeydown={keyboard}
  bind:innerWidth={viewportWidth}
  bind:innerHeight={viewportHeight}
/>
<div class="app-shell" class:decorationless data-theme={preferences.theme}>
  <div class="app-main">
    <header class="app-header" class:compact={layoutWidth < MIN_HEADER_BRAND_WIDTH}>
      <div class="brand">
        <span class="brand-mark" aria-hidden="true"><span class="app-logo"></span></span><strong
          >Papyri</strong
        >
      </div>
      <button
        class="icon-button explorer-toggle"
        class:enabled={sidebar}
        aria-label="Toggle explorer"
        title="Toggle explorer (Ctrl B)"
        onclick={toggleExplorer}><PanelLeft size={17} /></button
      >
      <span class="header-spacer"></span>
      <div class="tabs-scroll" role="group" aria-label="Open documents">
        {#each workspace.tabs as tab (tab.path)}<div
            class="tab-item"
            class:selected={workspace.active === tab.path}
            data-path={tab.path}
          >
            <button
              aria-pressed={workspace.active === tab.path}
              class="tab-select"
              title={displayPath(tab.path)}
              onclick={() => workspace.open(tab.path)}
              ><FileIcon name={basename(tab.path)} /><span>{basename(tab.path)}</span></button
            >{#if workspace.active === tab.path && isMarkdown(tab.path)}<button
                class="tab-trust"
                class:trusted
                aria-label={trusted
                  ? 'Scripts enabled: disable document scripts'
                  : 'Safe preview: trust current document for scripts'}
                title={trusted ? 'Scripts enabled' : 'Safe preview'}
                onclick={(event) => {
                  event.stopPropagation();
                  if (trusted) trustedPath = '';
                  else trustDialog = true;
                }}><Shield size={11} /></button
              >{/if}<button
              class="tab-close"
              aria-label="Close {basename(tab.path)}"
              onclick={() => workspace.close(tab.path)}><X size={12} /></button
            >
          </div>{/each}
      </div>
      <span class="header-spacer"></span>
      <div class="view-actions">
        {#if workspace.active && !isBibliography(workspace.active)}<button
            class="icon-button"
            class:enabled={editorVisible}
            aria-label={editorVisible ? 'Show preview' : 'Edit source'}
            title={editorVisible ? 'Show preview' : 'Edit source'}
            disabled={isPdf(workspace.active) || !workspace.source?.write || editorBusy}
            onclick={() => {
              if (editorVisible) editing = false;
              else void openEditor();
            }}><Code size={17} /></button
          >{/if}
        {#if editorVisible}<button
            class="icon-button"
            aria-label="Save source"
            title={editorDirty ? 'Save source (Ctrl S)' : 'No unsaved changes'}
            disabled={!editorDirty || editorBusy}
            onclick={() => void saveEditor()}><Save size={17} /></button
          ><button
            class="icon-button"
            aria-label="Reload source"
            title="Reload source from disk"
            disabled={editorBusy}
            onclick={() => void reloadEditor()}><RefreshCw size={17} /></button
          >{/if}
        {#if workspace.active}<button
            class="icon-button"
            class:enabled={searchOpen}
            aria-label="Search document"
            title="Find in document (Ctrl F)"
            onclick={() => {
              searchOpen = !searchOpen;
              if (!searchOpen) query = '';
            }}><Search size={17} /></button
          ><button
            class="icon-button"
            class:enabled={!!workspace.secondary}
            aria-label="Toggle split view"
            title="Toggle split view (Ctrl \\)"
            onclick={split}><Columns2 size={17} /></button
          ><button
            class="copy-raw"
            class:copied={copyState === 'copied'}
            class:failed={copyState === 'error'}
            aria-label="Copy raw content of the active document"
            title="Copy raw content of the active document"
            disabled={!canCopyRaw}
            onclick={copyRawDocument}
            >{#if copyState === 'copied'}<Check size={14} />{:else}<Copy size={14} />{/if}<span
              >{copyState === 'copied'
                ? 'Copied'
                : copyState === 'error'
                  ? 'Copy failed'
                  : 'Copy raw'}</span
            ></button
          >{/if}<button
          class="icon-button"
          aria-label="Settings"
          title="Settings (Ctrl ,)"
          onclick={() => (settings = true)}><SettingsIcon size={18} /></button
        ><button
          class="icon-button"
          class:enabled={outline}
          aria-label="Toggle right panel"
          title="Toggle right panel"
          onclick={toggleRightPanel}><PanelRight size={17} /></button
        >
      </div>
    </header>
    <div class="workspace">
      {#if sidebar}
        <aside
          id="file-explorer"
          class="sidebar"
          style:--sidebar-width="{sidebarWidth}px"
          aria-label="File explorer"
        >
          <div class="explorer-path-row">
            <form
              class="path-form"
              onsubmit={(event) => {
                event.preventDefault();
                useFolder(normalize(expandHomePath(pathInput)), false);
              }}
            >
              <input aria-label="Directory path" bind:value={pathInput} spellcheck="false" /><button
                class="icon-button small"
                aria-label="Go to directory"><ChevronRight size={14} /></button
              >
            </form>
            <button
              class="icon-button small parent-folder-icon"
              aria-label="Parent folder"
              title="Parent folder"
              onclick={() => {
                workspace.directory = dirname(workspace.directory);
                workspace.treeRevision++;
              }}
              disabled={workspace.directory === workspace.source?.root ||
                isRootPath(workspace.directory)}><ArrowUp size={14} /></button
            >
          </div>
          <div class="explorer-tools">
            <span>EXPLORER</span>
            <div>
              {#if workspace.source?.create}<button
                  class="icon-button small"
                  aria-label="Create file or folder"
                  title="Create in {displayPath(explorerState.workingDirectory)}"
                  onclick={() => {
                    if (workspace.source)
                      createTarget = {
                        source: workspace.source,
                        directory: explorerState.workingDirectory,
                      };
                  }}><Plus size={15} /></button
                >{/if}
              <button class="icon-button small" aria-label="Open documents" onclick={chooseFile}
                ><FileText size={15} /></button
              ><button class="icon-button small" aria-label="Refresh files" onclick={refresh}
                ><RefreshCw size={14} /></button
              >
            </div>
          </div>
          <div class="explorer-breadcrumb" title={displayPath(explorerState.workingDirectory)}>
            <FileIcon name={basename(workspace.directory)} directory expanded />
            <span>{basename(workspace.directory)}</span>
            {#if explorerState.workingDirectory !== workspace.directory}
              <ChevronRight size={12} /><strong>{basename(explorerState.workingDirectory)}</strong>
            {/if}
          </div>
          <div class="explorer-scroll">
            {#if workspace.source}<Explorer
                source={workspace.source}
                path={workspace.directory}
                revision={workspace.treeRevision}
                active={workspace.active}
                onopen={openDocument}
                expanded={explorerState.expanded}
                workingDirectory={explorerState.workingDirectory}
                ontoggle={toggleExplorerFolder}
                selected={explorerSelection}
                onselect={(path) => (explorerSelection = path)}
                {renamePath}
                {renameBusy}
                onrename={(path, name) => void renameExplorerFile(path, name)}
                oncancelrename={() => (renamePath = '')}
                onbeginrename={(path) => (renamePath = path)}
              />{/if}
          </div>
          <div class="explorer-actions">
            <button class="btn btn-primary btn-sm open-folder-action" onclick={chooseFolder}
              ><FolderOpen size={14} /><span>Open folder</span></button
            >
            <button
              class="btn btn-ghost btn-sm recent-action"
              aria-expanded={recentOpen}
              aria-haspopup="dialog"
              onclick={() => (recentOpen = !recentOpen)}
              ><History size={14} /><span>Recent</span></button
            >
            {#if recentOpen}<dialog
                use:openDialog
                class="modal modal-open"
                aria-labelledby="recent-title"
                oncancel={() => (recentOpen = false)}
              >
                <div class="modal-box recent-dialog">
                  <div class="recent-dialog-head">
                    <h2 id="recent-title">Recent folders</h2>
                    <button
                      class="icon-button recent-dialog-close"
                      aria-label="Close recent folders"
                      onclick={() => (recentOpen = false)}><X size={16} /></button
                    >
                  </div>
                  <p class="recent-dialog-lead">Pick up where you left off.</p>
                  {#if recentFolders.length}
                    <div class="recent-dialog-list">
                      {#each recentFolders as folder (folder.path)}<button
                          class="recent-dialog-item"
                          onclick={() => {
                            recentOpen = false;
                            void openRecentProject(folder.path, folder.lastFile);
                          }}
                        >
                          <FileIcon name={basename(folder.path)} directory />
                          <span class="recent-dialog-copy">
                            <strong>{displayPath(folder.path)}</strong>
                            {#if folder.lastFile}<small>{basename(folder.lastFile)}</small>{/if}
                          </span>
                          <ChevronRight size={14} />
                        </button>{/each}
                    </div>
                  {:else}<p class="recent-dialog-empty">No recent folders yet.</p>{/if}
                  <div class="modal-action recent-dialog-actions">
                    <button
                      class="btn btn-ghost"
                      onclick={() => {
                        recentOpen = false;
                        void chooseFolder();
                      }}>Open folder…</button
                    >
                  </div>
                </div>
              </dialog>{/if}
          </div>
        </aside>
        <SidebarResize
          width={sidebarWidth}
          maximum={maximumSidebarWidth}
          scale={uiScale}
          onresize={resizeSidebar}
          oncommit={() => updatePreferences(preferences)}
        />
      {/if}
      <main class="main-workspace">
        {#if searchOpen}<div class="search-bar">
            <Search size={16} /><input
              bind:this={searchInput}
              bind:value={query}
              placeholder="Find in document…"
              aria-label="Find in document"
            /><span class="hint"
              >{isMarkdown(workspace.active)
                ? 'Highlights up to 2,000 matches'
                : 'Search PDF text'}</span
            ><button
              class="icon-button small"
              aria-label="Close search"
              onclick={() => {
                searchOpen = false;
                query = '';
              }}><X size={15} /></button
            >
          </div>{/if}
        {#if workspace.error}<div class="error-banner" role="alert">
            <span>{displayPathMessage(workspace.error)}</span><button
              class="icon-button small"
              aria-label="Dismiss error"
              onclick={() => (workspace.error = '')}><X size={14} /></button
            >
          </div>{/if}
        {#if editorError}<div class="error-banner" role="alert">
            <span>{displayPathMessage(editorError)}</span><button
              class="icon-button small"
              aria-label="Dismiss editor error"
              onclick={() => (editorError = '')}><X size={14} /></button
            >
          </div>{/if}
        {#if workspace.activeTab?.error && !editorVisible && (!workspace.activeTab.compilationError || workspace.activeTab.bytes || !/compilation failed/i.test(workspace.activeTab.compilationError))}<div
            class="error-banner"
            role="alert"
          >
            {displayPathMessage(workspace.activeTab.error)}
          </div>{/if}
        <div class="reading-layout">
          <div class="panes" class:split={!!workspace.secondary}>
            {#if workspace.activeTab && workspace.source}
              {#if editorVisible && editorDraft && SourceEditor}
                <div
                  class="typst-editor-layout"
                  class:live={(!!typstPreviewRoot ||
                    editorLanguage === 'markdown' ||
                    editorLanguage === 'latex') &&
                    typstLiveVisible}
                  style={`--typst-source-share: ${typstSourceShare}%`}
                >
                  <div class="typst-editor-source">
                    {#if typstPreviewRoot || editorLanguage === 'markdown' || editorLanguage === 'latex'}
                      <div class="typst-editor-heading">
                        <span title={displayPath(editorDraft.path)}
                          >Editing {basename(editorDraft.path)}</span
                        >
                        {#if (typstPreviewRoot || latexPreviewRoot) && editorDraft.path !== (typstPreviewRoot || latexPreviewRoot)}
                          <button
                            class="btn btn-ghost btn-xs"
                            onclick={() =>
                              void openPreviewSource({
                                path: typstPreviewRoot || latexPreviewRoot,
                                line: 0,
                                character: 0,
                              })}>Main document</button
                          >
                        {/if}
                        <button
                          class="btn btn-ghost btn-xs"
                          onclick={() => (typstLiveVisible = !typstLiveVisible)}
                          >{editorLanguage === 'latex'
                            ? typstLiveVisible
                              ? 'Hide PDF preview'
                              : 'Show PDF preview'
                            : typstLiveVisible
                              ? 'Hide live preview'
                              : 'Show live preview'}</button
                        >
                      </div>
                    {/if}
                    {#key `${editorDraft.path}\0${preferences.languageServerPaths[editorLanguage]}\0${languageServerRoot ?? ''}\0${editorInstanceRevision}`}<SourceEditor
                        bind:this={sourceEditor}
                        path={editorDraft.path}
                        language={editorLanguage}
                        serverPath={preferences.languageServerPaths[editorLanguage]}
                        root={languageServerRoot}
                        delimiters={preferences.delimiters}
                        project={latexProjectMetadata}
                        initialText={editorDraft.text}
                        onchange={updateEditor}
                        onsave={() => void saveEditor()}
                        onposition={(line, character) => syncSourcePosition(line, character)}
                        onstatus={(message) => (editorServerStatus = message)}
                        ondiagnostics={(value) => {
                          editorDiagnostics = value;
                          editorRevision++;
                        }}
                        buildFailure={editorBuildFailure}
                      />{/key}
                  </div>
                  {#if typstPreviewRoot && typstLiveVisible && TypstLivePreview}
                    <EditorSplitHandle
                      value={typstSourceShare}
                      onresize={(value) => (typstSourceShare = value)}
                    />
                    {#key `${typstPreviewRoot}\0${preferences.languageServerPaths.typst}`}<TypstLivePreview
                        bind:this={typstPreview}
                        path={typstPreviewRoot}
                        serverPath={preferences.languageServerPaths.typst}
                        getDocuments={typstDocuments}
                        diagnostics={editorDiagnostics}
                        onjump={(location) => void openPreviewSource(location)}
                      />{/key}
                  {/if}
                  {#if editorLanguage === 'markdown' && typstLiveVisible}
                    <EditorSplitHandle
                      value={typstSourceShare}
                      onresize={(value) => (typstSourceShare = value)}
                    />
                    <div class="markdown-live-preview">
                      <div class="typst-editor-heading">
                        <span>Live preview</span>
                        <ZoomControls
                          label="live preview"
                          value={preferences.documentZoom}
                          onchange={(action) => zoom({ target: 'document', action })}
                        />
                        <button
                          class="icon-button small"
                          aria-label="Fit live preview to width"
                          title="Fit to width"
                          onclick={() =>
                            updatePreferences({
                              ...preferences,
                              documentZoom: 100,
                              fitWidth: true,
                            })}><Maximize2 size={14} /></button
                        >
                      </div>
                      <Preview
                        bind:this={markdownPreview}
                        tab={{
                          ...workspace.activeTab,
                          text: markdownPreviewText,
                          bytes: undefined,
                        }}
                        scrollPosition={markdownPreviewScroll}
                        source={workspace.source}
                        {preferences}
                        trusted={false}
                        query=""
                        anchor={null}
                        onlink={(href) => follow(href, workspace.activeTab!.path)}
                        onheadings={() => {}}
                        onscroll={(_path, y) => (markdownPreviewScroll = y)}
                        oncommand={viewCommand}
                        onsourcejump={(line) => sourceEditor?.reveal(line, 0)}
                      />
                    </div>
                  {/if}
                  {#if editorLanguage === 'latex' && typstLiveVisible}
                    <EditorSplitHandle
                      value={typstSourceShare}
                      onresize={(value) => (typstSourceShare = value)}
                    />
                    {#if workspace.busy && workspace.openingPath === (latexPreviewRoot || editorDraft.path)}
                      <div class="latex-preview-wait" role="status">
                        <span class="loading loading-spinner loading-sm"></span>
                        Compiling {basename(workspace.openingPath || editorDraft.path)}…
                      </div>
                    {:else}
                      {#key latexPreviewRoot}
                        <LatexLivePreview
                          bind:this={latexPreview}
                          path={latexPreviewRoot || editorDraft.path}
                          text={editorDraft.path === latexPreviewRoot
                            ? editorText
                            : (drafts.get(editorSource!)?.get(latexPreviewRoot)?.text ??
                              editorText)}
                          savedText={editorDraft.path === latexPreviewRoot
                            ? editorDraft.expectedText
                            : (drafts.get(editorSource!)?.get(latexPreviewRoot)?.expectedText ??
                              '')}
                          initialTab={workspace.activeTab}
                          source={workspace.source}
                          {preferences}
                          onpreferences={updatePreferences}
                          oncommand={viewCommand}
                          onjump={(location) => void openPreviewSource(location)}
                          onbuildfailure={(failure) => (latexEditorFailure = failure)}
                          overlays={latexOverlays}
                        />
                      {/key}
                    {/if}
                  {/if}
                </div>
              {:else if isBibliography(workspace.active)}
                {#key workspace.active}<BibliographyView
                    path={workspace.active}
                    text={workspace.activeTab?.text ?? ''}
                    project={latexProjectMetadata}
                    oncopy={copyText}
                    onopen={(url) => void invokeHost('open_external', { url })}
                    onappend={appendBibliographyEntry}
                    canadd={!!workspace.source?.write}
                  />{/key}
              {:else}
                {#key workspace.active}<Preview
                    bind:this={primaryPreview}
                    tab={workspace.activeTab}
                    source={workspace.source}
                    {preferences}
                    {trusted}
                    {query}
                    anchor={workspace.anchor}
                    onanchorconsumed={(request) => workspace.consumeAnchor(request)}
                    onlink={(href) => follow(href, workspace.activeTab!.path)}
                    oncommand={viewCommand}
                    onscroll={(path, y) => workspace.setScroll(path, y)}
                    onscrollprogress={(path, progress) => {
                      if (path === workspace.active)
                        activeScrollProgress = { path, value: Math.max(0, Math.min(1, progress)) };
                    }}
                    onrendererror={(path, error) => void workspace.showSource(path, error)}
                    onbuildjump={(line) => void openEditorAt(Math.max(0, line - 1))}
                    onbuildretry={() => void workspace.refresh()}
                    onbuildcopy={(text) => void copyBuildLog(text)}
                    ondismiss={dismiss}
                    onheadings={(value) => {
                      headings = value;
                      headingsPath = workspace.active;
                    }}
                    onselection={openSelectionMenu}
                    onpagecontext={openPageContext}
                    onselectionstats={(info) =>
                      (selectionStats = info.words || info.characters ? info : null)}
                    onmatches={(count) => (searchMatches = count)}
                    onpdfpassword={(required) => {
                      pdfLocked = required;
                      if (required && workspace.activeTab?.bytes && !pdfPage.total)
                        pdfPage = { path: workspace.active, page: 0, total: 0 };
                    }}
                    onselectioncopy={(info) =>
                      void copyPreviewSelection(info.kind, info.text, info.source)}
                    onpdfpage={(path, page, total) => {
                      if (path === workspace.active) {
                        pdfPage = { path, page, total };
                        pdfLocked = false;
                      }
                    }}
                    onpdfscale={(value) => {
                      const pdfZoom = clampZoom(value, MIN_PDF_ZOOM, MAX_PDF_ZOOM);
                      if (pdfZoom !== preferences.pdfZoom)
                        updatePreferences({ ...preferences, pdfZoom });
                    }}
                  />{/key}
              {/if}
              {#if workspace.secondaryTab}<div class="secondary-pane">
                  <div class="secondary-heading">
                    {basename(workspace.secondaryTab.path)}<button
                      class="icon-button small"
                      aria-label="Close split view"
                      onclick={() => (workspace.secondary = '')}><X size={14} /></button
                    >
                  </div>
                  {#if workspace.secondaryTab.error}<div class="error-banner" role="alert">
                      {displayPathMessage(workspace.secondaryTab.error)}
                    </div>{/if}
                  <Preview
                    bind:this={secondaryPreview}
                    tab={workspace.secondaryTab}
                    scrollPosition={workspace.secondaryPosition}
                    source={workspace.source}
                    {preferences}
                    trusted={false}
                    {query}
                    anchor={null}
                    onlink={(href) => follow(href, workspace.secondaryTab!.path)}
                    oncommand={viewCommand}
                    onscroll={(path, y) => workspace.setSecondaryScroll(path, y)}
                    onrendererror={(path, error) => void workspace.showSource(path, error)}
                    buildView={false}
                    ondismiss={dismiss}
                    onheadings={() => {}}
                    onselection={openSelectionMenu}
                    onselectioncopy={(info) =>
                      void copyPreviewSelection(info.kind, info.text, info.source)}
                  />
                </div>{/if}
            {:else}<div class="empty-state">
                <span class="empty-icon" aria-hidden="true"><span class="app-logo"></span></span>
                <h1>No document open</h1>
                <p>Open a Markdown, PDF, Typst, or LaTeX document, or choose a folder.</p>
                <button class="btn btn-primary" onclick={chooseFile}
                  ><FileText size={17} />Open a document</button
                ><button class="btn btn-ghost btn-sm" onclick={chooseFolder}>Browse a folder</button
                >
              </div>{/if}
            {#if workspace.busy && (isTypst(workspace.openingPath) || isLatex(workspace.openingPath))}
              <div class="compile-loading" role="status" aria-live="polite">
                <div class="compile-papyrus" aria-hidden="true"><span></span></div>
                <strong>Preparing your document</strong>
                <span>Compiling {basename(workspace.openingPath)}…</span>
                {#if desktop}<button
                    class="btn btn-ghost btn-xs"
                    onclick={() => (compileLogOpen = true)}>Open log</button
                  >{/if}
                {#if desktop && isLatex(workspace.openingPath)}<button
                    class="btn btn-ghost btn-xs"
                    onclick={() => void cancelOpeningCompile()}>Cancel</button
                  >{/if}
              </div>
            {/if}
          </div>
        </div>
      </main>
    </div>
    <footer class="status-bar">
      <div class="status-left">
        <span class="status-cadence" title={liveStatus}>
          <span
            class="status-dot"
            class:live={!workspace.busy && workspace.source?.live}
            class:busy={workspace.busy}
            class:snapshot={!workspace.busy && !workspace.source?.live}
          ></span>
          <span class="status-interval">{refreshLabel}</span>
        </span>
        {#if showProgress}<span
            class="status-progress"
            role="img"
            aria-label={`Reading progress ${progressPercent}%`}
            title={`${progressPercent}% read`}
            style:--read-progress="{progressPercent}%"
            ><span class="status-ring" aria-hidden="true"></span><span class="status-progress-value"
              >{progressPercent}%</span
            ></span
          >{/if}
      </div>
      <div class="status-stats" class:selection={!!selectionStats}>
        {#if selectionStats}<span>{selectionStats.words.toLocaleString()} words selected</span><span
            class="status-separator"
            aria-hidden="true">·</span
          ><span>{selectionStats.characters.toLocaleString()} characters selected</span
          >{:else if documentStats?.words !== null && documentStats?.words !== undefined}<span
            >{documentStats.words.toLocaleString()}
            <span class="metric-long">words</span><span class="metric-short">w</span></span
          ><span class="status-separator" aria-hidden="true">·</span><span
            >{documentStats.characters.toLocaleString()}
            <span class="metric-long">characters</span><span class="metric-short">chars</span></span
          ><span class="status-separator read-time-separator" aria-hidden="true">·</span><span
            class="read-time">{documentStats.minutes} min read</span
          >{:else if documentStats?.bytes !== null && documentStats?.bytes !== undefined}<span
            >{(documentStats.bytes / 1024).toFixed(1)} KiB</span
          ><span class="status-separator" aria-hidden="true">·</span><span
            >{documentStats.pages
              ? `PDF · page ${pdfPage.page} / ${documentStats.pages}`
              : 'PDF'}</span
          >{:else}<span>No document</span>{/if}
      </div>
      <div class="status-controls">
        {#if desktop && hasCompilableTab}<button
            class="status-log"
            aria-label="Open compilation log"
            title="Compilation log"
            onclick={() => (compileLogOpen = true)}
            ><SquareTerminal size={11} /><span>Log</span></button
          >{/if}
        <button
          class="status-fit"
          class:enabled={preferences.fitWidth}
          aria-label="Fit document to width"
          aria-pressed={preferences.fitWidth}
          title="Fit document to width (Ctrl =)"
          onclick={() => viewCommand({ target: 'document', action: 'fit-width' })}
          ><Maximize2 size={10} /><span>Fit</span></button
        >
        <ZoomControls
          label="document"
          value={pagedDocument ? preferences.pdfZoom : preferences.documentZoom}
          minimum={pagedDocument ? MIN_PDF_ZOOM : MIN_ZOOM}
          maximum={pagedDocument ? MAX_PDF_ZOOM : MAX_ZOOM}
          onchange={(action) => zoom({ target: 'document', action })}
        />
        <button
          class="status-help"
          aria-label="Keyboard shortcuts and help"
          title="Keyboard shortcuts"
          onclick={() => (help = true)}><CircleHelp size={13} /></button
        >
      </div>
    </footer>
  </div>
  {#if outline}<SidePanel
      bind:this={sidePanel}
      headings={headingsPath === workspace.active ? headings : []}
      activePath={workspace.active}
      hasDocument={!!workspace.activeTab}
      tab={rightTab}
      {browser}
      visible={browserVisible}
      width={panelWidth}
      maximum={maximumBrowserWidth}
      scale={uiScale}
      onselecttab={openRightTab}
      onresize={resizeBrowser}
      oncommit={() => updatePreferences(preferences)}
      onnavigate={navigateBrowser}
      onback={() => browserAction(browserBack)}
      onforward={() => browserAction(browserForward)}
      onreload={() => browserAction(browserReload)}
      onstop={() => browserAction(browserStop)}
      onopenexternal={openBrowserExternal}
      onopenwindow={openBrowserWindow}
      onbrowserzoom={zoomBrowser}
      onclosepanel={() => (outline = false)}
      onanchor={(id) => workspace.navigateAnchor(id)}
    />{/if}
</div>
{#if selectionMenu}
  <div
    class="selection-menu-layer"
    role="presentation"
    onclick={closeSelectionMenu}
    onkeydown={(event) => {
      if (event.key === 'Escape') closeSelectionMenu();
    }}
  >
    <div
      class="selection-menu action-pad"
      role="menu"
      tabindex="-1"
      aria-label="Selection actions"
      style:left="{selectionMenu.x}px"
      style:top="{selectionMenu.y}px"
      onclick={(event) => event.stopPropagation()}
      onkeydown={(event) => {
        const copyKey = event.key.toLowerCase() === 'c' || event.code === 'KeyC';
        if ((event.ctrlKey || event.metaKey) && copyKey) {
          event.preventDefault();
          void copySelection(event.shiftKey ? 'text' : 'source');
          event.stopPropagation();
          return;
        }
        if (event.key === 'Escape') closeSelectionMenu();
        event.stopPropagation();
      }}
    >
      <div class="pad-preview">
        <div class="pad-preview-head">
          <span class="pad-eyebrow">{previewSource ? 'Markdown source' : 'Selected text'}</span>
          <button
            type="button"
            class="pad-source-toggle"
            class:active={previewSource}
            aria-label="Toggle source preview"
            aria-pressed={previewPinned}
            title="Hover to show Markdown source; click to pin"
            onmouseenter={() => setPreviewSource(true)}
            onmouseleave={() => setPreviewSource(false)}
            onfocus={() => setPreviewSource(true)}
            onblur={() => setPreviewSource(false)}
            onclick={(event) => {
              event.stopPropagation();
              togglePreviewSource();
            }}
          >
            <Code size={12} /><span>Source</span>
          </button>
        </div>
        <div class="pad-preview-body">
          {#if previewSource}
            <pre class="pad-source-code">{selectionMenu.source}</pre>
          {:else if selectionMenu.preview}
            <!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized on receipt -->
            <div class="pad-rendered">{@html selectionMenu.preview}</div>
          {:else}
            <div class="pad-rendered"><p>{selectionMenu.text}</p></div>
          {/if}
        </div>
      </div>
      <div class="pad-grid">
        <button
          type="button"
          class="pad-tile primary"
          role="menuitem"
          aria-label="Copy source"
          onclick={() => void copySelection('source')}
        >
          <Code size={16} />
          <span class="pad-tile-copy"
            ><strong>Copy source</strong><small>Markdown block</small></span
          >
          <kbd>Ctrl C</kbd>
        </button>
        <button
          type="button"
          class="pad-tile"
          role="menuitem"
          aria-label="Copy selected text"
          onclick={() => void copySelection('text')}
        >
          <TypeIcon size={16} />
          <span class="pad-tile-copy"
            ><strong>Copy text</strong><small>Rendered selection</small></span
          >
          <kbd>Ctrl ⇧ C</kbd>
        </button>
      </div>
      <div class="pad-row" class:sites={browserAvailable()}>
        <button
          type="button"
          class="pad-chip"
          role="menuitem"
          aria-label="Copy as quote"
          onclick={() => void copySelection('quote')}
        >
          <TextQuote size={14} /><span>Quote</span>
        </button>
        {#if browserAvailable()}
          <button
            type="button"
            class="pad-chip site-chatgpt"
            role="menuitem"
            aria-label="Send to ChatGPT"
            onclick={() => void sendSelectionTo('chatgpt')}
          >
            <SiteIcon site="chatgpt" size={14} /><span>ChatGPT</span>
          </button>
          <button
            type="button"
            class="pad-chip site-gemini"
            role="menuitem"
            aria-label="Send to Gemini"
            onclick={() => void sendSelectionTo('gemini')}
          >
            <SiteIcon site="gemini" size={14} /><span>Gemini</span>
          </button>
          <button
            type="button"
            class="pad-chip site-wikipedia"
            role="menuitem"
            aria-label="Search Wikipedia"
            onclick={() => void searchSelectionWikipedia()}
          >
            <SiteIcon site="wikipedia" size={14} /><span>Wikipedia</span>
          </button>
        {/if}
      </div>
    </div>
  </div>
{/if}
{#if contextMenu}
  <div
    class="context-menu-layer"
    role="presentation"
    onclick={closeContextMenu}
    onkeydown={(event) => {
      if (event.key === 'Escape') closeContextMenu();
    }}
  >
    <div
      class="context-menu"
      role="menu"
      tabindex="-1"
      aria-label="Context actions"
      style:left="{contextMenu.x}px"
      style:top="{contextMenu.y}px"
      onclick={(event) => event.stopPropagation()}
      onkeydown={contextMenuKeydown}
    >
      {#if contextMenuTitle}<div class="context-menu-title">{contextMenuTitle}</div>{/if}
      {#each contextMenuItems as item, index (index)}
        {#if 'separator' in item}
          <div class="context-menu-separator"></div>
        {:else}
          {@const Icon = contextIcons[item.label] ?? FileText}
          <button
            type="button"
            role="menuitem"
            class:context-destructive={item.label === 'Delete file…'}
            onclick={() => runContextMenuEntry(item)}
          >
            <Icon size={15} aria-hidden="true" />
            <span>{item.label}</span>
            {#if item.shortcut}<span class="context-shortcut">{item.shortcut}</span>{/if}
          </button>
        {/if}
      {/each}
    </div>
  </div>
{/if}
<input
  class="hidden-input"
  type="file"
  multiple
  bind:this={fileInput}
  onchange={importFiles}
  aria-label="Import selected files"
/>
<input
  class="hidden-input"
  type="file"
  webkitdirectory
  multiple
  bind:this={folderInput}
  onchange={importFiles}
  aria-label="Import selected folder"
/>
{#if settings}<Settings
    bind:this={settingsPanel}
    {preferences}
    {toolBusy}
    {toolMessage}
    {toolError}
    ondownloadtools={async (names) => {
      await downloadManagedTools(names);
    }}
    onmanagetexlive={async (action) => {
      await manageTexLive(action);
    }}
    ontoolerror={(message) => (toolError = message)}
    onclose={() => (settings = false)}
    onchange={updatePreferences}
  />{/if}
{#if desktop && compileLogOpen}<CompileLog
    width={preferences.logWidth}
    height={preferences.logHeight}
    oncopy={writeClipboard}
    onclose={() => (compileLogOpen = false)}
  />{/if}
{#if paletteOpen && workspace.source}<CommandPalette
    source={workspace.source}
    directory={workspace.directory}
    workspaceRoot={workspace.searchRoot}
    commands={paletteCommands}
    headings={headingsPath === workspace.active ? headings : []}
    tabs={workspace.tabs.map((tab) => tab.path)}
    recentFiles={workspace.recentFiles}
    {recentCommands}
    {recentFolders}
    pdfPages={pdfPage.path === workspace.active && pagedDocument ? pdfPage.total : 0}
    onclose={() => (paletteOpen = false)}
    onopen={(path) => void openDocument(path)}
    onopenfolder={(path, lastFile) => void openRecentProject(path, lastFile)}
    oncommand={runPaletteCommand}
    onheading={(id) => workspace.navigateAnchor(id)}
    oncontent={(path, text) => {
      query = text;
      searchOpen = true;
      void openDocument(path);
    }}
    onpage={(page) => workspace.navigateAnchor(`page=${page}`)}
  />{/if}
{#if createTarget}<CreateEntry
    source={createTarget.source}
    directory={createTarget.directory}
    initialKind={createTarget.initialKind}
    onclose={() => (createTarget = null)}
    oncreated={(path, kind) => {
      if (createTarget) void entryCreated(createTarget.source, path, kind);
    }}
  />{/if}
{#if trustDialog}<dialog
    use:openDialog
    class="modal modal-open"
    aria-labelledby="trust-title"
    oncancel={() => (trustDialog = false)}
  >
    <div class="modal-box">
      <Shield size={28} />
      <h2 id="trust-title">Trust this document?</h2>
      <p>
        Its JavaScript will run inside an isolated frame. It can read everything in this document
        and its embedded images, consume resources, and contact the network by navigating its frame.
        It cannot access Papyri’s filesystem API.
      </p>
      <p>
        Trust only documents you understand. Document links cannot request host navigation while
        scripts run. Trust resets when you switch documents; changed trusted files must be trusted
        again.
      </p>
      <div class="modal-action">
        <button class="btn btn-ghost" onclick={() => (trustDialog = false)}
          >Keep safe preview</button
        ><button
          class="btn btn-primary"
          onclick={() => {
            trustedPath = workspace.active;
            trustedRevision = workspace.activeTab?.revision ?? -1;
            trustedSource = workspace.source;
            trustDialog = false;
          }}>Enable scripts for this document</button
        >
      </div>
    </div>
  </dialog>{/if}
{#if help}<dialog
    use:openDialog
    class="modal modal-open"
    aria-labelledby="help-title"
    oncancel={() => (help = false)}
  >
    <div class="modal-box">
      <h2 id="help-title">Keyboard shortcuts</h2>
      <dl class="shortcuts">
        <dt>Command palette and file search</dt>
        <dd>Ctrl K</dd>
        <dt>Decoration-less mode</dt>
        <dd>Ctrl Shift D / Esc to exit</dd>
        <dt>Open file</dt>
        <dd>Ctrl O</dd>
        <dt>Open folder</dt>
        <dd>Ctrl Shift O</dd>
        <dt>Find in document</dt>
        <dd>Ctrl F</dd>
        <dt>Toggle explorer</dt>
        <dd>Ctrl B</dd>
        <dt>Split preview</dt>
        <dd>Ctrl \</dd>
        <dt>Browser panel (ChatGPT, Wikipedia, Gemini)</dt>
        <dd>Ctrl Shift B</dd>
        <dt>Focus browser address</dt>
        <dd>Ctrl L</dd>
        <dt>Next / previous tab</dt>
        <dd>Ctrl Tab / Ctrl Shift Tab</dd>
        <dt>Fit document to width</dt>
        <dd>Ctrl =</dd>
        <dt>Close tab</dt>
        <dd>Ctrl W</dd>
        <dt>Zoom document in / out / reset</dt>
        <dd>Ctrl + / − / 0</dd>
        <dt>Zoom UI in / out / reset</dt>
        <dd>Ctrl Alt + / − / 0</dd>
        <dt>Resize explorer or right panel</dt>
        <dd>Drag divider; arrows when focused</dd>
        <dt>Copy raw source</dt>
        <dd>Copy raw button in the top line</dd>
        <dt>Copy Markdown selection source</dt>
        <dd>Ctrl C</dd>
        <dt>Copy rendered selection text</dt>
        <dd>Ctrl Shift C</dd>
        <dt>Copy or quote a Markdown selection</dt>
        <dd>Select text, then right-click</dd>
        <dt>Context actions</dt>
        <dd>Right-click the app, a tab, a file, or the document</dd>
        <dt>Preferences</dt>
        <dd>Ctrl ,</dd>
        <dt>Dismiss panels</dt>
        <dd>Esc</dd>
      </dl>
      <p>
        Zoom shortcuts work while the document has focus too. Document zoom and Fit live in the
        bottom bar; UI zoom controls are in Settings. Decoration-less mode hides the one-line shell
        and status bar, so use shortcuts or the command palette there.
      </p>
      <div class="modal-action">
        <button class="btn btn-primary" onclick={() => (help = false)}>Close</button>
      </div>
    </div>
  </dialog>{/if}

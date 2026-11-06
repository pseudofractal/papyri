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
  } from '@lucide/svelte';
  import ZoomControls from './components/ZoomControls.svelte';
  import SidebarResize from './components/SidebarResize.svelte';
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
  import Preview from './components/Preview.svelte';
  import Settings from './components/Settings.svelte';
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
    emptyBrowserState,
    listenBrowser,
    type BrowserState,
  } from './lib/browser';
  import { Workspace } from './lib/workspace.svelte';
  import { native, desktopSource, importedSource, browserDirectory } from './lib/sources';
  import { demoSource } from './lib/demo';
  import { loadPreferences } from './lib/preferences';
  import {
    loadRecentFolders,
    persistRecentFolders,
    rememberRecentFolder,
    type RecentFolder,
  } from './lib/recent';
  import { traceStartup } from './lib/startup-trace';
  import { basename, dirname, isDocument, isMarkdown, normalize, resolveLink } from './lib/paths';
  import type { Heading, LatexEngine, Preferences, Source } from './lib/types';
  import type { PaletteCommand } from './lib/palette';
  import { createControlExecutor, type ControlState } from './lib/control';
  import { installControl, markControlReady, publishControlEvent } from './lib/control-host';
  import { buildControlState } from './lib/control-state';
  import { CONTROL_PUBLISH_INTERVAL_MS } from './lib/control-timings';
  import type { PreviewControls } from './lib/preview-control';
  import { createControlActions, type ControlViewState } from './lib/control-actions';
  const workspace = new Workspace();
  const startsDecorationless =
    (window as unknown as { __PAPYRI_DECORATIONLESS__?: boolean }).__PAPYRI_DECORATIONLESS__ ===
    true;
  let preferences = $state(loadPreferences());
  let sidebar = $state(window.innerWidth >= NARROW_VIEWPORT);
  let outline = $state(window.innerWidth >= 1100);
  let rightTab = $state<RightTab>('outline');
  let browser = $state<BrowserState>({ ...emptyBrowserState, url: '' });
  let recentOpen = $state(false);
  let copyState = $state<'idle' | 'copied' | 'error'>('idle');
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  let settings = $state(false);
  let help = $state(false);
  let searchOpen = $state(false);
  let paletteOpen = $state(false);
  let decorationless = $state(startsDecorationless);
  let query = $state('');
  let pathInput = $derived(workspace.directory);
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
  let primaryPreview = $state<PreviewControls>();
  let secondaryPreview = $state<PreviewControls>();
  let resolveWorkspaceReady = () => {};
  const workspaceReady = new Promise<void>((resolve) => {
    resolveWorkspaceReady = resolve;
  });
  const uiScale = $derived(preferences.uiZoom / 100);
  const pagedDocument = $derived(!!workspace.activeTab?.bytes);
  const layoutWidth = $derived(viewportWidth / uiScale);
  const MIN_DOCUMENT_WIDTH = 420;
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
    !settings && !help && !trustDialog && !paletteOpen && !decorationless,
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
      localStorage.setItem('papyri.preferences', JSON.stringify({ ...value, version: 2 }));
    } catch {
      workspace.error = 'Preferences could not be persisted; browser storage is unavailable.';
    }
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
      if (native) {
        const selected = await invokeHost<string | null>('pick_path', { directory: true });
        if (typeof selected === 'string') useFolder(selected, true);
      } else await workspace.selectSource(await browserDirectory());
    } catch (error) {
      workspace.error = String(error);
    }
  }
  async function chooseFile() {
    try {
      if (native) {
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
        if (native) {
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
  async function copyRawDocument() {
    const text = workspace.activeTab?.text;
    if (!text) return;
    const copied = await writeClipboard(text);
    copyState = copied ? 'copied' : 'error';
    if (!copied) workspace.error = 'Could not copy the active document to the clipboard.';
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copyState = 'idle'), 1800);
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
    if (native)
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
    if (!native)
      commands.push({
        id: 'import-folder',
        label: 'Import folder snapshot',
        keywords: 'upload directory',
        run: () => folderInput.click(),
      });
    if (native)
      for (const engine of ['lualatex', 'pdflatex', 'xelatex'] as LatexEngine[])
        commands.push({
          id: `latex-${engine}`,
          label: `Use ${engine} for LaTeX`,
          keywords: 'compiler engine tex',
          run: () => updatePreferences({ ...preferences, latexEngine: engine }),
        });
    if (workspace.directory !== '/' && workspace.directory !== workspace.source?.root)
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
      if (menu.target.directory)
        add('Open folder', () => {
          workspace.directory = path;
          workspace.treeRevision++;
          showExplorer();
        });
      else if (menu.target.document) add('Open', () => void openDocument(path));
      if (!menu.target.directory)
        add('Show in explorer', () => {
          workspace.directory = dirname(path);
          workspace.treeRevision++;
          showExplorer();
        });
      add('Copy path', () => void copyPath(path));
      separator();
      add('Refresh files', () => {
        workspace.treeRevision++;
      });
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
    if (paletteOpen) return;
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
      searchOpen = true;
      setTimeout(() => searchInput?.focus());
    }
    if (key === 'w') workspace.close(workspace.active);
    if (key === '\\') split();
    if (key === ',') settings = !settings;
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
        split: !!workspace.secondary,
        decorationless,
        query,
      },
      preferences: $state.snapshot(preferences) as Preferences,
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
  });
  const executeControl = createControlExecutor(controlActions);
  let controlPublishTimer: ReturnType<typeof setTimeout> | undefined;
  let lastPublishedState = '';
  let lastPublishedHeadings = '';
  function scheduleControlPublish() {
    if (!native || controlPublishTimer) return;
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
    if (!native) return;
    void controlState();
    scheduleControlPublish();
  });
  $effect(() => {
    if (!native) return;
    const value = {
      path: headingsPath === workspace.active ? workspace.active : null,
      headings: headingsPath === workspace.active ? headings : [],
    };
    const key = JSON.stringify(value);
    if (key === lastPublishedHeadings) return;
    lastPublishedHeadings = key;
    publishControlEvent('headings', value);
  });
  onMount(() => {
    let disposed = false;
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
      if (settings || help || trustDialog || paletteOpen) return;
      const tab = target?.closest('.tab-item[data-path]') as HTMLElement | null;
      if (tab?.dataset.path) {
        openContextMenu({ kind: 'tab', path: tab.dataset.path }, event.clientX, event.clientY);
        return;
      }
      const row = target?.closest('.file-row[data-path]') as HTMLElement | null;
      if (row?.dataset.path) {
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
      if (native) {
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
        if (native) {
          const { source, initial } = await desktopSource(() => preferences);
          traceStartup('source-ready');
          if (disposed) return;
          await workspace.changeSource(source);
          if (initial.directory) {
            workspace.directory = workspace.searchRoot = initial.path;
            updateRecentFolders(initial.path);
          } else {
            workspace.directory = dirname(initial.path);
            workspace.searchRoot = dirname(initial.path);
            await workspace.open(initial.path);
            if (workspace.active === initial.path) traceStartup('file-ready');
          }
        } else {
          await workspace.changeSource(demoSource());
          await workspace.open('/welcome.md');
        }
      } catch (error) {
        workspace.error = String(error);
      } finally {
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
    <header class="app-header">
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
              title={tab.path}
              onclick={() => workspace.open(tab.path)}
              ><FileText size={14} /><span>{basename(tab.path)}</span></button
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
        <button
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
        ><button
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
                useFolder(normalize(pathInput), false);
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
                workspace.directory === '/'}><ArrowUp size={14} /></button
            >
          </div>
          <div class="explorer-tools">
            <span>FILES</span>
            <div>
              <button class="icon-button small" aria-label="Open documents" onclick={chooseFile}
                ><FileText size={15} /></button
              ><button class="icon-button small" aria-label="Refresh files" onclick={refresh}
                ><RefreshCw size={14} /></button
              >
            </div>
          </div>
          <div class="explorer-scroll">
            {#if workspace.source}<Explorer
                source={workspace.source}
                path={workspace.directory}
                revision={workspace.treeRevision}
                active={workspace.active}
                onopen={openDocument}
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
                          <FolderOpen size={16} />
                          <span class="recent-dialog-copy">
                            <strong>{folder.path}</strong>
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
            <span>{workspace.error}</span><button
              class="icon-button small"
              aria-label="Dismiss error"
              onclick={() => (workspace.error = '')}><X size={14} /></button
            >
          </div>{/if}
        {#if workspace.activeTab?.error}<div class="error-banner" role="alert">
            {workspace.activeTab.error}
          </div>{/if}
        <div class="reading-layout">
          <div class="panes" class:split={!!workspace.secondary}>
            {#if workspace.activeTab && workspace.source}
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
                  onrendererror={(path, error) => void workspace.showSource(path, error)}
                  ondismiss={dismiss}
                  onheadings={(value) => {
                    headings = value;
                    headingsPath = workspace.active;
                  }}
                  onselection={openSelectionMenu}
                  onpagecontext={openPageContext}
                  onselectionstats={(info) =>
                    (selectionStats = info.words || info.characters ? info : null)}
                  onselectioncopy={(info) =>
                    void copyPreviewSelection(info.kind, info.text, info.source)}
                  onpdfpage={(path, page, total) => {
                    if (path === workspace.active) pdfPage = { path, page, total };
                  }}
                  onpdfscale={(value) => {
                    const pdfZoom = clampZoom(value, MIN_PDF_ZOOM, MAX_PDF_ZOOM);
                    if (pdfZoom !== preferences.pdfZoom)
                      updatePreferences({ ...preferences, pdfZoom });
                  }}
                />{/key}
              {#if workspace.secondaryTab}<div class="secondary-pane">
                  <div class="secondary-heading">
                    {basename(workspace.secondaryTab.path)}<button
                      class="icon-button small"
                      aria-label="Close split view"
                      onclick={() => (workspace.secondary = '')}><X size={14} /></button
                    >
                  </div>
                  {#if workspace.secondaryTab.error}<div class="error-banner" role="alert">
                      {workspace.secondaryTab.error}
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
          </div>
        </div>
      </main>
    </div>
    <footer class="status-bar">
      <div class="status-live">
        <span class="status-dot" class:live={workspace.source?.live}></span><span>{liveStatus}</span
        >
      </div>
      <div class="status-spacer"></div>
      <div class="status-stats" class:selection={!!selectionStats}>
        {#if selectionStats}<span>{selectionStats.words.toLocaleString()} words selected</span><span
            >{selectionStats.characters.toLocaleString()} characters selected</span
          >{:else if documentStats?.words !== null && documentStats?.words !== undefined}<span
            >{documentStats.words.toLocaleString()} words</span
          ><span>{documentStats.characters.toLocaleString()} characters</span><span
            >{documentStats.minutes} min read</span
          >{:else if documentStats?.bytes !== null && documentStats?.bytes !== undefined}<span
            >{(documentStats.bytes / 1024).toFixed(1)} KiB</span
          ><span
            >{documentStats.pages
              ? `PDF · page ${pdfPage.page} / ${documentStats.pages}`
              : 'PDF'}</span
          >{:else}<span>No document</span>{/if}
        <button
          class="status-help"
          aria-label="Keyboard shortcuts and help"
          title="Keyboard shortcuts"
          onclick={() => (help = true)}><CircleHelp size={13} /></button
        >
      </div>
      <span class="status-gap"></span>
      <button
        class="status-fit"
        class:enabled={preferences.fitWidth}
        aria-label="Fit document to width"
        aria-pressed={preferences.fitWidth}
        title="Fit document to width (Ctrl =)"
        onclick={() => viewCommand({ target: 'document', action: 'fit-width' })}
        ><Maximize2 size={14} /><span>Fit</span></button
      >
      <ZoomControls
        label="document"
        value={pagedDocument ? preferences.pdfZoom : preferences.documentZoom}
        minimum={pagedDocument ? MIN_PDF_ZOOM : MIN_ZOOM}
        maximum={pagedDocument ? MAX_PDF_ZOOM : MAX_ZOOM}
        onchange={(action) => zoom({ target: 'document', action })}
      />
    </footer>
  </div>
  {#if outline}<SidePanel
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
      {#each contextMenuItems as item ('separator' in item ? 'separator' : item.label)}
        {#if 'separator' in item}
          <div class="context-menu-separator"></div>
        {:else}
          <button type="button" role="menuitem" onclick={() => runContextMenuEntry(item)}>
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
    {preferences}
    onclose={() => (settings = false)}
    onchange={updatePreferences}
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

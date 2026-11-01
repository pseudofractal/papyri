<script lang="ts">
  import { onMount } from 'svelte';
  import { openDialog } from './lib/dialog';
  import {
    FolderOpen,
    Search,
    Settings as SettingsIcon,
    PanelLeft,
    PanelRight,
    Columns2,
    Sun,
    Moon,
    X,
    ChevronRight,
    ArrowUp,
    RefreshCw,
    Shield,
    FileText,
    Upload,
    CircleHelp,
    Maximize2,
  } from '@lucide/svelte';
  import ZoomControls from './components/ZoomControls.svelte';
  import SidebarResize from './components/SidebarResize.svelte';
  import {
    changeZoom,
    viewShortcut,
    MIN_SIDEBAR_WIDTH,
    MAX_SIDEBAR_WIDTH,
    MIN_PDF_ZOOM,
    MAX_PDF_ZOOM,
    MIN_ZOOM,
    MAX_ZOOM,
    clampZoom,
    type ZoomCommand,
    type ViewCommand,
  } from './lib/view';
  import Explorer from './components/Explorer.svelte';
  import Preview from './components/Preview.svelte';
  import Settings from './components/Settings.svelte';
  import CommandPalette from './components/CommandPalette.svelte';
  import { invokeHost } from './lib/native';
  import { Workspace } from './lib/workspace.svelte';
  import { native, desktopSource, importedSource, browserDirectory } from './lib/sources';
  import { demoSource } from './lib/demo';
  import { loadPreferences } from './lib/preferences';
  import { traceStartup } from './lib/startup-trace';
  import { basename, dirname, isDocument, isMarkdown, normalize, resolveLink } from './lib/paths';
  import type { Heading, LatexEngine, Preferences, Source } from './lib/types';
  import type { PaletteCommand } from './lib/palette';
  const workspace = new Workspace();
  let preferences = $state(loadPreferences());
  let sidebar = $state(window.innerWidth >= 760);
  let outline = $state(window.innerWidth >= 1100);
  let settings = $state(false);
  let help = $state(false);
  let searchOpen = $state(false);
  let paletteOpen = $state(false);
  let query = $state('');
  let pathInput = $derived(workspace.directory);
  let headings = $state<Heading[]>([]);
  let headingsPath = $state('');
  let recentCommands = $state<string[]>([]);
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
  const uiScale = $derived(preferences.uiZoom / 100);
  const pagedDocument = $derived(!!workspace.activeTab?.bytes);
  const maximumSidebarWidth = $derived(
    Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, viewportWidth / uiScale - 360)),
  );
  const sidebarWidth = $derived(Math.min(preferences.sidebarWidth, maximumSidebarWidth));
  $effect(() => {
    void workspace.source;
    void workspace.active;
    headings = [];
    headingsPath = '';
    pdfPage = { path: '', page: 0, total: 0 };
  });
  $effect(() => {
    document.documentElement.dataset.theme = preferences.theme;
    document.documentElement.style.zoom = String(uiScale);
    document.documentElement.style.setProperty('--ui-scale', String(uiScale));
  });
  function viewCommand(command: ViewCommand) {
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
  async function chooseFolder() {
    try {
      if (native) {
        const selected = await invokeHost<string | null>('pick_path', { directory: true });
        if (typeof selected === 'string') {
          workspace.directory = selected;
          workspace.searchRoot = selected;
          workspace.treeRevision++;
        }
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
    if (window.innerWidth < 760) sidebar = false;
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
        run: () => (sidebar = !sidebar),
      },
      {
        id: 'outline',
        label: 'Toggle table of contents',
        keywords: 'outline headings',
        run: () => (outline = !outline),
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
            sidebar = true;
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
  function runPaletteCommand(id: string) {
    const command = paletteCommands.find((item) => item.id === id);
    if (!command) return;
    recentCommands = [id, ...recentCommands.filter((item) => item !== id)].slice(0, 20);
    command.run();
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
      settings = false;
      help = false;
      trustDialog = false;
      searchOpen = false;
      query = '';
      return;
    }
    if (!modifier) return;
    const key = event.key.toLowerCase();
    if (!['o', 'b', 'f', 'w', '\\', ','].includes(key)) return;
    event.preventDefault();
    if (key === 'o') void (event.shiftKey ? chooseFolder() : chooseFile());
    if (key === 'b') sidebar = !sidebar;
    if (key === 'f') {
      searchOpen = true;
      setTimeout(() => searchInput?.focus());
    }
    if (key === 'w') workspace.close(workspace.active);
    if (key === '\\') split();
    if (key === ',') settings = !settings;
  }
  onMount(() => {
    let disposed = false;
    (async () => {
      try {
        if (native) {
          const { source, initial } = await desktopSource(() => preferences);
          traceStartup('source-ready');
          if (disposed) return;
          await workspace.changeSource(source);
          if (initial.directory) workspace.directory = workspace.searchRoot = initial.path;
          else {
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
      }
    })();
    const timer = setInterval(() => {
      if (!document.hidden && workspace.source?.live) void refresh();
    }, 2000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  });
</script>

<svelte:window onkeydown={keyboard} bind:innerWidth={viewportWidth} />
<div class="app-shell" data-theme={preferences.theme}>
  <header class="app-header">
    <div class="brand">
      <span class="brand-mark" aria-hidden="true"><span class="app-logo"></span></span><strong
        >Papyri</strong
      >
    </div>
    <div class="header-actions">
      <button
        class="icon-button"
        aria-label="Open command palette"
        title="Command palette (Ctrl K)"
        onclick={() => (paletteOpen = true)}><Search size={18} /></button
      >
      <button
        class="btn btn-ghost btn-sm open-folder"
        aria-label="Open folder"
        onclick={chooseFolder}><FolderOpen size={16} /><span>Open folder</span></button
      >
      <button
        class="icon-button"
        aria-label="Toggle color theme"
        onclick={() =>
          updatePreferences({
            ...preferences,
            theme: preferences.theme === 'mocha' ? 'latte' : 'mocha',
          })}
        >{#if preferences.theme === 'mocha'}<Sun size={18} />{:else}<Moon size={18} />{/if}</button
      >
      <button class="icon-button" aria-label="Settings" onclick={() => (settings = true)}
        ><SettingsIcon size={18} /></button
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
        <div class="section-label">
          <span>EXPLORER</span>
          <div>
            <button class="icon-button small" aria-label="Open documents" onclick={chooseFile}
              ><FileText size={15} /></button
            ><button class="icon-button small" aria-label="Refresh files" onclick={refresh}
              ><RefreshCw size={14} /></button
            >
          </div>
        </div>
        <div class="folder-label">
          <FolderOpen size={15} /><span>{workspace.source?.label || 'Files'}</span>
        </div>
        <form
          class="path-form"
          onsubmit={(event) => {
            event.preventDefault();
            workspace.directory = normalize(pathInput);
            workspace.treeRevision++;
          }}
        >
          <input aria-label="Directory path" bind:value={pathInput} spellcheck="false" /><button
            class="icon-button small"
            aria-label="Go to directory"><ChevronRight size={14} /></button
          >
        </form>
        <button
          class="parent-folder"
          onclick={() => {
            workspace.directory = dirname(workspace.directory);
            workspace.treeRevision++;
          }}
          disabled={workspace.directory === workspace.source?.root || workspace.directory === '/'}
          ><ArrowUp size={14} /> Parent folder</button
        >
        <div class="explorer-scroll">
          {#if workspace.source}<Explorer
              source={workspace.source}
              path={workspace.directory}
              revision={workspace.treeRevision}
              active={workspace.active}
              onopen={openDocument}
            />{/if}
        </div>
        <div class="sidebar-footer">
          <span class="status-dot" class:live={workspace.source?.live}></span><span
            >{workspace.source?.live
              ? 'Live · checks every 2 seconds'
              : 'Snapshot · import again to update'}</span
          >
        </div>
        {#if !native}<div class="import-actions">
            <button class="btn btn-ghost btn-xs" onclick={() => folderInput.click()}
              ><Upload size={13} />Import folder</button
            ><button class="btn btn-ghost btn-xs" onclick={chooseFile}>Open files</button>
          </div>{/if}
      </aside>
      <SidebarResize
        width={sidebarWidth}
        maximum={maximumSidebarWidth}
        scale={uiScale}
        onresize={(width) => (preferences = { ...preferences, sidebarWidth: width })}
        oncommit={() => updatePreferences(preferences)}
      />
    {/if}
    <main class="main-workspace">
      <div class="tab-bar">
        <button
          class="icon-button sidebar-toggle"
          aria-label="Toggle explorer"
          onclick={() => (sidebar = !sidebar)}><PanelLeft size={17} /></button
        >
        <div class="tabs-scroll" role="group" aria-label="Open documents">
          {#each workspace.tabs as tab (tab.path)}<div
              class="tab-item"
              class:selected={workspace.active === tab.path}
            >
              <button
                aria-pressed={workspace.active === tab.path}
                class="tab-select"
                onclick={() => workspace.open(tab.path)}
                ><FileText size={14} /><span>{basename(tab.path)}</span></button
              ><button
                class="tab-close"
                aria-label="Close {basename(tab.path)}"
                onclick={() => workspace.close(tab.path)}><X size={12} /></button
              >
            </div>{/each}
        </div>
        <div class="view-actions">
          <button
            class="icon-button"
            class:enabled={searchOpen}
            aria-label="Search document"
            onclick={() => {
              searchOpen = !searchOpen;
              if (!searchOpen) query = '';
            }}><Search size={17} /></button
          ><button
            class="icon-button"
            class:enabled={!!workspace.secondary}
            aria-label="Toggle split view"
            onclick={split}><Columns2 size={17} /></button
          ><button
            class="icon-button"
            class:enabled={outline}
            aria-label="Toggle table of contents"
            onclick={() => (outline = !outline)}><PanelRight size={17} /></button
          >
        </div>
      </div>
      <div class="document-toolbar">
        <div class="document-path">
          <span title={dirname(workspace.active || workspace.directory)}
            >{dirname(workspace.active || workspace.directory)}</span
          ><ChevronRight size={12} /><strong title={workspace.active || undefined}
            >{basename(workspace.active) === '/'
              ? 'No document selected'
              : basename(workspace.active)}</strong
          >
        </div>
        <ZoomControls
          label="document"
          value={pagedDocument ? preferences.pdfZoom : preferences.documentZoom}
          minimum={pagedDocument ? MIN_PDF_ZOOM : MIN_ZOOM}
          maximum={pagedDocument ? MAX_PDF_ZOOM : MAX_ZOOM}
          onchange={(action) => zoom({ target: 'document', action })}
        />
        <button
          class="icon-button"
          class:enabled={preferences.fitWidth}
          aria-label="Fit document to width"
          aria-pressed={preferences.fitWidth}
          title="Fit document to width (Ctrl =)"
          onclick={() => viewCommand({ target: 'document', action: 'fit-width' })}
          ><Maximize2 size={16} /></button
        >
        {#if !workspace.active || isMarkdown(workspace.active)}<button
            class="trust-button"
            class:trusted
            aria-label={trusted
              ? 'Scripts enabled: disable document scripts'
              : 'Safe preview: trust current document for scripts'}
            disabled={!workspace.active}
            onclick={() => (trusted ? (trustedPath = '') : (trustDialog = true))}
            ><Shield size={13} /><span>{trusted ? 'Scripts enabled' : 'Safe preview'}</span></button
          >{:else}<span
            class="trust-button paged-status"
            title={pagedDocument
              ? 'PDF preview · scripts disabled'
              : 'Source preview · scripts disabled'}
            ><Shield size={13} /><span
              >{pagedDocument
                ? 'PDF preview · scripts disabled'
                : 'Source preview · scripts disabled'}</span
            ></span
          >{/if}
      </div>
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
                onheadings={(value) => {
                  headings = value;
                  headingsPath = workspace.active;
                }}
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
                  onheadings={() => {}}
                />
              </div>{/if}
          {:else}<div class="empty-state">
              <span class="empty-icon" aria-hidden="true"><span class="app-logo"></span></span>
              <h1>No document open</h1>
              <p>Open a Markdown, PDF, Typst, or LaTeX document, or choose a folder.</p>
              <button class="btn btn-primary" onclick={chooseFile}
                ><FileText size={17} />Open a document</button
              ><button class="btn btn-ghost btn-sm" onclick={chooseFolder}>Browse a folder</button>
            </div>{/if}
        </div>
        {#if outline && workspace.activeTab}<aside class="outline" aria-label="Table of contents">
            <div class="section-label">ON THIS PAGE</div>
            <nav>
              {#each headings.slice(0, 1000) as heading (heading.id)}<button
                  class="outline-link"
                  style:padding-left="{Math.max(0, heading.level - 1) * 10 + 14}px"
                  onclick={() => workspace.navigateAnchor(heading.id)}>{heading.text}</button
                >{/each}
            </nav>
            {#if headings.length > 1000}<p class="tree-note">
                Showing the first 1,000 headings. Search can find the rest.
              </p>{/if}
            <div class="reading-tip">
              <p><kbd>Ctrl B</kbd> toggles the explorer.</p>
            </div>
          </aside>{/if}
      </div>
    </main>
  </div>
  <footer class="status-bar">
    <div>
      <span class="status-dot live"></span><span>{workspace.busy ? 'Opening…' : 'Read-only'}</span
      ><span class="footer-separator">/</span><span
        >{native ? 'Linux' : 'Web · selected files only'}</span
      >
    </div>
    <div>
      <span class="offline-label"
        >{preferences.network ? 'External content allowed' : 'Network resources blocked'}</span
      ><button aria-label="Keyboard shortcuts and help" onclick={() => (help = true)}
        ><CircleHelp size={14} /><span>Shortcuts</span></button
      >
    </div>
  </footer>
</div>
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
    pdfPages={pdfPage.path === workspace.active && pagedDocument ? pdfPage.total : 0}
    onclose={() => (paletteOpen = false)}
    onopen={(path) => void openDocument(path)}
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
        <dt>Resize explorer</dt>
        <dd>Drag divider; arrows when focused</dd>
        <dt>Preferences</dt>
        <dd>Ctrl ,</dd>
        <dt>Dismiss panels</dt>
        <dd>Esc</dd>
      </dl>
      <p>
        Zoom shortcuts work while the document has focus too. All essential actions have toolbar
        buttons; UI zoom controls are also in Settings.
      </p>
      <div class="modal-action">
        <button class="btn btn-primary" onclick={() => (help = false)}>Close</button>
      </div>
    </div>
  </dialog>{/if}

<script lang="ts">
  import { onMount } from 'svelte';
  import {
    Search,
    FileText,
    Terminal,
    X,
    FolderOpen,
    FolderUp,
    FolderSearch,
    Upload,
    PanelLeft,
    PanelRight,
    Columns2,
    Sun,
    Moon,
    SunMoon,
    Globe,
    Settings,
    RefreshCw,
    CircleHelp,
    ZoomIn,
    ZoomOut,
    RotateCcw,
    Maximize2,
    List,
    FileSearch,
    SquareArrowRight,
    SquareArrowLeft,
    SquareX,
    CopyX,
    BookOpen,
    Hash,
    ChevronsLeft,
    ChevronLeft,
    ChevronRight,
    ChevronsRight,
    FileCode,
  } from '@lucide/svelte';
  import { openDialog } from '../lib/dialog';
  import {
    scanDocuments,
    searchContents,
    fuzzyScore,
    fileScore,
    type PaletteCommand,
    type ContentMatch,
  } from '../lib/palette';
  import { basename, dirname } from '../lib/paths';
  import type { RecentFolder } from '../lib/recent';
  import type { Heading, Source } from '../lib/types';

  type Result = {
    id: string;
    label: string;
    detail: string;
    kind: 'file' | 'folder' | 'command' | 'heading' | 'tab' | 'content' | 'page';
    score: number;
    group?: string;
    lastFile?: string;
  };
  const commandIcons: Record<string, typeof FileText> = {
    'open-file': FileText,
    'open-folder': FolderOpen,
    'import-folder': Upload,
    parent: FolderUp,
    'show-folder': FolderSearch,
    refresh: RefreshCw,
    explorer: PanelLeft,
    outline: PanelRight,
    split: Columns2,
    'close-split': Columns2,
    theme: SunMoon,
    light: Sun,
    dark: Moon,
    network: Globe,
    settings: Settings,
    help: CircleHelp,
    'ui-in': ZoomIn,
    'ui-out': ZoomOut,
    'ui-reset': RotateCcw,
    'document-in': ZoomIn,
    'document-out': ZoomOut,
    'document-reset': RotateCcw,
    search: Search,
    'close-search': Search,
    fit: Maximize2,
    decorationless: Maximize2,
    'next-tab': SquareArrowRight,
    'previous-tab': SquareArrowLeft,
    'close-tab': SquareX,
    'close-others': CopyX,
    'close-all': CopyX,
    'pdf-first': ChevronsLeft,
    'pdf-previous': ChevronLeft,
    'pdf-next': ChevronRight,
    'pdf-last': ChevronsRight,
    'pdf-go-page': Hash,
  };
  function resultIcon(result: Result) {
    if (result.kind === 'command')
      return commandIcons[result.id] || (result.id.startsWith('latex-') ? FileCode : Terminal);
    if (result.kind === 'folder') return FolderOpen;
    if (result.kind === 'heading') return List;
    if (result.kind === 'tab') return BookOpen;
    if (result.kind === 'content') return FileSearch;
    if (result.kind === 'page') return Hash;
    return FileText;
  }
  let {
    source,
    directory,
    workspaceRoot,
    commands,
    headings,
    tabs,
    recentFiles,
    recentCommands,
    recentFolders,
    pdfPages,
    onclose,
    onopen,
    onopenfolder,
    oncommand,
    onheading,
    oncontent,
    onpage,
  }: {
    source: Source;
    directory: string;
    workspaceRoot: string;
    commands: PaletteCommand[];
    headings: Heading[];
    tabs: string[];
    recentFiles: string[];
    recentCommands: string[];
    recentFolders: RecentFolder[];
    pdfPages: number;
    onclose: () => void;
    onopen: (path: string) => void;
    onopenfolder: (path: string, lastFile?: string) => void;
    oncommand: (id: string) => void;
    onheading: (id: string) => void;
    oncontent: (path: string, query: string) => void;
    onpage: (page: number) => void;
  } = $props();
  let input: HTMLInputElement;
  let query = $state('');
  let paths = $state<string[]>([]);
  let loading = $state(true);
  let inaccessible = $state(0);
  let truncated = $state(false);
  let selected = $state(0);
  let scope = $state('current');
  let contentMatches = $state<ContentMatch[]>([]);
  let contentLoading = $state(false);
  let contentInaccessible = $state(0);
  let contentTruncated = $state(false);
  const scopePath = $derived(
    scope === 'workspace' ? workspaceRoot : scope === 'parent' ? dirname(directory) : directory,
  );
  const prefix = $derived(query.trimStart().slice(0, 1));
  const results = $derived.by(() => {
    const special = ['>', '@', '%', '?', '#', '~'].includes(prefix);
    const search = special ? query.trimStart().slice(1).trim() : query.trim();
    const matches: Result[] = [];
    if (!special || prefix === '>')
      for (const command of commands) {
        const score =
          fuzzyScore(search, command.label) ?? fuzzyScore(search, command.keywords || '');
        if (score !== null)
          matches.push({
            id: command.id,
            label: command.label,
            detail: [command.group, command.shortcut].filter(Boolean).join(' · '),
            kind: 'command',
            group: !search && recentCommands.includes(command.id) ? 'Recent' : command.group,
            score:
              score +
              (!search && recentCommands.includes(command.id)
                ? 1000 - recentCommands.indexOf(command.id)
                : 0),
          });
      }
    if (!special || prefix === '~')
      for (const [index, folder] of recentFolders.entries()) {
        const score = search ? fileScore(search, folder.path) : 1040 - index;
        if (score === null) continue;
        matches.push({
          id: folder.path,
          label: basename(folder.path),
          detail: folder.lastFile ? `${folder.path} · ${basename(folder.lastFile)}` : folder.path,
          kind: 'folder',
          group: 'Recent folders',
          lastFile: folder.lastFile,
          score,
        });
      }
    if (!special) {
      for (const path of paths) {
        const relative = path.startsWith(scopePath === '/' ? '/' : `${scopePath}/`)
          ? path.slice(scopePath === '/' ? 1 : scopePath.length + 1)
          : path;
        const score = fileScore(search, relative);
        if (score !== null)
          matches.push({
            id: path,
            label: basename(path),
            detail: relative,
            kind: 'file',
            score:
              score +
              (!search && recentFiles.includes(path) ? 1000 - recentFiles.indexOf(path) : 0),
          });
      }
      if (!search)
        for (const [index, path] of recentFiles.entries()) {
          if (!paths.includes(path))
            matches.push({
              id: path,
              label: basename(path),
              detail: path,
              kind: 'file',
              score: 1020 - index,
            });
        }
    }
    if (prefix === '@')
      for (const heading of headings) {
        const score = fuzzyScore(search, heading.text);
        if (score !== null)
          matches.push({
            id: heading.id,
            label: heading.text,
            detail: `Heading · level ${heading.level}`,
            kind: 'heading',
            score,
          });
      }
    if (prefix === '%')
      for (const path of tabs) {
        const score = fileScore(search, path);
        if (score !== null)
          matches.push({ id: path, label: basename(path), detail: path, kind: 'tab', score });
      }
    if (prefix === '?')
      for (const match of contentMatches)
        matches.push({
          id: match.path,
          label: `${basename(match.path)}:${match.line}`,
          detail: match.snippet,
          kind: 'content',
          score: 0,
        });
    if (prefix === '#' && /^\d+$/.test(search)) {
      const page = Number(search);
      if (Number.isSafeInteger(page) && page >= 1 && page <= pdfPages)
        matches.push({
          id: String(page),
          label: `Go to page ${page}`,
          detail: `PDF · ${pdfPages} pages`,
          kind: 'page',
          score: 0,
        });
    }
    return matches
      .sort(
        (a, b) =>
          b.score - a.score ||
          (prefix === '>' && !search ? (a.group || '').localeCompare(b.group || '') : 0) ||
          a.label.localeCompare(b.label) ||
          a.id.localeCompare(b.id),
      )
      .slice(0, 100);
  });
  const active = $derived(Math.min(selected, Math.max(0, results.length - 1)));
  function showGroup(result: Result, index: number) {
    if (!result.group || (index > 0 && results[index - 1].group === result.group)) return false;
    return (
      (prefix === '>' && !query.trimStart().slice(1).trim()) ||
      prefix === '~' ||
      (!query.trim() && result.kind === 'folder')
    );
  }
  onMount(() => input.focus());
  $effect(() => {
    const currentSource = source;
    const root = scopePath;
    const controller = new AbortController();
    paths = [];
    inaccessible = 0;
    truncated = false;
    loading = true;
    void scanDocuments(currentSource, root, controller.signal, (result) => {
      paths = result.paths;
      inaccessible = result.inaccessible;
      truncated = result.truncated;
    }).finally(() => {
      if (!controller.signal.aborted) loading = false;
    });
    return () => controller.abort();
  });
  $effect(() => {
    const search = prefix === '?' ? query.trimStart().slice(1).trim() : '';
    const availablePaths = paths;
    const currentSource = source;
    const controller = new AbortController();
    contentMatches = [];
    contentInaccessible = 0;
    contentTruncated = false;
    contentLoading = !!search;
    if (!search) return () => controller.abort();
    const timer = setTimeout(() => {
      void searchContents(currentSource, availablePaths, search, controller.signal, (result) => {
        contentMatches = result.matches;
        contentInaccessible = result.inaccessible;
        contentTruncated = result.truncated;
      }).finally(() => {
        if (!controller.signal.aborted) contentLoading = false;
      });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  });
  function choose(result: Result) {
    if (result.kind === 'command' && result.id === 'pdf-go-page') {
      oncommand(result.id);
      query = '#';
      selected = 0;
      input.focus();
      return;
    }
    onclose();
    if (result.kind === 'file' || result.kind === 'tab') onopen(result.id);
    else if (result.kind === 'folder') onopenfolder(result.id, result.lastFile);
    else if (result.kind === 'heading') onheading(result.id);
    else if (result.kind === 'content') oncontent(result.id, query.trimStart().slice(1).trim());
    else if (result.kind === 'page') onpage(Number(result.id));
    else oncommand(result.id);
  }
  function keydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!results.length) return;
      selected = (active + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
      document.getElementById(`palette-option-${selected}`)?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter' && !event.isComposing && results[active]) {
      event.preventDefault();
      choose(results[active]);
    }
  }
</script>

<dialog use:openDialog class="modal modal-open" aria-labelledby="palette-title" oncancel={onclose}>
  <div class="modal-box palette-panel">
    <header class="palette-header">
      <h2 id="palette-title">Command palette</h2>
      <button class="icon-button" aria-label="Close command palette" onclick={onclose}
        ><X size={18} /></button
      >
    </header>
    <div class="palette-input">
      <Search size={18} />
      <input
        bind:this={input}
        bind:value={query}
        oninput={() => (selected = 0)}
        onkeydown={keydown}
        role="combobox"
        aria-label="Search files and commands"
        aria-autocomplete="list"
        aria-expanded="true"
        aria-controls="palette-results"
        aria-activedescendant={results.length ? `palette-option-${active}` : undefined}
        placeholder="Search files, folders, and commands…"
        autocomplete="off"
        spellcheck="false"
      />
    </div>
    <div class="palette-hint">
      <label
        >Search scope
        <select aria-label="Search scope" bind:value={scope}>
          <option value="current">Current folder</option>
          {#if directory !== '/' && directory !== workspaceRoot}<option value="parent"
              >Parent folder</option
            >{/if}
          <option value="workspace">Workspace folder</option>
        </select>
      </label>
      <span
        >{scopePath} · &gt; commands · @ headings · % tabs · ~ recent folders · ? text{pdfPages
          ? ' · # page'
          : ''}</span
      >
    </div>
    <div id="palette-results" class="palette-results" role="listbox" aria-label="Search results">
      {#each results as result, index (`${result.kind}:${result.id}`)}
        {@const Icon = resultIcon(result)}
        {#if showGroup(result, index)}
          <div class="palette-group" role="presentation">{result.group}</div>
        {/if}
        <button
          id="palette-option-{index}"
          role="option"
          tabindex="-1"
          aria-selected={index === active}
          class="palette-result"
          class:active={index === active}
          onclick={() => choose(result)}
        >
          <Icon size={17} aria-hidden="true" />
          <span class="palette-result-text"
            ><span>{result.label}</span>{#if result.detail && result.detail !== result.label}<small
                >{result.detail}</small
              >{/if}</span
          >
        </button>
      {/each}
      {#if !results.length && !loading && !contentLoading}<p class="palette-empty">
          {prefix === '?' && !query.trimStart().slice(1).trim()
            ? 'Type text to search document sources.'
            : prefix === '#'
              ? 'Enter a valid PDF page number.'
              : 'No matches.'}
        </p>{/if}
    </div>
    <div class="palette-footer" role="status">
      {#if loading || contentLoading}Searching {contentLoading
          ? 'document text'
          : 'folders'}…{:else if truncated || inaccessible || contentTruncated || contentInaccessible}
        {#if truncated || contentTruncated}Search limit reached; results may be incomplete.
        {/if}
        {#if inaccessible}{inaccessible} folder(s) could not be searched.{/if}
        {#if contentInaccessible}{contentInaccessible} file(s) could not be searched.{/if}
      {:else}↑ ↓ navigate · Enter open · Esc close{/if}
    </div>
  </div>
</dialog>

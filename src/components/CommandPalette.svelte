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
    Clock,
    ArrowLeftRight,
    SpellCheck,
  } from '@lucide/svelte';
  import { openDialog } from '../lib/dialog';
  import FileIcon from './FileIcon.svelte';
  import {
    scanDocuments,
    searchContents,
    fuzzyScore,
    fileScore,
    type PaletteCommand,
    type ContentMatch,
  } from '../lib/palette';
  import {
    basename,
    dirname,
    displayPath,
    isLatex,
    isMarkdown,
    isPdf,
    isTypst,
  } from '../lib/paths';
  import {
    buildSpellingDictionary,
    suggestSpelling,
    suggestWithSpellchecker,
    type SpellCheckerLike,
  } from '../lib/spelling';
  import { loadEnglishSpellchecker } from '../lib/dictionary';
  import type { RecentFolder } from '../lib/recent';
  import type { Heading, Source } from '../lib/types';

  type Result = {
    id: string;
    label: string;
    detail: string;
    right?: string;
    kind: 'file' | 'folder' | 'command' | 'heading' | 'tab' | 'content' | 'page' | 'correction';
    score: number;
    lastFile?: string;
    correction?: string;
  };
  type PaletteFilter =
    'all' | 'files' | 'commands' | 'headings' | 'tabs' | 'text' | 'recent' | 'pages';
  type SearchScope = 'current' | 'parent' | 'workspace';
  type IconComponent = typeof FileText;
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
  const filters: {
    id: PaletteFilter;
    label: string;
    icon: IconComponent;
    prefix?: string;
  }[] = [
    { id: 'all', label: 'All', icon: Search },
    { id: 'files', label: 'Files', icon: FileText },
    { id: 'commands', label: 'Commands', icon: Terminal, prefix: '>' },
    { id: 'headings', label: 'Headings', icon: List, prefix: '@' },
    { id: 'tabs', label: 'Tabs', icon: BookOpen, prefix: '%' },
    { id: 'text', label: 'Text', icon: FileSearch, prefix: '?' },
    { id: 'recent', label: 'Recent', icon: Clock, prefix: '~' },
    { id: 'pages', label: 'Pages', icon: Hash, prefix: '#' },
  ];
  const prefixFilters: Record<string, PaletteFilter> = {
    '>': 'commands',
    '@': 'headings',
    '%': 'tabs',
    '?': 'text',
    '~': 'recent',
    '#': 'pages',
  };
  function resultIcon(result: Result) {
    if (result.kind === 'command')
      return commandIcons[result.id] || (result.id.startsWith('latex-') ? FileCode : Terminal);
    if (result.kind === 'folder') return FolderOpen;
    if (result.kind === 'heading') return List;
    if (result.kind === 'tab') return BookOpen;
    if (result.kind === 'content') return FileSearch;
    if (result.kind === 'page') return Hash;
    if (result.kind === 'correction') return SpellCheck;
    return FileText;
  }
  function fileKind(path: string) {
    if (isMarkdown(path)) return 'Markdown';
    if (isPdf(path)) return 'PDF';
    if (isTypst(path)) return 'Typst';
    if (isLatex(path)) return 'LaTeX';
    const extension = path.split('.').pop();
    return extension && extension !== path ? extension.toUpperCase() : 'File';
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
  let scope = $state<SearchScope>('current');
  let filter = $state<PaletteFilter>('all');
  let contentMatches = $state<ContentMatch[]>([]);
  let contentLoading = $state(false);
  let contentInaccessible = $state(0);
  let contentTruncated = $state(false);
  let englishSpell = $state<SpellCheckerLike | null>(null);
  let englishSpellLoading = false;
  const scopeOptions = $derived.by(() => {
    const options: { value: SearchScope; label: string }[] = [
      { value: 'current', label: 'Folder' },
    ];
    if (directory !== '/' && directory !== workspaceRoot)
      options.push({ value: 'parent', label: 'Parent' });
    options.push({ value: 'workspace', label: 'Workspace' });
    return options;
  });
  const scopeLabel = $derived(
    scopeOptions.find((option) => option.value === scope)?.label ?? 'Folder',
  );
  const scopePath = $derived(
    scope === 'workspace' ? workspaceRoot : scope === 'parent' ? dirname(directory) : directory,
  );
  const prefix = $derived(query.trimStart().slice(0, 1));
  const prefixFilter = $derived(prefixFilters[prefix]);
  const effectiveFilter = $derived(prefixFilter ?? filter);
  const search = $derived(prefixFilter ? query.trimStart().slice(1).trim() : query.trim());
  const textSearch = $derived(effectiveFilter === 'text' ? search : '');
  const spellingDictionary = $derived.by(() =>
    buildSpellingDictionary([
      commands.map((command) => `${command.label} ${command.keywords ?? ''}`),
      headings.map((heading) => heading.text),
      tabs,
      recentFolders.map((folder) => folder.path),
      paths.slice(0, 2000),
      recentFiles,
      [directory, workspaceRoot],
    ]),
  );
  const localSpelling = $derived(
    effectiveFilter === 'pages' ? null : suggestSpelling(query, spellingDictionary),
  );
  const dictionarySpelling = $derived(
    effectiveFilter === 'pages' || localSpelling || !englishSpell
      ? null
      : suggestWithSpellchecker(query, englishSpell),
  );
  const spelling = $derived(localSpelling ?? dictionarySpelling);
  const placeholder = $derived(
    effectiveFilter === 'commands'
      ? 'Search commands…'
      : effectiveFilter === 'files'
        ? 'Search files and folders…'
        : effectiveFilter === 'headings'
          ? 'Search headings…'
          : effectiveFilter === 'tabs'
            ? 'Search open tabs…'
            : effectiveFilter === 'text'
              ? 'Search document text…'
              : effectiveFilter === 'recent'
                ? 'Search recent folders…'
                : effectiveFilter === 'pages'
                  ? 'Page number…'
                  : 'Search files, folders, and commands…',
  );
  const results = $derived.by(() => {
    const matches: Result[] = [];
    if (spelling)
      matches.push({
        id: `spelling:${spelling.corrected}`,
        label: `Did you mean “${spelling.display}”?`,
        detail: 'Replace the search with the corrected spelling.',
        right: 'Spelling',
        kind: 'correction',
        score: 1_000_000_000,
        correction: spelling.corrected,
      });
    const includeCommands = effectiveFilter === 'all' || effectiveFilter === 'commands';
    const includeFiles = effectiveFilter === 'all' || effectiveFilter === 'files';
    const includeRecentFolders = effectiveFilter === 'all' || effectiveFilter === 'recent';
    if (includeCommands)
      for (const command of commands) {
        const score =
          fuzzyScore(search, command.label) ?? fuzzyScore(search, command.keywords || '');
        if (score !== null)
          matches.push({
            id: command.id,
            label: command.label,
            detail: command.shortcut && command.group ? command.group : '',
            right: command.shortcut || command.group || 'Command',
            kind: 'command',
            score:
              score +
              (!search && recentCommands.includes(command.id)
                ? 1000 - recentCommands.indexOf(command.id)
                : 0),
          });
      }
    if (includeRecentFolders)
      for (const [index, folder] of recentFolders.entries()) {
        const score = search ? fileScore(search, folder.path) : 1040 - index;
        if (score === null) continue;
        matches.push({
          id: folder.path,
          label: basename(folder.path),
          detail: folder.lastFile
            ? `${displayPath(folder.path)} · ${basename(folder.lastFile)}`
            : displayPath(folder.path),
          right: 'Recent',
          kind: 'folder',
          lastFile: folder.lastFile,
          score,
        });
      }
    if (includeFiles) {
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
            right: fileKind(path),
            kind: 'file',
            score:
              score +
              (!search && recentFiles.includes(path) ? 1000 - recentFiles.indexOf(path) : 0),
          });
      }
      if (!search && effectiveFilter === 'all')
        for (const [index, path] of recentFiles.entries()) {
          if (!paths.includes(path))
            matches.push({
              id: path,
              label: basename(path),
              detail: displayPath(path),
              right: fileKind(path),
              kind: 'file',
              score: 1020 - index,
            });
        }
    }
    if (effectiveFilter === 'headings')
      for (const heading of headings) {
        const score = fuzzyScore(search, heading.text);
        if (score !== null)
          matches.push({
            id: heading.id,
            label: heading.text,
            detail: 'Heading',
            right: `H${heading.level}`,
            kind: 'heading',
            score,
          });
      }
    if (effectiveFilter === 'tabs')
      for (const path of tabs) {
        const score = fileScore(search, path);
        if (score !== null)
          matches.push({
            id: path,
            label: basename(path),
            detail: displayPath(path),
            right: 'Tab',
            kind: 'tab',
            score,
          });
      }
    if (effectiveFilter === 'text')
      for (const match of contentMatches)
        matches.push({
          id: match.path,
          label: `${basename(match.path)}:${match.line}`,
          detail: match.snippet,
          right: 'Text',
          kind: 'content',
          score: 0,
        });
    if (effectiveFilter === 'pages' && /^\d+$/.test(search)) {
      const page = Number(search);
      if (Number.isSafeInteger(page) && page >= 1 && page <= pdfPages)
        matches.push({
          id: String(page),
          label: `Go to page ${page}`,
          detail: `PDF · ${pdfPages} pages`,
          right: 'Page',
          kind: 'page',
          score: 0,
        });
    }
    return matches
      .sort(
        (a, b) => b.score - a.score || a.label.localeCompare(b.label) || a.id.localeCompare(b.id),
      )
      .slice(0, 100);
  });
  const active = $derived(Math.min(selected, Math.max(0, results.length - 1)));
  const emptyMessage = $derived(
    effectiveFilter === 'text' && !search
      ? 'Type text to search document sources.'
      : effectiveFilter === 'pages' && !pdfPages
        ? 'Open a PDF to jump to pages.'
        : effectiveFilter === 'pages'
          ? 'Enter a valid PDF page number.'
          : effectiveFilter === 'headings' && !headings.length
            ? 'No headings in this document.'
            : effectiveFilter === 'tabs' && !tabs.length
              ? 'No other tabs are open.'
              : effectiveFilter === 'recent' && !recentFolders.length
                ? 'No recent folders yet.'
                : 'No matches.',
  );
  const footerStatus = $derived.by(() => {
    if (contentLoading) return 'Searching document text…';
    if (loading && (effectiveFilter === 'all' || effectiveFilter === 'files'))
      return 'Searching folders…';
    const messages: string[] = [];
    if (truncated || contentTruncated)
      messages.push('Search limit reached; results may be incomplete.');
    if (inaccessible) messages.push(`${inaccessible} folder(s) could not be searched.`);
    if (contentInaccessible) messages.push(`${contentInaccessible} file(s) could not be searched.`);
    if (messages.length) return messages.join(' ');
    return `${scopePath} · ${results.length} ${results.length === 1 ? 'result' : 'results'}`;
  });
  function selectFilter(next: PaletteFilter) {
    filter = next;
    if (prefixFilter) query = query.trimStart().slice(1).trimStart();
    selected = 0;
  }
  function selectScope(next: SearchScope) {
    scope = next;
    selected = 0;
  }
  function cycleScope() {
    const index = scopeOptions.findIndex((option) => option.value === scope);
    const next = scopeOptions[(index + 1) % scopeOptions.length];
    if (next) selectScope(next.value);
  }
  function filterKeydown(event: KeyboardEvent, index: number) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % filters.length
        : event.key === 'ArrowLeft'
          ? (index - 1 + filters.length) % filters.length
          : event.key === 'End'
            ? filters.length - 1
            : 0;
    const item = filters[next];
    if (!item) return;
    selectFilter(item.id);
    requestAnimationFrame(() => document.getElementById(`palette-filter-${item.id}`)?.focus());
  }
  function scopeKeydown(event: KeyboardEvent, index: number) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % scopeOptions.length
        : event.key === 'ArrowLeft'
          ? (index - 1 + scopeOptions.length) % scopeOptions.length
          : event.key === 'End'
            ? scopeOptions.length - 1
            : 0;
    const option = scopeOptions[next];
    if (!option) return;
    selectScope(option.value);
    requestAnimationFrame(() => document.getElementById(`palette-scope-${option.value}`)?.focus());
  }
  onMount(() => input.focus());
  $effect(() => {
    if (!scopeOptions.some((option) => option.value === scope)) scope = 'current';
  });
  $effect(() => {
    const activeId = effectiveFilter;
    requestAnimationFrame(() =>
      document
        .getElementById(`palette-filter-${activeId}`)
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' }),
    );
  });
  $effect(() => {
    if (!query.trim() || englishSpell || englishSpellLoading) return;
    englishSpellLoading = true;
    void loadEnglishSpellchecker()
      .then((checker) => {
        englishSpell = checker;
      })
      .catch(() => {
        // Local spelling suggestions still work when the bundled dictionary is unavailable.
      })
      .finally(() => {
        englishSpellLoading = false;
      });
  });
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
    const term = textSearch;
    const availablePaths = paths;
    const currentSource = source;
    const controller = new AbortController();
    contentMatches = [];
    contentInaccessible = 0;
    contentTruncated = false;
    contentLoading = !!term;
    if (!term) return () => controller.abort();
    const timer = setTimeout(() => {
      void searchContents(currentSource, availablePaths, term, controller.signal, (result) => {
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
    if (result.kind === 'correction') {
      query = result.correction ?? query;
      selected = 0;
      input.focus();
      return;
    }
    if (result.kind === 'command' && result.id === 'pdf-go-page') {
      oncommand(result.id);
      filter = 'pages';
      query = '#';
      selected = 0;
      input.focus();
      return;
    }
    onclose();
    if (result.kind === 'file' || result.kind === 'tab') onopen(result.id);
    else if (result.kind === 'folder') onopenfolder(result.id, result.lastFile);
    else if (result.kind === 'heading') onheading(result.id);
    else if (result.kind === 'content') oncontent(result.id, search);
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

<dialog
  use:openDialog
  class="modal modal-open palette-modal"
  aria-label="Command palette"
  oncancel={onclose}
>
  <div class="modal-box palette-panel">
    <div class="palette-glow" aria-hidden="true"></div>
    <div class="palette-top">
      <div class="palette-search">
        <Search size={18} aria-hidden="true" />
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
          {placeholder}
          autocomplete="off"
          spellcheck="false"
        />
      </div>
      <button class="icon-button palette-close" aria-label="Close command palette" onclick={onclose}
        ><X size={18} /></button
      >
    </div>
    <div class="palette-tabs-row">
      <div class="palette-filters" role="group" aria-label="Result type">
        {#each filters as item, index (item.id)}
          {@const FilterIcon = item.icon}
          <button
            type="button"
            id="palette-filter-{item.id}"
            class="palette-filter"
            aria-label={item.label}
            aria-pressed={effectiveFilter === item.id}
            tabindex={effectiveFilter === item.id ? 0 : -1}
            title={item.prefix
              ? `${item.label} results · type ${item.prefix}`
              : `${item.label} results`}
            onmousedown={(event) => event.preventDefault()}
            onclick={() => selectFilter(item.id)}
            onkeydown={(event) => filterKeydown(event, index)}
          >
            <FilterIcon size={14} aria-hidden="true" />
            <span class="palette-filter-label">{item.label}</span>
            {#if item.prefix}<kbd class="palette-filter-key" aria-hidden="true">{item.prefix}</kbd
              >{/if}
          </button>
        {/each}
      </div>
      <div class="palette-scope">
        <span class="palette-scope-label">Scope</span>
        <div class="palette-scope-options" role="radiogroup" aria-label="Search scope">
          {#each scopeOptions as option, index (option.value)}
            <button
              type="button"
              id="palette-scope-{option.value}"
              class="palette-scope-option"
              role="radio"
              aria-checked={scope === option.value}
              tabindex={scope === option.value ? 0 : -1}
              onmousedown={(event) => event.preventDefault()}
              onclick={() => selectScope(option.value)}
              onkeydown={(event) => scopeKeydown(event, index)}>{option.label}</button
            >
          {/each}
        </div>
        <button
          type="button"
          class="palette-scope-cycle"
          aria-label="Search scope: {scopeLabel}. Activate to change."
          onmousedown={(event) => event.preventDefault()}
          onclick={cycleScope}
        >
          <ArrowLeftRight size={12} aria-hidden="true" />{scopeLabel}
        </button>
      </div>
    </div>
    <div id="palette-results" class="palette-results" role="listbox" aria-label="Search results">
      {#each results as result, index (`${result.kind}:${result.id}`)}
        {@const Icon = resultIcon(result)}
        <button
          id="palette-option-{index}"
          role="option"
          tabindex="-1"
          aria-selected={index === active}
          class="palette-result"
          class:active={index === active}
          class:correction={result.kind === 'correction'}
          data-kind={result.kind}
          onclick={() => choose(result)}
        >
          <span class="palette-result-icon" data-kind={result.kind}
            >{#if result.kind === 'file' || result.kind === 'tab'}
              <FileIcon name={basename(result.id)} />
            {:else if result.kind === 'folder'}
              <FileIcon name={basename(result.id)} directory expanded />
            {:else}
              <Icon size={17} aria-hidden="true" />
            {/if}</span
          >
          <span class="palette-result-text"
            ><span>{result.label}</span>{#if result.detail && result.detail !== result.label}<small
                >{result.detail}</small
              >{/if}</span
          >
          {#if result.right}<span class="palette-result-kind">{result.right}</span>{/if}
        </button>
      {/each}
      {#if !results.length && !loading && !contentLoading}<p class="palette-empty">
          {emptyMessage}
        </p>{/if}
    </div>
    <div class="palette-footer">
      <div class="palette-keys" aria-hidden="true">
        <span><kbd>↑</kbd><kbd>↓</kbd> Move</span>
        <span><kbd>↵</kbd> Open</span>
        <span><kbd>esc</kbd> Close</span>
      </div>
      <div class="palette-status" role="status">{footerStatus}</div>
    </div>
  </div>
</dialog>

<script lang="ts">
  import {
    ArrowUpDown,
    Ellipsis,
    Plus,
    Search,
    SlidersHorizontal,
    Sparkles,
    X,
  } from '@lucide/svelte';
  import BibliographyDetail from './BibliographyDetail.svelte';
  import {
    bibtexKey,
    bibliographyStats,
    ensureUniqueBibtexKey,
    parseBibliography,
    type BibliographyEntry,
  } from '../lib/bibliography';
  import { lookupReference, type LookupResult } from '../lib/reference-lookup';
  import { downloadReferences } from '../lib/reference-download';
  import type { LatexProjectMetadata } from '../lib/latex-project';

  let {
    path,
    text,
    project = undefined,
    oncopy,
    onopen,
    onappend,
    canadd = false,
  }: {
    path: string;
    text: string;
    project?: LatexProjectMetadata;
    oncopy: (text: string) => void;
    onopen?: (url: string) => void;
    onappend?: (entry: string) => Promise<boolean>;
    canadd?: boolean;
  } = $props();

  type Filter = 'all' | 'cited' | 'uncited' | 'missing-doi' | 'missing-abstract' | 'duplicates';
  type Sort = 'year-desc' | 'year-asc' | 'author' | 'title';
  type Grouping = 'year' | 'decade' | 'century';
  interface PendingLookup {
    result: LookupResult;
    bibtex: string;
    key: string;
  }

  let query = $state('');
  let filter = $state<Filter>('all');
  let typeFilter = $state('all');
  let sort = $state<Sort>('year-desc');
  let selectedId = $state<string | null>(null);
  let grouping = $state<Grouping>('year');
  let showEmptyBars = $state(true);
  let graphHidden = $state(false);
  let graphMenu = $state<{ x: number; y: number } | null>(null);
  let lookupOpen = $state(false);
  let lookupValue = $state('');
  let lookupBusy = $state(false);
  let lookupAdding = $state(false);
  let lookupError = $state('');
  let lookupStatus = $state('');
  let lookupNotice = $state('');
  let lookupResults = $state<LookupResult[]>([]);
  let lookupFailures = $state<{ identifier: string; error: string }[]>([]);
  let lookupAddingKey = $state<string | null>(null);
  let lookupDownloading = $state(false);
  let lookupDownloadingKey = $state<string | null>(null);
  let lookupInput = $state<HTMLInputElement>();
  let pendingKey = $state<string | null>(null);
  let lookupRequest = 0;

  const bibliography = $derived(parseBibliography(text, path));
  const entries = $derived(bibliography.entries);
  const canAddReferences = $derived(canadd && bibliography.format === 'bibtex');
  const citedKeys = $derived(project?.citedKeys ?? {});
  const stats = $derived(bibliographyStats(entries, citedKeys));
  const yearSpan = $derived(
    stats.years.length ? `${stats.years[0]}–${stats.years[stats.years.length - 1]}` : 'No years',
  );
  const typeOptions = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const entry of entries)
      counts.set(entry.typeLabel, (counts.get(entry.typeLabel) ?? 0) + 1);
    return [...counts].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  });
  const filteredEntries = $derived.by(() => {
    const needle = query.trim().toLocaleLowerCase();
    return entries
      .filter((entry) => {
        if (typeFilter !== 'all' && entry.typeLabel !== typeFilter) return false;
        if (filter === 'cited' && !(citedKeys[entry.key] > 0)) return false;
        if (filter === 'uncited' && citedKeys[entry.key] > 0) return false;
        if (filter === 'missing-doi' && entry.doi) return false;
        if (filter === 'missing-abstract' && entry.abstract) return false;
        if (filter === 'duplicates' && !entry.warnings.includes('Possible duplicate')) return false;
        if (!needle) return true;
        return [
          entry.title,
          entry.key,
          entry.authors.join(' '),
          entry.editors.join(' '),
          entry.container,
          entry.publisher,
          entry.year ? String(entry.year) : '',
          entry.keywords.join(' '),
          entry.abstract,
          entry.doi,
          entry.typeLabel,
        ]
          .join(' ')
          .toLocaleLowerCase()
          .includes(needle);
      })
      .sort((left, right) => {
        if (sort === 'year-asc') {
          return (
            (left.year ?? 9999) - (right.year ?? 9999) || left.title.localeCompare(right.title)
          );
        }
        if (sort === 'author') {
          return (
            (left.authors[0] ?? '').localeCompare(right.authors[0] ?? '') ||
            (right.year ?? 0) - (left.year ?? 0)
          );
        }
        if (sort === 'title') return left.title.localeCompare(right.title);
        return (right.year ?? -1) - (left.year ?? -1) || left.title.localeCompare(right.title);
      });
  });
  const activeEntry = $derived(
    entries.find((entry) => entry.id === selectedId) ?? filteredEntries[0] ?? entries[0] ?? null,
  );
  const timelineGroups = $derived.by(() => {
    const groups = new Map<number | null, BibliographyEntry[]>();
    for (const entry of filteredEntries) {
      const group = groups.get(entry.year) ?? [];
      group.push(entry);
      groups.set(entry.year, group);
    }
    return [...groups.entries()].sort((left, right) => (right[0] ?? -1) - (left[0] ?? -1));
  });
  const timelineBars = $derived.by(() => {
    const counts = new Map<number, number>();
    for (const entry of filteredEntries) {
      if (!entry.year) continue;
      const bucket = bucketForYear(entry.year);
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    }
    const buckets = [...counts.keys()].sort((left, right) => left - right);
    if (!buckets.length) return [];
    const step = grouping === 'year' ? 1 : grouping === 'decade' ? 10 : 100;
    const first = buckets[0];
    const last = buckets[buckets.length - 1];
    const bucketCount = (last - first) / step + 1;
    const bars: { key: string; label: string; count: number }[] = [];
    if (showEmptyBars && bucketCount <= 240) {
      for (let bucket = first; bucket <= last; bucket += step) {
        bars.push({
          key: String(bucket),
          label: groupLabel(bucket),
          count: counts.get(bucket) ?? 0,
        });
      }
    } else {
      for (const bucket of buckets) {
        bars.push({
          key: String(bucket),
          label: groupLabel(bucket),
          count: counts.get(bucket) ?? 0,
        });
      }
    }
    return bars;
  });
  const maxYearCount = $derived(Math.max(1, ...timelineBars.map((bar) => bar.count)));
  const activeFilterCount = $derived(
    [filter !== 'all', typeFilter !== 'all', query.trim() !== ''].filter(Boolean).length,
  );
  const lookupPending = $derived.by((): PendingLookup[] => {
    const used = new Set(entries.map((entry) => entry.key));
    const seen: BibliographyEntry[] = [];
    return lookupResults.flatMap((result) => {
      if (
        entries.some((entry) => sameReference(entry, result.entry)) ||
        seen.some((entry) => sameReference(entry, result.entry))
      ) {
        return [];
      }
      const bibtex = ensureUniqueBibtexKey(result.bibtex, result.entry, used);
      const key = bibtexKey(bibtex) ?? '';
      if (key) used.add(key);
      seen.push(result.entry);
      return [{ result, bibtex, key }];
    });
  });
  const lookupDuplicateCount = $derived(lookupResults.length - lookupPending.length);

  $effect(() => {
    if (selectedId && filteredEntries.some((entry) => entry.id === selectedId)) return;
    selectedId = filteredEntries[0]?.id ?? null;
  });
  $effect(() => {
    if (!pendingKey) return;
    const entry = entries.find((item) => item.key === pendingKey);
    if (!entry) return;
    selectedId = entry.id;
    pendingKey = null;
  });

  function bucketForYear(year: number): number {
    if (grouping === 'century') return Math.floor(year / 100) * 100;
    if (grouping === 'decade') return Math.floor(year / 10) * 10;
    return year;
  }
  function ordinal(value: number): string {
    if (value % 100 >= 11 && value % 100 <= 13) return `${value}th`;
    if (value % 10 === 1) return `${value}st`;
    if (value % 10 === 2) return `${value}nd`;
    if (value % 10 === 3) return `${value}rd`;
    return `${value}th`;
  }
  function groupLabel(bucket: number): string {
    if (grouping === 'century') return `${ordinal(bucket / 100 + 1)} c.`;
    if (grouping === 'decade') return `${bucket}s`;
    return String(bucket);
  }
  function selectEntry(entry: BibliographyEntry) {
    selectedId = entry.id;
  }
  function typeTone(type: string): string {
    if (/article|journal/.test(type)) return 'journal';
    if (/conference|proceedings/.test(type)) return 'conference';
    if (/book|chapter|collection/.test(type)) return 'book';
    if (/thesis/.test(type)) return 'thesis';
    if (/report|manual/.test(type)) return 'report';
    if (/dataset|software|online|web/.test(type)) return 'digital';
    if (/preprint|arxiv/.test(type)) return 'digital';
    return 'other';
  }
  function normalizedDoi(value: string): string {
    return value
      .trim()
      .toLocaleLowerCase()
      .replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '')
      .replace(/^doi:\s*/, '');
  }
  function sameReference(left: BibliographyEntry, right: BibliographyEntry): boolean {
    if (left.doi && right.doi && normalizedDoi(left.doi) === normalizedDoi(right.doi)) return true;
    const leftArxiv = left.fields.eprint?.toLocaleLowerCase();
    const rightArxiv = right.fields.eprint?.toLocaleLowerCase();
    if (leftArxiv && rightArxiv && leftArxiv === rightArxiv) return true;
    const leftPmid = left.fields.pmid?.trim();
    const rightPmid = right.fields.pmid?.trim();
    if (leftPmid && rightPmid && leftPmid === rightPmid) return true;
    const leftIdentifier = normalizedDoi(left.doi) || leftArxiv || leftPmid;
    const rightIdentifier = normalizedDoi(right.doi) || rightArxiv || rightPmid;
    if (leftIdentifier || rightIdentifier) return false;
    return Boolean(
      left.title &&
      right.title &&
      left.title.toLocaleLowerCase() === right.title.toLocaleLowerCase() &&
      left.year === right.year,
    );
  }
  function resetLookupState() {
    lookupBusy = false;
    lookupAdding = false;
    lookupAddingKey = null;
    lookupDownloading = false;
    lookupDownloadingKey = null;
    lookupError = '';
    lookupNotice = '';
    lookupStatus = '';
    lookupResults = [];
    lookupFailures = [];
  }
  function openLookup() {
    if (!canAddReferences) return;
    graphMenu = null;
    lookupRequest++;
    lookupOpen = true;
    lookupValue = '';
    resetLookupState();
    requestAnimationFrame(() => lookupInput?.focus());
  }
  function closeLookup() {
    lookupRequest++;
    lookupOpen = false;
    lookupValue = '';
    resetLookupState();
  }
  function resetLookup() {
    lookupRequest++;
    lookupValue = '';
    resetLookupState();
    requestAnimationFrame(() => lookupInput?.focus());
  }
  async function submitLookup(event: SubmitEvent) {
    event.preventDefault();
    if (lookupBusy || lookupDownloading || lookupDownloadingKey) return;
    const identifiers = [
      ...new Set(
        lookupValue
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ];
    if (!identifiers.length) {
      lookupError = 'Enter at least one DOI, arXiv ID, or PubMed ID.';
      return;
    }
    const request = ++lookupRequest;
    lookupBusy = true;
    lookupError = '';
    lookupNotice = '';
    lookupAddingKey = null;
    lookupDownloading = false;
    lookupDownloadingKey = null;
    lookupStatus = `Looking up ${identifiers.length} ${identifiers.length === 1 ? 'reference' : 'references'}…`;
    lookupResults = [];
    lookupFailures = [];
    const results: LookupResult[] = [];
    const failures: { identifier: string; error: string }[] = [];
    let cursor = 0;
    let completed = 0;
    const worker = async () => {
      while (cursor < identifiers.length) {
        if (request !== lookupRequest) return;
        const index = cursor++;
        try {
          results[index] = await lookupReference(identifiers[index]);
        } catch (error) {
          failures.push({
            identifier: identifiers[index],
            error: error instanceof Error ? error.message : String(error),
          });
        }
        if (request !== lookupRequest) return;
        completed++;
        lookupStatus = `Looking up ${completed} of ${identifiers.length}…`;
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(3, identifiers.length) }, () => worker()));
    } finally {
      if (request === lookupRequest) {
        lookupResults = results.filter((result): result is LookupResult => Boolean(result));
        lookupFailures = failures;
        lookupStatus = '';
        lookupBusy = false;
      }
    }
  }
  async function addLookup() {
    if (
      !lookupPending.length ||
      !onappend ||
      lookupAdding ||
      lookupAddingKey ||
      lookupBusy ||
      !canAddReferences
    )
      return;
    const pending = lookupPending;
    const key = pending[0]?.key ?? null;
    const bibtex = pending.map((item) => item.bibtex.trim()).join('\n\n');
    lookupAdding = true;
    lookupError = '';
    lookupNotice = '';
    try {
      const added = await onappend(bibtex);
      if (!added) {
        lookupError = 'Could not write to the bibliography file.';
        return;
      }
      clearFilters();
      pendingKey = key;
      closeLookup();
    } catch (error) {
      lookupError = error instanceof Error ? error.message : String(error);
    } finally {
      lookupAdding = false;
    }
  }
  async function addSingleLookup(item: PendingLookup) {
    if (
      !onappend ||
      lookupAdding ||
      lookupAddingKey ||
      lookupBusy ||
      lookupDownloading ||
      lookupDownloadingKey ||
      !canAddReferences
    )
      return;
    lookupAddingKey = item.key;
    lookupError = '';
    lookupNotice = '';
    try {
      const added = await onappend(item.bibtex);
      if (!added) {
        lookupError = 'Could not write to the bibliography file.';
        return;
      }
      clearFilters();
      pendingKey = item.key;
      lookupNotice = `Added “${item.result.entry.title}”.`;
      const remaining = lookupPending.filter((entry) => entry.key !== item.key);
      lookupResults = remaining.length
        ? lookupResults.filter((result) => result !== item.result)
        : [];
    } catch (error) {
      lookupError = error instanceof Error ? error.message : String(error);
    } finally {
      lookupAddingKey = null;
    }
  }
  function downloadSummary(files: { format: string }[]): string {
    const counts = new Map<string, number>();
    for (const file of files) counts.set(file.format, (counts.get(file.format) ?? 0) + 1);
    return [...counts.entries()]
      .map(([format, count]) => {
        const label =
          format === 'pdf' ? 'PDF' : format === 'html' ? 'HTML page' : format.toUpperCase();
        return `${count} ${label}${count === 1 ? '' : 's'}`;
      })
      .join(' + ');
  }
  async function downloadSingleLookup(item: PendingLookup) {
    if (lookupBusy || lookupAdding || lookupAddingKey || lookupDownloading || lookupDownloadingKey)
      return;
    lookupDownloadingKey = item.key;
    lookupError = '';
    lookupNotice = '';
    try {
      const saved = await downloadReferences([
        {
          key: item.key,
          kind: item.result.kind,
          identifier: item.result.identifier,
          pmc: item.result.entry.fields.pmc ?? null,
        },
      ]);
      if (saved.files.length) {
        lookupNotice = `Saved ${downloadSummary(saved.files)} to ${saved.directory}.`;
      }
      if (saved.failures.length) {
        lookupError = saved.failures
          .map((failure) => `${failure.identifier}: ${failure.error}`)
          .join(' · ');
      }
    } catch (error) {
      lookupError = error instanceof Error ? error.message : String(error);
    } finally {
      lookupDownloadingKey = null;
    }
  }
  async function downloadAllLookups() {
    if (!lookupPending.length || lookupBusy || lookupAdding || lookupAddingKey || lookupDownloading)
      return;
    lookupDownloading = true;
    lookupError = '';
    lookupNotice = '';
    try {
      const saved = await downloadReferences(
        lookupPending.map((item) => ({
          key: item.key,
          kind: item.result.kind,
          identifier: item.result.identifier,
          pmc: item.result.entry.fields.pmc ?? null,
        })),
      );
      if (saved.files.length) {
        lookupNotice = `Saved ${downloadSummary(saved.files)} to ${saved.directory}.`;
      }
      if (saved.failures.length) {
        lookupError = saved.failures
          .map((failure) => `${failure.identifier}: ${failure.error}`)
          .join(' · ');
      }
    } catch (error) {
      lookupError = error instanceof Error ? error.message : String(error);
    } finally {
      lookupDownloading = false;
    }
  }
  function clearFilters() {
    filter = 'all';
    typeFilter = 'all';
    query = '';
  }
  function graphMenuPosition(x: number, y: number) {
    const scale = Number(document.documentElement.style.zoom) || 1;
    const menuWidth = 220 * scale;
    const menuHeight = 260 * scale;
    return {
      x: Math.max(8, Math.min(x, window.innerWidth - menuWidth - 8)) / scale,
      y: Math.max(8, Math.min(y, window.innerHeight - menuHeight - 8)) / scale,
    };
  }
  function openGraphMenu(event: MouseEvent) {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest('.year-rhythm-scroll')) return;
    event.preventDefault();
    graphMenu = graphMenuPosition(event.clientX, event.clientY);
  }
  function openGraphMenuFromButton(event: MouseEvent) {
    event.stopPropagation();
    const target = event.currentTarget;
    if (!(target instanceof HTMLElement)) return;
    const rect = target.getBoundingClientRect();
    graphMenu = graphMenuPosition(rect.left, rect.bottom + 4);
  }
  function closeGraphMenu() {
    if (graphMenu) graphMenu = null;
  }
  function setGrouping(value: Grouping) {
    grouping = value;
    graphMenu = null;
  }
  function toggleEmptyBars() {
    showEmptyBars = !showEmptyBars;
    graphMenu = null;
  }
  function toggleGraphHidden() {
    graphHidden = !graphHidden;
    graphMenu = null;
  }
</script>

<svelte:window
  oncontextmenu={openGraphMenu}
  onclick={closeGraphMenu}
  onkeydown={(event) => {
    if (event.key === 'Escape') {
      graphMenu = null;
      if (lookupOpen) closeLookup();
    }
  }}
/>

<div class="bib-shell">
  <header class="bib-hero">
    <p class="bib-lede">
      {stats.total} entries · {yearSpan} · {stats.authors} authors · {stats.venues} venues · {stats.keywords}
      keywords
    </p>
    <div class="bib-health">
      <button class:active={filter === 'all'} onclick={() => (filter = 'all')}>
        All <strong>{stats.total}</strong>
      </button>
      <button class="cited" class:active={filter === 'cited'} onclick={() => (filter = 'cited')}>
        Cited <strong>{stats.cited}</strong>
      </button>
      <button class:active={filter === 'uncited'} onclick={() => (filter = 'uncited')}>
        Uncited <strong>{stats.uncited}</strong>
      </button>
      <button
        class="warn"
        class:active={filter === 'missing-doi'}
        onclick={() => (filter = 'missing-doi')}
      >
        No DOI <strong>{stats.missingDoi}</strong>
      </button>
      <button
        class="warn"
        class:active={filter === 'missing-abstract'}
        onclick={() => (filter = 'missing-abstract')}
      >
        No abstract <strong>{stats.missingAbstract}</strong>
      </button>
      {#if stats.duplicateWarnings}
        <button
          class="warn"
          class:active={filter === 'duplicates'}
          onclick={() => (filter = 'duplicates')}
        >
          Duplicates <strong>{stats.duplicateWarnings}</strong>
        </button>
      {/if}
    </div>
  </header>

  {#if bibliography.warnings.length}
    <div class="bib-warning" role="status">
      {bibliography.warnings.join(' · ')}
    </div>
  {/if}

  <div class="bib-toolbar">
    <div class="bib-result-line">
      <span>{filteredEntries.length} of {entries.length} references</span>
      {#if filter !== 'all' || typeFilter !== 'all' || query}
        <span class="result-context">
          {#if query}“{query}”{/if}
          {#if typeFilter !== 'all'}· {typeFilter}{/if}
          {#if filter !== 'all'}· {filter.replace('-', ' ')}{/if}
        </span>
      {/if}
    </div>
    <div class="bib-tools">
      <label class="bib-search">
        <Search size={14} aria-hidden="true" />
        <input bind:value={query} placeholder="Search title, author, venue, keyword…" />
        {#if query}
          <button class="clear-search" onclick={() => (query = '')} aria-label="Clear search"
            ><X size={13} /></button
          >
        {/if}
      </label>
      <label class="bib-select">
        <SlidersHorizontal size={13} aria-hidden="true" />
        <select bind:value={typeFilter} aria-label="Filter reference type">
          <option value="all">All types</option>
          {#each typeOptions as [label, count] (label)}
            <option value={label}>{label} ({count})</option>
          {/each}
        </select>
      </label>
      <label class="bib-select">
        <ArrowUpDown size={13} aria-hidden="true" />
        <select bind:value={sort} aria-label="Sort references">
          <option value="year-desc">Newest first</option>
          <option value="year-asc">Oldest first</option>
          <option value="author">Author</option>
          <option value="title">Title</option>
        </select>
      </label>
      <button
        class="add-reference"
        onclick={openLookup}
        disabled={!canAddReferences}
        title={canAddReferences
          ? 'Add a reference from a DOI, arXiv ID, or PubMed ID'
          : 'Adding references is available for writable BibTeX files'}
      >
        <Plus size={14} />
        <span>Add</span>
      </button>
      <button
        class="graph-options"
        onclick={openGraphMenuFromButton}
        aria-label="Timeline graph options"
        title="Graph options"
      >
        <Ellipsis size={14} />
      </button>
      {#if activeFilterCount}
        <button class="bib-reset" onclick={clearFilters}>Reset</button>
      {/if}
    </div>
  </div>

  <main class="bib-stage">
    {#if !entries.length}
      <div class="bib-empty">
        <Sparkles size={24} />
        <h2>No references found</h2>
        <p>This file could not be parsed as BibTeX, RIS, CSL JSON, NBIB, or EndNote.</p>
        <pre>{text.slice(0, 1200)}</pre>
      </div>
    {:else}
      <div class="timeline-layout">
        <section class="timeline-main">
          {#if !graphHidden && timelineBars.length}
            <div
              class="year-rhythm-scroll"
              role="group"
              aria-label={`References per ${grouping}`}
              title="Right-click to change grouping"
            >
              <div class="year-rhythm">
                {#each timelineBars as bar (bar.key)}
                  <div
                    class="rhythm-bar"
                    class:empty={!bar.count}
                    role="img"
                    aria-label={`${bar.label}: ${bar.count} references`}
                    title={`${bar.label}: ${bar.count}`}
                  >
                    <span
                      style={`height: ${bar.count ? Math.max(6, (bar.count / maxYearCount) * 100) : 2}%`}
                    ></span>
                    <small>{bar.label}</small>
                  </div>
                {/each}
              </div>
            </div>
          {/if}

          {#if !timelineGroups.length}
            <div class="list-empty">
              <p>No references match these filters.</p>
              <button onclick={clearFilters}>Clear filters</button>
            </div>
          {:else}
            <div class="timeline">
              {#each timelineGroups as [year, group] (year)}
                <section class="timeline-group">
                  <div class="timeline-year">
                    <strong>{year ?? '—'}</strong>
                    <span>{group.length} {group.length === 1 ? 'entry' : 'entries'}</span>
                  </div>
                  <div class="timeline-rail">
                    <span class="rail-dot" aria-hidden="true"></span>
                    {#each group as entry (entry.id)}
                      <button
                        class="timeline-card tone-{typeTone(entry.type)}"
                        class:selected={activeEntry?.id === entry.id}
                        onclick={() => selectEntry(entry)}
                      >
                        <span class="timeline-type">{entry.typeLabel}</span>
                        <strong>{entry.title}</strong>
                        {#if entry.authors.length}<span>{entry.authors.join(' · ')}</span>{/if}
                        {#if entry.container}<em>{entry.container}</em>{/if}
                        <code>{entry.key}</code>
                      </button>
                    {/each}
                  </div>
                </section>
              {/each}
            </div>
          {/if}
        </section>

        <section class="detail-pane timeline-detail" aria-label="Selected reference">
          {#if activeEntry}
            <BibliographyDetail
              entry={activeEntry}
              citedCount={citedKeys[activeEntry.key] ?? 0}
              tone={typeTone(activeEntry.type)}
              {oncopy}
              {onopen}
            />
          {/if}
        </section>
      </div>
    {/if}
  </main>

  {#if lookupOpen}
    <div class="lookup-layer">
      <button class="lookup-backdrop" aria-label="Close add reference dialog" onclick={closeLookup}
      ></button>
      <dialog open class="lookup-panel" aria-modal="true" aria-label="Add reference">
        <header class="lookup-header">
          <h2>Add reference</h2>
          <button class="lookup-close" aria-label="Close" onclick={closeLookup}>
            <X size={16} />
          </button>
        </header>
        <p class="lookup-hint">
          Enter one or more DOIs, arXiv IDs, or PubMed IDs separated by commas. The citation
          metadata is fetched from the registrar, then appended to this file.
        </p>
        <form class="lookup-form" onsubmit={submitLookup}>
          <input
            bind:this={lookupInput}
            bind:value={lookupValue}
            placeholder="10.1038/nature12373, 2401.00001, PMID 31452104"
            aria-label="Comma-separated DOI, arXiv ID, or PubMed ID"
            disabled={lookupBusy ||
              lookupAdding ||
              !!lookupAddingKey ||
              lookupDownloading ||
              !!lookupDownloadingKey}
          />
          <button
            type="submit"
            disabled={lookupBusy ||
              lookupAdding ||
              !!lookupAddingKey ||
              lookupDownloading ||
              !!lookupDownloadingKey ||
              !lookupValue.trim()}
          >
            {lookupBusy ? 'Looking up…' : 'Look up'}
          </button>
        </form>
        {#if lookupStatus}
          <p class="lookup-status" role="status">{lookupStatus}</p>
        {/if}
        {#if lookupError}
          <p class="lookup-error" role="alert">{lookupError}</p>
        {/if}
        {#if lookupResults.length || lookupFailures.length || lookupNotice}
          <div class="lookup-preview">
            {#if lookupNotice}
              <p class="lookup-notice" role="status">{lookupNotice}</p>
            {/if}
            {#if lookupPending.length}
              <div class="lookup-batch-summary">
                <span class="lookup-ready-count"
                  >{lookupPending.length}
                  {lookupPending.length === 1 ? 'reference' : 'references'} ready</span
                >
                {#if lookupDuplicateCount}
                  <span class="lookup-skipped-count"
                    >{lookupDuplicateCount} duplicate(s) skipped</span
                  >
                {/if}
              </div>
              <div class="lookup-list">
                {#each lookupPending as item (item.key)}
                  <article class="lookup-item tone-{typeTone(item.result.entry.type)}">
                    <div class="lookup-meta">
                      <span class="lookup-meta-type">{item.result.entry.typeLabel}</span>
                      <span class="lookup-meta-year">{item.result.entry.year ?? 'No year'}</span>
                      <span class="lookup-meta-id">{item.result.identifier}</span>
                    </div>
                    <h3>{item.result.entry.title}</h3>
                    {#if item.result.entry.authors.length}
                      <p class="lookup-authors">{item.result.entry.authors.join(' · ')}</p>
                    {/if}
                    {#if item.result.entry.container}
                      <p class="lookup-venue">{item.result.entry.container}</p>
                    {/if}
                    <div class="lookup-key">
                      <span>Citation key</span>
                      <code>{item.key || '—'}</code>
                    </div>
                    <details class="lookup-bibtex">
                      <summary>BibTeX</summary>
                      <pre>{item.bibtex}</pre>
                    </details>
                    <div class="lookup-item-actions">
                      <button
                        class="lookup-item-download"
                        onclick={() => downloadSingleLookup(item)}
                        disabled={lookupBusy ||
                          lookupAdding ||
                          !!lookupAddingKey ||
                          lookupDownloading ||
                          !!lookupDownloadingKey}
                        title="Download the PDF, or the HTML landing page if no PDF is available"
                      >
                        {lookupDownloadingKey === item.key ? 'Downloading…' : 'Download'}
                      </button>
                      <button
                        class="lookup-item-add"
                        onclick={() => addSingleLookup(item)}
                        disabled={lookupAdding ||
                          lookupBusy ||
                          !!lookupAddingKey ||
                          lookupDownloading ||
                          !!lookupDownloadingKey ||
                          !canAddReferences}
                        title={canAddReferences
                          ? 'Append this entry to the bibliography file'
                          : 'Adding requires a writable BibTeX file'}
                      >
                        {lookupAddingKey === item.key ? 'Adding…' : 'Add this reference'}
                      </button>
                    </div>
                  </article>
                {/each}
              </div>
              <div class="lookup-actions">
                <button
                  class="lookup-add"
                  onclick={addLookup}
                  disabled={lookupAdding ||
                    lookupBusy ||
                    !!lookupAddingKey ||
                    lookupDownloading ||
                    !!lookupDownloadingKey ||
                    !canAddReferences}
                  title={canAddReferences
                    ? 'Append all ready entries to the bibliography file'
                    : 'Adding requires a writable BibTeX file'}
                >
                  {lookupAdding
                    ? 'Adding…'
                    : lookupPending.length === 1
                      ? 'Add reference'
                      : `Add all ${lookupPending.length} references`}
                </button>
                <button
                  class="lookup-download-all"
                  onclick={downloadAllLookups}
                  disabled={lookupBusy ||
                    lookupAdding ||
                    !!lookupAddingKey ||
                    lookupDownloading ||
                    !!lookupDownloadingKey}
                  title="Download PDFs, or HTML landing pages where no PDF is available"
                >
                  {lookupDownloading
                    ? 'Downloading…'
                    : lookupPending.length === 1
                      ? 'Download reference'
                      : `Download all ${lookupPending.length}`}
                </button>
                <button
                  class="lookup-reset"
                  onclick={resetLookup}
                  disabled={lookupAdding ||
                    !!lookupAddingKey ||
                    lookupDownloading ||
                    !!lookupDownloadingKey}
                >
                  Look up another
                </button>
              </div>
            {:else if lookupResults.length}
              <p class="lookup-note">
                All fetched references are already in the library or duplicated in this batch.
              </p>
              <div class="lookup-actions">
                <button class="lookup-reset" onclick={resetLookup}>Look up another</button>
              </div>
            {/if}
            {#if lookupFailures.length}
              <div class="lookup-failures">
                <p class="lookup-failures-title">Could not look up:</p>
                {#each lookupFailures as failure (failure.identifier)}
                  <p><code>{failure.identifier}</code> — {failure.error}</p>
                {/each}
                {#if !lookupPending.length}
                  <div class="lookup-actions">
                    <button class="lookup-reset" onclick={resetLookup}>Start over</button>
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {:else if !lookupBusy}
          <p class="lookup-example">
            Examples: <code>10.1038/nature12373, 2401.00001, PMID 31452104</code>
          </p>
        {/if}
      </dialog>
    </div>
  {/if}

  {#if graphMenu}
    <div
      class="graph-menu"
      role="menu"
      aria-label="Timeline graph options"
      style={`left: ${graphMenu.x}px; top: ${graphMenu.y}px`}
    >
      <span class="graph-menu-title">Timeline graph</span>
      <button role="menuitemcheckbox" aria-checked={showEmptyBars} onclick={toggleEmptyBars}>
        <span class="menu-check">{showEmptyBars ? '✓' : ''}</span>
        Show empty bars
      </button>
      <div class="menu-separator"></div>
      <button
        role="menuitemradio"
        aria-checked={grouping === 'year'}
        onclick={() => setGrouping('year')}
      >
        <span class="menu-check">{grouping === 'year' ? '✓' : ''}</span>
        Group by year
      </button>
      <button
        role="menuitemradio"
        aria-checked={grouping === 'decade'}
        onclick={() => setGrouping('decade')}
      >
        <span class="menu-check">{grouping === 'decade' ? '✓' : ''}</span>
        Group by decade
      </button>
      <button
        role="menuitemradio"
        aria-checked={grouping === 'century'}
        onclick={() => setGrouping('century')}
      >
        <span class="menu-check">{grouping === 'century' ? '✓' : ''}</span>
        Group by century
      </button>
      <div class="menu-separator"></div>
      <button role="menuitemcheckbox" aria-checked={graphHidden} onclick={toggleGraphHidden}>
        <span class="menu-check">{graphHidden ? '✓' : ''}</span>
        {graphHidden ? 'Show graph' : 'Hide graph'}
      </button>
    </div>
  {/if}
</div>

<style>
  .bib-shell {
    --bib-serif: 'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', Georgia, serif;
    --bib-accent: var(--color-primary);
    --bib-accent-soft: color-mix(in srgb, var(--bib-accent) 14%, transparent);
    --bib-rule: color-mix(in srgb, var(--color-base-content) 16%, transparent);
    --bib-rule-soft: color-mix(in srgb, var(--color-base-content) 9%, transparent);
    --bib-tone-journal: var(--color-secondary);
    --bib-tone-conference: color-mix(in srgb, var(--color-warning) 65%, var(--color-error) 35%);
    --bib-tone-book: var(--color-accent);
    --bib-tone-thesis: var(--color-primary);
    --bib-tone-report: var(--color-warning);
    --bib-tone-digital: var(--color-info);
    --bib-tone-other: var(--muted);
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    color: var(--color-base-content);
    background: var(--color-base-100);
  }
  .bib-hero {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.5rem 1.4rem 0.45rem;
    border-bottom: 1px solid var(--bib-rule);
    flex-wrap: wrap;
  }
  .bib-lede {
    margin: 0;
    color: var(--muted);
    font-size: 0.68rem;
  }
  .bib-health {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.25rem 0.5rem;
  }
  .bib-health button {
    border: 0;
    border-bottom: 1px solid transparent;
    border-radius: 0;
    background: transparent;
    color: var(--muted);
    padding: 0.1rem 0;
    font-size: 0.66rem;
    cursor: pointer;
  }
  .bib-health button + button::before {
    content: '·';
    margin-right: 0.4rem;
    color: var(--bib-rule);
  }
  .bib-health button:hover {
    color: var(--color-base-content);
  }
  .bib-health button strong {
    color: inherit;
    font-weight: 600;
    margin-left: 0.18rem;
  }
  .bib-health button.active {
    border-bottom-color: var(--bib-accent);
    color: var(--color-base-content);
  }
  .bib-health button.warn strong {
    color: color-mix(in srgb, var(--color-warning) 72%, var(--muted));
  }
  .bib-health button.cited strong {
    color: var(--color-success);
  }
  .bib-warning {
    margin: 0.5rem 1.4rem 0;
    padding: 0.4rem 0.6rem;
    border-radius: 2px;
    color: var(--color-warning);
    background: color-mix(in srgb, var(--color-warning) 7%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-warning) 20%, transparent);
    font-size: 0.72rem;
  }
  .bib-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.4rem 1.4rem;
    border-bottom: 1px solid var(--bib-rule);
    flex-wrap: wrap;
  }
  .bib-result-line {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--muted);
    font-size: 0.64rem;
  }
  .result-context {
    color: color-mix(in srgb, var(--bib-accent) 70%, var(--muted));
  }
  .bib-tools {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
  }
  .bib-search,
  .bib-select {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.22rem 0.45rem;
    border: 1px solid var(--bib-rule);
    border-radius: 3px;
    background: transparent;
    color: var(--muted);
  }
  .bib-search:focus-within {
    border-color: var(--bib-accent);
  }
  .bib-search input {
    width: min(18rem, 29vw);
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--color-base-content);
    font-size: 0.7rem;
  }
  .bib-search input::placeholder {
    color: color-mix(in srgb, var(--muted) 75%, transparent);
  }
  .clear-search {
    display: grid;
    place-items: center;
    border: 0;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
  }
  .bib-select select {
    max-width: 9rem;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--color-base-content);
    font-size: 0.68rem;
  }
  .graph-options {
    display: grid;
    place-items: center;
    width: 1.85rem;
    height: 1.85rem;
    border: 1px solid var(--bib-rule);
    border-radius: 3px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
  }
  .graph-options:hover {
    color: var(--color-base-content);
    border-color: var(--bib-accent);
  }
  .add-reference {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.28rem 0.5rem;
    border: 1px solid color-mix(in srgb, var(--bib-accent) 55%, var(--bib-rule));
    border-radius: 3px;
    background: var(--bib-accent-soft);
    color: var(--color-base-content);
    font-size: 0.68rem;
    cursor: pointer;
  }
  .add-reference:hover {
    border-color: var(--bib-accent);
    background: color-mix(in srgb, var(--bib-accent) 22%, transparent);
  }
  .add-reference:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .bib-reset {
    color: var(--bib-accent);
    border: 0;
    border-bottom: 1px solid color-mix(in srgb, var(--bib-accent) 50%, transparent);
    border-radius: 0;
    background: transparent;
    padding: 0.1rem 0;
    font-size: 0.66rem;
    cursor: pointer;
  }
  .bib-stage {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    padding: 0.5rem 1.4rem 0.9rem;
  }
  .timeline-layout {
    display: grid;
    grid-template-columns: minmax(24rem, 1fr) minmax(24rem, 1fr);
    gap: 1.2rem;
    height: 100%;
    min-height: 0;
  }
  .timeline-main,
  .detail-pane,
  .timeline-detail {
    min-width: 0;
    min-height: 0;
    overflow: auto;
  }
  .timeline-main {
    padding-right: 0.2rem;
  }
  .year-rhythm-scroll {
    overflow-x: auto;
    overflow-y: hidden;
    border-bottom: 1px solid var(--bib-rule);
    scrollbar-width: thin;
  }
  .year-rhythm {
    display: flex;
    align-items: flex-end;
    gap: 0.15rem;
    height: 3.5rem;
    min-width: 100%;
    width: max-content;
    padding: 0.3rem 0.2rem 0.3rem 0;
  }
  .rhythm-bar {
    flex: 1 0 2.2rem;
    max-width: 3.2rem;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: center;
    gap: 0.18rem;
    height: 100%;
  }
  .rhythm-bar span {
    width: 72%;
    border-radius: 1px 1px 0 0;
    background: var(--bib-accent);
    opacity: 0.72;
    min-height: 2px;
  }
  .rhythm-bar.empty span {
    background: color-mix(in srgb, var(--color-base-content) 12%, transparent);
    opacity: 1;
  }
  .rhythm-bar.empty small {
    color: color-mix(in srgb, var(--muted) 55%, transparent);
  }
  .rhythm-bar small {
    color: var(--muted);
    font-size: 0.5rem;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .timeline {
    display: block;
    position: relative;
    padding: 0.7rem 0 1rem;
  }
  .timeline::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 4.225rem;
    width: 1px;
    background: var(--bib-rule);
  }
  .timeline-group {
    display: grid;
    grid-template-columns: 3.6rem minmax(0, 1fr);
    gap: 1rem;
    padding: 0.35rem 0 0.7rem;
  }
  .timeline-year {
    position: sticky;
    top: 0;
    align-self: start;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding-top: 0.15rem;
  }
  .timeline-year strong {
    font-family: var(--bib-serif);
    color: var(--color-base-content);
    font-size: 1.3rem;
    font-weight: 600;
    line-height: 1.05;
    letter-spacing: -0.02em;
  }
  .timeline-year span {
    color: var(--muted);
    font-size: 0.6rem;
  }
  .timeline-rail {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .rail-dot {
    position: absolute;
    top: 0.6rem;
    left: -0.6rem;
    width: 0.45rem;
    height: 0.45rem;
    border: 1px solid var(--bib-accent);
    border-radius: 50%;
    background: var(--color-base-100);
  }
  .timeline-card {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.12rem;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    box-sizing: border-box;
    padding: 0.55rem 0.65rem;
    text-align: left;
    border: 1px solid var(--bib-rule);
    border-left: 2px solid var(--tone, var(--bib-accent));
    border-radius: 3px;
    background: transparent;
    color: var(--color-base-content);
    cursor: pointer;
    flex-shrink: 0;
  }
  .timeline-card:hover {
    border-color: color-mix(in srgb, var(--tone) 38%, var(--bib-rule));
    background: color-mix(in srgb, var(--color-base-200) 30%, transparent);
  }
  .timeline-card.selected {
    border-color: color-mix(in srgb, var(--tone) 55%, var(--bib-rule));
    background: color-mix(in srgb, var(--tone) 6%, transparent);
  }
  .timeline-card:focus {
    outline: none;
  }
  .timeline-card:focus-visible {
    outline: 1px solid var(--bib-accent);
    outline-offset: -1px;
  }
  .timeline-card strong {
    max-width: 100%;
    overflow-wrap: anywhere;
    font-family: var(--bib-serif);
    font-size: 0.92rem;
    font-weight: 600;
    line-height: 1.3;
  }
  .timeline-type {
    color: var(--tone, var(--bib-accent));
    font-size: 0.56rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .timeline-card span,
  .timeline-card em {
    color: var(--muted);
    font-size: 0.67rem;
    font-style: normal;
  }
  .timeline-card em {
    font-style: italic;
  }
  .timeline-card code {
    color: var(--muted);
    font-family: var(--code-font, monospace);
    font-size: 0.58rem;
  }
  .tone-journal {
    --tone: var(--bib-tone-journal);
  }
  .tone-conference {
    --tone: var(--bib-tone-conference);
  }
  .tone-book {
    --tone: var(--bib-tone-book);
  }
  .tone-thesis {
    --tone: var(--bib-tone-thesis);
  }
  .tone-report {
    --tone: var(--bib-tone-report);
  }
  .tone-digital {
    --tone: var(--bib-tone-digital);
  }
  .tone-other {
    --tone: var(--bib-tone-other);
  }
  .list-empty {
    padding: 2rem 1rem;
    color: var(--muted);
    text-align: center;
    font-size: 0.8rem;
  }
  .list-empty button {
    margin-top: 0.5rem;
    border: 1px solid var(--bib-rule);
    border-radius: 3px;
    background: transparent;
    color: var(--color-base-content);
    padding: 0.3rem 0.6rem;
    cursor: pointer;
  }
  .lookup-layer {
    position: fixed;
    inset: 0;
    z-index: 90;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 7vh 1rem 1rem;
    overflow: auto;
  }
  .lookup-backdrop {
    position: fixed;
    inset: 0;
    border: 0;
    background: color-mix(in srgb, var(--color-base-300) 78%, transparent);
    cursor: default;
  }
  .lookup-panel {
    position: relative;
    z-index: 1;
    width: min(42rem, 100%);
    margin: 0;
    padding: 1rem 1.1rem;
    border: 1px solid color-mix(in srgb, var(--bib-accent) 50%, var(--bib-rule));
    border-top: 2px solid var(--bib-accent);
    border-radius: 3px;
    background: var(--color-base-100);
    color: var(--color-base-content);
    box-shadow: 0 18px 50px #0007;
  }
  .lookup-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid color-mix(in srgb, var(--bib-accent) 22%, var(--bib-rule));
  }
  .lookup-status {
    margin: 0.5rem 0 0;
    color: var(--color-secondary);
    font-size: 0.66rem;
  }
  .lookup-header h2 {
    margin: 0.1rem 0 0;
    font-family: var(--bib-serif);
    font-size: 1.25rem;
    font-weight: 600;
  }
  .lookup-close {
    display: grid;
    place-items: center;
    width: 1.6rem;
    height: 1.6rem;
    border: 1px solid var(--bib-rule);
    border-radius: 2px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
  }
  .lookup-close:hover {
    color: var(--color-base-content);
    border-color: var(--bib-accent);
  }
  .lookup-hint {
    margin: 0.55rem 0 0.8rem;
    color: var(--muted);
    font-size: 0.7rem;
    line-height: 1.45;
  }
  .lookup-form {
    display: flex;
    gap: 0.4rem;
  }
  .lookup-form input {
    flex: 1;
    min-width: 0;
    padding: 0.4rem 0.5rem;
    border: 1px solid var(--bib-rule);
    border-radius: 2px;
    background: transparent;
    color: var(--color-base-content);
    font-size: 0.74rem;
  }
  .lookup-form input:focus {
    outline: none;
    border-color: var(--color-secondary);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-secondary) 18%, transparent);
  }
  .lookup-form button {
    padding: 0.4rem 0.7rem;
    border: 1px solid var(--color-primary);
    border-radius: 2px;
    background: var(--color-primary);
    color: var(--color-primary-content);
    font-size: 0.7rem;
    cursor: pointer;
    white-space: nowrap;
  }
  .lookup-form button:hover {
    background: color-mix(in srgb, var(--color-primary) 85%, var(--color-base-content));
  }
  .lookup-form button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .lookup-error {
    margin: 0.7rem 0 0;
    padding: 0.4rem 0.55rem;
    border: 1px solid color-mix(in srgb, var(--color-error) 28%, transparent);
    border-radius: 2px;
    color: var(--color-error);
    background: color-mix(in srgb, var(--color-error) 7%, transparent);
    font-size: 0.7rem;
  }
  .lookup-notice {
    margin: 0 0 0.55rem;
    padding: 0.4rem 0.55rem;
    border: 1px solid color-mix(in srgb, var(--color-success) 28%, transparent);
    border-radius: 2px;
    color: var(--color-success);
    background: color-mix(in srgb, var(--color-success) 7%, transparent);
    font-size: 0.7rem;
  }
  .lookup-note {
    margin: 0.7rem 0 0;
    padding: 0.4rem 0.55rem;
    border: 1px solid color-mix(in srgb, var(--color-warning) 25%, transparent);
    border-radius: 2px;
    color: var(--color-warning);
    background: color-mix(in srgb, var(--color-warning) 6%, transparent);
    font-size: 0.7rem;
  }
  .lookup-preview {
    margin-top: 0.9rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--bib-rule);
  }
  .lookup-batch-summary {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem 0.9rem;
    margin-bottom: 0.55rem;
    font-size: 0.64rem;
  }
  .lookup-ready-count {
    color: var(--color-success);
  }
  .lookup-skipped-count {
    color: var(--color-warning);
  }
  .lookup-list {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
    max-height: min(28rem, 55vh);
    overflow: auto;
    padding-right: 0.25rem;
  }
  .lookup-item {
    padding-left: 0.65rem;
    border-left: 2px solid var(--tone, var(--bib-accent));
  }
  .lookup-item + .lookup-item {
    padding-top: 0.65rem;
    border-top: 1px solid var(--bib-rule-soft);
  }
  .lookup-bibtex summary {
    margin-top: 0.35rem;
    color: var(--color-secondary);
    font-size: 0.62rem;
    cursor: pointer;
  }
  .lookup-bibtex pre {
    margin-top: 0.35rem;
  }
  .lookup-failures {
    margin-top: 0.75rem;
    padding: 0.55rem 0.65rem;
    border: 1px solid color-mix(in srgb, var(--color-warning) 25%, transparent);
    border-radius: 2px;
    color: var(--color-warning);
    background: color-mix(in srgb, var(--color-warning) 6%, transparent);
    font-size: 0.68rem;
    line-height: 1.45;
  }
  .lookup-failures p {
    margin: 0.15rem 0 0;
  }
  .lookup-failures-title {
    margin: 0;
    font-weight: 600;
  }
  .lookup-failures code {
    font-family: var(--code-font, monospace);
    font-size: 0.64rem;
  }
  .lookup-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem 0.8rem;
    color: var(--muted);
    font-size: 0.58rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .lookup-meta-type {
    color: var(--tone, var(--bib-accent));
  }
  .lookup-meta-year {
    color: var(--color-secondary);
  }
  .lookup-meta-id {
    color: var(--muted);
  }
  .lookup-meta span + span::before {
    content: '·';
    margin-right: 0.6rem;
    color: var(--bib-rule);
  }
  .lookup-preview h3 {
    margin: 0.35rem 0 0.25rem;
    font-family: var(--bib-serif);
    font-size: 1.1rem;
    font-weight: 600;
    line-height: 1.3;
  }
  .lookup-authors,
  .lookup-venue {
    margin: 0;
    color: var(--muted);
    font-size: 0.72rem;
    line-height: 1.4;
  }
  .lookup-venue {
    font-style: italic;
  }
  .lookup-key {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    margin-top: 0.55rem;
    color: var(--muted);
    font-size: 0.62rem;
  }
  .lookup-key span {
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .lookup-key code {
    color: var(--color-info);
    font-family: var(--code-font, monospace);
    font-size: 0.7rem;
  }
  .lookup-item-actions {
    display: flex;
    gap: 0.4rem;
    justify-content: flex-end;
    margin-top: 0.45rem;
    flex-wrap: wrap;
  }
  .lookup-item-add,
  .lookup-item-download {
    padding: 0.28rem 0.55rem;
    border-radius: 2px;
    font-size: 0.64rem;
    cursor: pointer;
  }
  .lookup-item-add {
    border: 1px solid color-mix(in srgb, var(--color-success) 55%, var(--bib-rule));
    background: color-mix(in srgb, var(--color-success) 8%, transparent);
    color: var(--color-success);
  }
  .lookup-item-add:hover {
    background: color-mix(in srgb, var(--color-success) 16%, transparent);
  }
  .lookup-item-download {
    border: 1px solid color-mix(in srgb, var(--color-info) 55%, var(--bib-rule));
    background: color-mix(in srgb, var(--color-info) 8%, transparent);
    color: var(--color-info);
  }
  .lookup-item-download:hover {
    background: color-mix(in srgb, var(--color-info) 16%, transparent);
  }
  .lookup-item-add:disabled,
  .lookup-item-download:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .lookup-preview pre {
    max-height: 14rem;
    overflow: auto;
    margin: 0.55rem 0 0;
    padding: 0.6rem 0.7rem;
    border-radius: 2px;
    background: color-mix(in srgb, var(--color-base-200) 60%, transparent);
    font-family: var(--code-font, monospace);
    font-size: 0.62rem;
    line-height: 1.45;
    white-space: pre-wrap;
  }
  .lookup-actions {
    display: flex;
    gap: 0.4rem;
    margin-top: 0.75rem;
    flex-wrap: wrap;
  }
  .lookup-actions button {
    padding: 0.35rem 0.6rem;
    border: 1px solid var(--bib-rule);
    border-radius: 2px;
    background: transparent;
    color: var(--muted);
    font-size: 0.68rem;
    cursor: pointer;
  }
  .lookup-actions button:hover {
    color: var(--color-base-content);
    background: color-mix(in srgb, var(--color-base-200) 45%, transparent);
  }
  .lookup-add {
    border-color: var(--color-success);
    background: var(--color-success);
    color: var(--color-base-100);
  }
  .lookup-add:hover {
    background: color-mix(in srgb, var(--color-success) 85%, var(--color-base-content));
    color: var(--color-base-100);
  }
  .lookup-download-all {
    border-color: color-mix(in srgb, var(--color-info) 60%, var(--bib-rule));
    background: color-mix(in srgb, var(--color-info) 10%, transparent);
    color: var(--color-info);
  }
  .lookup-download-all:hover {
    background: color-mix(in srgb, var(--color-info) 18%, transparent);
    color: var(--color-info);
  }
  .lookup-actions button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .lookup-example {
    margin: 0.8rem 0 0;
    color: var(--muted);
    font-size: 0.64rem;
  }
  .lookup-example code {
    color: var(--color-base-content);
    font-family: var(--code-font, monospace);
    font-size: 0.63rem;
  }
  @media (max-width: 760px) {
    .lookup-layer {
      padding-top: 4vh;
    }
    .lookup-form {
      flex-direction: column;
    }
  }
  .graph-menu {
    position: fixed;
    z-index: 80;
    min-width: 12.5rem;
    padding: 0.35rem;
    border: 1px solid var(--bib-rule);
    border-radius: 3px;
    background: var(--color-base-100);
    box-shadow: 0 10px 28px #0006;
  }
  .graph-menu-title {
    display: block;
    padding: 0.15rem 0.45rem 0.3rem;
    color: var(--muted);
    font-size: 0.56rem;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .graph-menu button {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    width: 100%;
    padding: 0.32rem 0.45rem;
    border: 0;
    border-radius: 2px;
    background: transparent;
    color: var(--color-base-content);
    font-size: 0.7rem;
    text-align: left;
    cursor: pointer;
  }
  .graph-menu button:hover {
    background: var(--bib-accent-soft);
  }
  .menu-check {
    display: inline-block;
    width: 0.8rem;
    color: var(--bib-accent);
    font-size: 0.66rem;
  }
  .menu-separator {
    height: 1px;
    margin: 0.25rem 0;
    background: var(--bib-rule-soft);
  }
  .bib-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    min-height: 20rem;
    padding: 2rem;
    text-align: center;
    color: var(--muted);
  }
  .bib-empty h2 {
    margin: 0;
    color: var(--color-base-content);
    font-family: var(--bib-serif);
    font-weight: 600;
  }
  .bib-empty pre {
    max-width: 44rem;
    max-height: 16rem;
    overflow: auto;
    padding: 0.8rem;
    border-radius: 2px;
    background: var(--color-base-200);
    font-family: var(--code-font, monospace);
    font-size: 0.65rem;
    text-align: left;
    white-space: pre-wrap;
  }
  @media (max-width: 1050px) {
    .timeline-layout {
      grid-template-columns: 1fr;
      height: auto;
    }
    .bib-stage {
      overflow: auto;
    }
    .timeline-main,
    .timeline-detail {
      max-height: none;
      overflow: visible;
    }
  }
  @media (max-width: 760px) {
    .bib-hero,
    .bib-toolbar {
      padding-left: 0.9rem;
      padding-right: 0.9rem;
    }
    .bib-stage {
      padding: 0 0.9rem 1rem;
    }
    .bib-search input {
      width: 100%;
    }
    .bib-tools {
      width: 100%;
    }
    .bib-search {
      flex: 1;
    }
    .timeline::before {
      left: 3.225rem;
    }
    .timeline-group {
      grid-template-columns: 3rem minmax(0, 1fr);
      gap: 0.6rem;
    }
    .timeline-year strong {
      font-size: 1.1rem;
    }
  }
</style>

<script lang="ts">
  import Explorer from './Explorer.svelte';
  import { listDirectory } from '../lib/directories';
  import { ChevronRight, ChevronDown, Folder, FileText, File } from '@lucide/svelte';
  import type { Entry, Source } from '../lib/types';
  import { isDocument, isMarkdown } from '../lib/paths';
  import { traceStartupPaint } from '../lib/startup-trace';
  import { prewarmDocumentParser } from '../render/client';
  let {
    source,
    path,
    revision,
    active,
    onopen,
    depth = 0,
  }: {
    source: Source;
    path: string;
    revision: number;
    active: string;
    onopen: (path: string) => void;
    depth?: number;
  } = $props();
  let entries = $state<Entry[]>([]);
  let expanded = $state<string[]>([]);
  let error = $state('');
  let loading = $state(true);
  let limit = $state(200);
  let listedSource: Source | undefined;
  let listedPath: string | undefined;
  function prepareDocument(entry: Entry) {
    if (!entry.directory && isMarkdown(entry.path)) prewarmDocumentParser();
  }
  $effect(() => {
    const current = source;
    const directory = path;
    void revision;
    if (current !== listedSource || directory !== listedPath) {
      entries = [];
      expanded = [];
      limit = 200;
      loading = true;
      error = '';
      listedSource = current;
      listedPath = directory;
    }
    let cancelled = false;
    listDirectory(current, directory)
      .then((value) => {
        if (!cancelled) {
          entries = value;
          error = '';
          loading = false;
          if (depth === 0) traceStartupPaint('folder');
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          error = String(reason);
          loading = false;
        }
      });
    return () => {
      cancelled = true;
    };
  });
</script>

{#if loading}<p class="tree-note" role="status">Loading folder…</p>{/if}
{#if error}<p class="tree-note error" role="alert">{error}</p>{/if}
<ul class="file-list">
  {#each entries.slice(0, limit) as entry (entry.path)}
    <li>
      <button
        class:active={active === entry.path}
        class:muted={!entry.directory && !isDocument(entry.path)}
        class="file-row"
        style:padding-left="{12 + depth * 16}px"
        disabled={!entry.directory && !isDocument(entry.path)}
        aria-expanded={entry.directory ? expanded.includes(entry.path) : undefined}
        onpointerenter={() => prepareDocument(entry)}
        onfocus={() => prepareDocument(entry)}
        onclick={() =>
          entry.directory
            ? (expanded = expanded.includes(entry.path)
                ? expanded.filter((p) => p !== entry.path)
                : [...expanded, entry.path])
            : onopen(entry.path)}
      >
        {#if entry.directory}{#if expanded.includes(entry.path)}<ChevronDown
              size={13}
            />{:else}<ChevronRight size={13} />{/if}<Folder size={16} />{:else}<span
            class="tree-spacer"
          ></span>{#if isDocument(entry.path)}<FileText size={16} />{:else}<File
              size={16}
            />{/if}{/if}
        <span>{entry.name}</span>
      </button>
      {#if entry.directory && expanded.includes(entry.path)}<Explorer
          {source}
          path={entry.path}
          {revision}
          {active}
          {onopen}
          depth={depth + 1}
        />{/if}
    </li>
  {/each}
</ul>
{#if entries.length > limit}<button
    class="btn btn-ghost btn-sm load-more"
    onclick={() => (limit += 200)}>Show 200 more ({entries.length - limit} remaining)</button
  >{/if}
{#if !loading && !error && entries.length === 0}<p class="tree-note">
    This directory is empty.
  </p>{/if}

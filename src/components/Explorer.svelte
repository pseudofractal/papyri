<script lang="ts">
  import Explorer from './Explorer.svelte';
  import RenameEntry from './RenameEntry.svelte';
  import FileIcon from './FileIcon.svelte';
  import { listDirectory } from '../lib/directories';
  import { ChevronRight, ChevronDown } from '@lucide/svelte';
  import type { Entry, Source } from '../lib/types';
  import { displayPathMessage, isDocument, isMarkdown } from '../lib/paths';
  import { traceStartupPaint } from '../lib/startup-trace';
  import { prewarmDocumentParser } from '../render/client';
  let {
    source,
    path,
    revision,
    active,
    onopen,
    expanded,
    workingDirectory,
    ontoggle,
    renamePath,
    renameBusy,
    onrename,
    oncancelrename,
    onbeginrename,
    selected,
    onselect,
    depth = 0,
  }: {
    source: Source;
    path: string;
    revision: number;
    active: string;
    onopen: (path: string) => void;
    expanded: string[];
    workingDirectory: string;
    ontoggle: (path: string) => void;
    renamePath: string;
    renameBusy: boolean;
    onrename: (path: string, name: string) => void;
    oncancelrename: () => void;
    onbeginrename: (path: string) => void;
    selected: string;
    onselect: (path: string) => void;
    depth?: number;
  } = $props();
  let entries = $state<Entry[]>([]);
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
{#if error}<p class="tree-note error" role="alert">{displayPathMessage(error)}</p>{/if}
<ul class="file-list" style:--tree-depth={depth}>
  {#each entries.slice(0, limit) as entry (entry.path)}
    <li>
      {#if renamePath === entry.path}
        <RenameEntry
          path={entry.path}
          {depth}
          busy={renameBusy}
          {onrename}
          oncancel={oncancelrename}
        />
      {:else}
        <button
          class:active={active === entry.path}
          class:working={entry.directory && workingDirectory === entry.path}
          class:selected={selected === entry.path}
          class:muted={!entry.directory && !isDocument(entry.path)}
          class="file-row"
          data-path={entry.path}
          data-directory={entry.directory ? 'true' : 'false'}
          data-document={entry.directory ? 'folder' : isDocument(entry.path) ? 'document' : 'other'}
          style:padding-left="{12 + depth * 16}px"
          aria-expanded={entry.directory ? expanded.includes(entry.path) : undefined}
          onpointerenter={() => prepareDocument(entry)}
          onfocus={() => prepareDocument(entry)}
          onclick={() => {
            onselect(entry.path);
            if (entry.directory) ontoggle(entry.path);
            else if (isDocument(entry.path)) onopen(entry.path);
          }}
          ondblclick={() => {
            if (!entry.directory && source.rename) onbeginrename(entry.path);
          }}
          onkeydown={(event) => {
            if (event.key === 'F2' && !entry.directory && source.rename) {
              event.preventDefault();
              onbeginrename(entry.path);
            }
          }}
        >
          {#if entry.directory}{#if expanded.includes(entry.path)}<ChevronDown
                size={13}
              />{:else}<ChevronRight size={13} />{/if}{:else}<span class="tree-spacer"></span>{/if}
          <FileIcon
            name={entry.name}
            directory={entry.directory}
            expanded={expanded.includes(entry.path)}
          />
          <span>{entry.name}</span>
        </button>
      {/if}
      {#if entry.directory && expanded.includes(entry.path)}<Explorer
          {source}
          path={entry.path}
          {revision}
          {active}
          {onopen}
          {expanded}
          {workingDirectory}
          {ontoggle}
          {renamePath}
          {renameBusy}
          {onrename}
          {oncancelrename}
          {onbeginrename}
          {selected}
          {onselect}
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

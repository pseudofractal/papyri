<script lang="ts">
  import { Check, Copy, ExternalLink, FileCode2, Quote } from '@lucide/svelte';
  import { formatCitation, type BibliographyEntry, type CitationStyle } from '../lib/bibliography';

  let {
    entry,
    citedCount = 0,
    tone = 'other',
    oncopy,
    onopen,
  }: {
    entry: BibliographyEntry;
    citedCount?: number;
    tone?: string;
    oncopy: (text: string) => void;
    onopen?: (url: string) => void;
  } = $props();

  let copied = $state('');
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  let citationStyle = $state<CitationStyle>('apa');

  const doiUrl = $derived(entry.doi ? `https://doi.org/${entry.doi}` : entry.url);
  const metadata = $derived(
    [
      entry.container && { label: 'Venue', value: entry.container },
      (entry.volume || entry.issue || entry.pages) && {
        label: 'Volume / pages',
        value: [
          entry.volume,
          entry.issue ? `(${entry.issue})` : '',
          entry.pages ? `· ${entry.pages}` : '',
        ]
          .filter(Boolean)
          .join(' '),
      },
      entry.publisher && { label: 'Publisher', value: entry.publisher },
      entry.place && { label: 'Place', value: entry.place },
      entry.doi && { label: 'DOI', value: entry.doi },
      entry.url && { label: 'URL', value: entry.url },
      entry.isbn && { label: 'ISBN', value: entry.isbn },
      entry.issn && { label: 'ISSN', value: entry.issn },
      entry.language && { label: 'Language', value: entry.language },
    ].filter((item): item is { label: string; value: string } => Boolean(item)),
  );

  function copy(value: string, label: string) {
    oncopy(value);
    copied = label;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copied = ''), 1600);
  }
  function openLink() {
    if (!doiUrl) return;
    if (onopen) onopen(doiUrl);
    else window.open(doiUrl, '_blank', 'noopener');
  }
</script>

<aside class="bib-detail" aria-label="Reference details">
  <header class="detail-header">
    <div class="detail-eyebrow">
      <span class="type-chip" style={`color: var(--bib-tone-${tone})`}>{entry.typeLabel}</span>
      <span class="detail-year">{entry.year ?? 'Undated'}</span>
      {#if citedCount > 0}<span class="cited-chip">Cited {citedCount}×</span>{/if}
    </div>
    <h2>{entry.title || 'Untitled reference'}</h2>
    {#if entry.authors.length}<p class="detail-authors">{entry.authors.join(' · ')}</p>{/if}
    {#if entry.container}<p class="detail-venue">{entry.container}</p>{/if}
    <code class="citation-key" title="Citation key">{entry.key}</code>
  </header>

  <div class="detail-actions">
    <button
      class="detail-action primary"
      onclick={() => copy(formatCitation(entry, citationStyle), 'citation')}
    >
      {#if copied === 'citation'}<Check size={14} /> Copied{:else}<Quote size={14} /> Copy citation{/if}
    </button>
    <button class="detail-action" onclick={() => copy(formatCitation(entry, 'latex'), 'cite')}>
      {#if copied === 'cite'}<Check size={14} /> Copied{:else}<Copy size={14} /> \cite{/if}
    </button>
    <button class="detail-action" onclick={() => copy(formatCitation(entry, 'bibtex'), 'bibtex')}>
      {#if copied === 'bibtex'}<Check size={14} /> Copied{:else}<FileCode2 size={14} /> BibTeX{/if}
    </button>
    {#if doiUrl}
      <button class="detail-action" onclick={openLink} title="Open DOI or URL">
        <ExternalLink size={14} /> Open
      </button>
    {/if}
  </div>

  <div class="citation-style-row">
    <span>Format as</span>
    <select bind:value={citationStyle} aria-label="Citation style for copying">
      <option value="apa">APA 7</option>
      <option value="nature">Nature</option>
      <option value="vancouver">Vancouver</option>
      <option value="chicago">Chicago</option>
      <option value="latex">LaTeX \cite</option>
      <option value="bibtex">BibTeX</option>
    </select>
  </div>

  {#if metadata.length}
    <dl class="detail-metadata">
      {#each metadata as item (item.label)}
        <div>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      {/each}
    </dl>
  {/if}

  {#if entry.abstract}
    <section class="detail-section">
      <h3>Abstract</h3>
      <p class="abstract-text">{entry.abstract}</p>
    </section>
  {/if}

  {#if entry.keywords.length}
    <section class="detail-section">
      <h3>Keywords</h3>
      <div class="keyword-list">
        {#each entry.keywords as keyword (keyword)}
          <span class="keyword-chip">{keyword}</span>
        {/each}
      </div>
    </section>
  {/if}

  {#if entry.note}
    <section class="detail-section">
      <h3>Note</h3>
      <p class="note-text">{entry.note}</p>
    </section>
  {/if}

  {#if entry.warnings.length}
    <section class="detail-section detail-warnings">
      <h3>Metadata notes</h3>
      <ul>
        {#each entry.warnings as warning (warning)}<li>{warning}</li>{/each}
      </ul>
    </section>
  {/if}

  <details class="raw-entry">
    <summary>Raw entry</summary>
    <pre>{entry.raw}</pre>
  </details>
</aside>

<style>
  .bib-detail {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    min-width: 0;
    padding: 1rem 1.1rem 1.5rem;
    background: transparent;
    border: 1px solid var(--bib-rule, var(--line));
    border-radius: 3px;
    overflow: auto;
  }
  .detail-header {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  .detail-eyebrow {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.55rem;
  }
  .type-chip,
  .cited-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    width: fit-content;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: none;
    font-size: 0.58rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .type-chip {
    color: var(--bib-accent, var(--color-secondary));
  }
  .cited-chip {
    color: var(--color-success);
  }
  .detail-year {
    color: var(--muted);
    font-size: 0.68rem;
    font-variant-numeric: tabular-nums;
  }
  h2 {
    margin: 0;
    font-family: var(--bib-serif, 'Iowan Old Style', 'Palatino Linotype', Georgia, serif);
    font-size: 1.2rem;
    font-weight: 600;
    line-height: 1.3;
    letter-spacing: -0.01em;
    text-wrap: balance;
  }
  .detail-authors {
    margin: 0;
    color: color-mix(in srgb, var(--color-base-content) 84%, transparent);
    font-size: 0.82rem;
    line-height: 1.45;
  }
  .detail-venue {
    margin: 0;
    color: var(--muted);
    font-size: 0.78rem;
    font-style: italic;
  }
  .citation-key {
    width: fit-content;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    padding: 0.15rem 0.35rem;
    border-radius: 2px;
    background: color-mix(in srgb, var(--color-base-200) 70%, transparent);
    color: var(--muted);
    font-family: var(--code-font, monospace);
    font-size: 0.68rem;
  }
  .detail-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }
  .detail-action {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.33rem 0.55rem;
    border: 1px solid var(--bib-rule, var(--line));
    border-radius: 2px;
    background: transparent;
    color: var(--color-base-content);
    font-size: 0.7rem;
    cursor: pointer;
  }
  .detail-action:hover {
    border-color: var(--bib-accent, var(--color-primary));
    background: var(--bib-accent-soft, color-mix(in srgb, var(--color-primary) 10%, transparent));
  }
  .detail-action.primary {
    border-color: color-mix(
      in srgb,
      var(--bib-accent, var(--color-primary)) 60%,
      var(--bib-rule, var(--line))
    );
    background: var(--bib-accent-soft, color-mix(in srgb, var(--color-primary) 12%, transparent));
  }
  .citation-style-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--muted);
    font-size: 0.66rem;
  }
  .citation-style-row select {
    padding: 0.2rem 0.3rem;
    border: 1px solid var(--bib-rule, var(--line));
    border-radius: 2px;
    background: transparent;
    color: var(--color-base-content);
    font-size: 0.68rem;
  }
  .detail-metadata {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.5rem 1rem;
    margin: 0;
    padding: 0.65rem 0;
    border-top: 1px solid var(--bib-rule, var(--line));
    border-bottom: 1px solid var(--bib-rule, var(--line));
  }
  .detail-metadata div {
    min-width: 0;
  }
  .detail-metadata dt {
    color: var(--muted);
    font-size: 0.58rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .detail-metadata dd {
    margin: 0.15rem 0 0;
    overflow-wrap: anywhere;
    font-size: 0.76rem;
    line-height: 1.35;
  }
  .detail-section h3 {
    margin: 0 0 0.35rem;
    color: var(--muted);
    font-size: 0.58rem;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .abstract-text,
  .note-text {
    margin: 0;
    color: color-mix(in srgb, var(--color-base-content) 86%, transparent);
    font-family: var(--bib-serif, 'Iowan Old Style', 'Palatino Linotype', Georgia, serif);
    font-size: 0.85rem;
    line-height: 1.55;
    text-wrap: pretty;
  }
  .keyword-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0;
  }
  .keyword-chip {
    padding: 0;
    border: 0;
    border-radius: 0;
    background: none;
    color: var(--muted);
    font-size: 0.68rem;
  }
  .keyword-chip + .keyword-chip::before {
    content: '·';
    margin: 0 0.35rem;
    color: var(--bib-rule, var(--line));
  }
  .detail-warnings ul {
    margin: 0;
    padding-left: 1rem;
    color: var(--color-warning);
    font-size: 0.72rem;
    line-height: 1.5;
  }
  .raw-entry {
    border-top: 1px solid var(--bib-rule, var(--line));
    padding-top: 0.55rem;
  }
  .raw-entry summary {
    color: var(--muted);
    font-size: 0.68rem;
    cursor: pointer;
  }
  .raw-entry pre {
    max-height: 16rem;
    overflow: auto;
    margin: 0.55rem 0 0;
    padding: 0.65rem;
    border-radius: 2px;
    background: color-mix(in srgb, var(--color-base-200) 60%, transparent);
    font-family: var(--code-font, monospace);
    font-size: 0.64rem;
    line-height: 1.45;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  @media (max-width: 900px) {
    .detail-metadata {
      grid-template-columns: 1fr;
    }
  }
</style>

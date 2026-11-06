<script lang="ts">
  import { onMount } from 'svelte';
  import { basicSetup } from 'codemirror';
  import { EditorState, StateEffect } from '@codemirror/state';
  import { EditorView, keymap } from '@codemirror/view';
  import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
  import { tags } from '@lezer/highlight';
  import { completeFromList, snippetCompletion, startCompletion } from '@codemirror/autocomplete';
  import { markdown } from '@codemirror/lang-markdown';
  import { stex } from '@codemirror/legacy-modes/mode/stex';
  import { typst_lezer } from 'codemirror-lang-typst/lezer';
  import { connectEditorLanguageServer, fileUri, type EditorLanguage } from '../lib/editor-lsp';
  import { dirname } from '../lib/paths';
  import { native } from '../lib/sources';

  let {
    path,
    language,
    initialText,
    onchange,
    onsave,
  }: {
    path: string;
    language: EditorLanguage;
    initialText: string;
    onchange: (text: string) => void;
    onsave: () => void;
  } = $props();

  let container: HTMLDivElement;
  let showCompletions = () => {};
  let serverStatus = $state(
    native ? 'Connecting language server…' : 'Language server requires the Linux app.',
  );
  const highlighting = HighlightStyle.define([
    { tag: [tags.keyword, tags.heading, tags.tagName], color: 'var(--color-primary)' },
    { tag: [tags.string, tags.special(tags.string)], color: 'var(--color-accent)' },
    { tag: [tags.number, tags.bool, tags.atom, tags.link], color: 'var(--color-secondary)' },
    { tag: tags.comment, color: 'var(--muted)', fontStyle: 'italic' },
    { tag: tags.invalid, color: 'var(--color-error)' },
  ]);

  const snippets = {
    markdown: [
      snippetCompletion('## ${heading}\n\n${}', {
        label: 'heading',
        type: 'snippet',
        detail: 'Section',
      }),
      snippetCompletion('```${language}\n${}\n```', {
        label: 'codeblock',
        type: 'snippet',
        detail: 'Code block',
      }),
      snippetCompletion('[${text}](${url})', { label: 'link', type: 'snippet', detail: 'Link' }),
    ],
    typst: [
      snippetCompletion('= ${heading}\n\n${}', {
        label: 'heading',
        type: 'snippet',
        detail: 'Section',
      }),
      snippetCompletion('#figure(\n  ${body},\n  caption: [${caption}],\n)', {
        label: 'figure',
        type: 'snippet',
        detail: 'Figure',
      }),
      snippetCompletion('$ ${equation} $', {
        label: 'equation',
        type: 'snippet',
        detail: 'Equation',
      }),
    ],
    latex: [
      snippetCompletion('\\section{${title}}\n${}', {
        label: 'section',
        type: 'snippet',
        detail: 'Section',
      }),
      snippetCompletion('\\begin{equation}\n  ${equation}\n\\end{equation}', {
        label: 'equation',
        type: 'snippet',
        detail: 'Equation',
      }),
      snippetCompletion('\\begin{figure}\n  ${body}\n  \\caption{${caption}}\n\\end{figure}', {
        label: 'figure',
        type: 'snippet',
        detail: 'Figure',
      }),
    ],
  };

  onMount(() => {
    let disposed = false;
    let closeServer: (() => Promise<void>) | undefined;
    const snippetSource = completeFromList(snippets[language]);
    const languageSupport =
      language === 'markdown'
        ? markdown()
        : language === 'typst'
          ? typst_lezer()
          : StreamLanguage.define(stex);
    const view = new EditorView({
      parent: container,
      state: EditorState.create({
        doc: initialText,
        extensions: [
          keymap.of([
            {
              key: 'Mod-s',
              run: () => {
                onsave();
                return true;
              },
            },
          ]),
          basicSetup,
          EditorView.lineWrapping,
          languageSupport,
          syntaxHighlighting(highlighting),
          EditorState.languageData.of(() => [{ autocomplete: snippetSource }]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onchange(update.state.doc.toString());
          }),
          EditorView.contentAttributes.of({ 'aria-label': 'Source editor', spellcheck: 'false' }),
        ],
      }),
    });
    showCompletions = () => {
      view.focus();
      startCompletion(view);
    };
    if (native) {
      void connectEditorLanguageServer(language, dirname(path), (message) => {
        if (!disposed) serverStatus = message;
      })
        .then((connection) => {
          if (disposed) {
            void connection.close().catch((error: unknown) => console.error(error));
            return;
          }
          closeServer = connection.close;
          view.dispatch({
            effects: StateEffect.appendConfig.of(connection.client.plugin(fileUri(path), language)),
          });
          void connection.client.initializing
            .then(() => {
              if (!disposed) serverStatus = 'Language server connected';
            })
            .catch((error: unknown) => {
              if (!disposed) serverStatus = String(error);
            });
        })
        .catch((error: unknown) => {
          if (!disposed) serverStatus = String(error);
        });
    }
    return () => {
      disposed = true;
      view.destroy();
      if (closeServer) void closeServer().catch((error: unknown) => console.error(error));
    };
  });
</script>

<div class="source-editor" aria-label="Source editing">
  <div class="editor-content" bind:this={container}></div>
  <button
    class="btn btn-ghost btn-xs"
    onclick={() => showCompletions()}
    title="Complete source (Ctrl Space)">Complete source</button
  >
  <div class="editor-status" role="status">{serverStatus}</div>
</div>

<style>
  .source-editor {
    display: flex;
    flex: 1;
    min-width: 0;
    min-height: 0;
    flex-direction: column;
  }
  .editor-content {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .editor-content :global(.cm-editor) {
    height: 100%;
    font-family: var(--code-font, monospace);
    background: var(--color-base-100);
    color: var(--color-base-content);
  }
  .editor-content :global(.cm-scroller) {
    overflow: auto;
  }
  .editor-content :global(.cm-gutters) {
    background: var(--color-base-200);
    color: var(--muted);
    border-color: var(--line);
  }
  .editor-content :global(.cm-activeLine),
  .editor-content :global(.cm-activeLineGutter) {
    background: var(--color-neutral);
  }
  .editor-content :global(.cm-cursor) {
    border-left-color: var(--color-base-content);
  }
  .editor-content :global(.cm-content) {
    caret-color: var(--color-base-content);
  }
  .editor-status {
    padding: 4px 12px;
    font-size: 0.75rem;
    opacity: 0.7;
  }
</style>

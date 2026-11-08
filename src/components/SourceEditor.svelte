<script lang="ts">
  import { onMount } from 'svelte';
  import { basicSetup } from 'codemirror';
  import { Compartment, EditorState, StateEffect } from '@codemirror/state';
  import { EditorView, keymap, tooltips } from '@codemirror/view';
  import {
    HighlightStyle,
    LanguageSupport,
    StreamLanguage,
    syntaxHighlighting,
  } from '@codemirror/language';
  import { tags } from '@lezer/highlight';
  import {
    autocompletion,
    acceptCompletion,
    completeFromList,
    snippetCompletion,
    type CompletionSource,
  } from '@codemirror/autocomplete';
  import '@vscode/codicons/dist/codicon.css';
  import { markdown } from '@codemirror/lang-markdown';
  import { stex } from '@codemirror/legacy-modes/mode/stex';
  import {
    typst_lezer,
    typstTags,
    typstLezerIndentService,
    typstLezerListKeymap,
    typstLezerFoldService,
    typstLezerLinter,
  } from 'codemirror-lang-typst/lezer';
  import { connectEditorLanguageServer, fileUri, type EditorLanguage } from '../lib/editor-lsp';
  import { dirname } from '../lib/paths';
  import { native } from '../lib/sources';

  let {
    path,
    language,
    initialText,
    serverPath,
    onchange,
    onsave,
    onposition,
  }: {
    path: string;
    language: EditorLanguage;
    initialText: string;
    serverPath: string;
    onchange: (text: string) => void;
    onsave: () => void;
    onposition?: (line: number, character: number) => void;
  } = $props();

  let container: HTMLDivElement;
  let editorView: EditorView | undefined;
  let navigating = false;

  /** Reveal a zero-based UTF-16 source position. */
  export function reveal(line: number, character: number) {
    if (!editorView) return;
    const document = editorView.state.doc;
    const target = document.line(Math.min(document.lines, Math.max(1, line + 1)));
    const offset = Math.min(target.to, target.from + Math.max(0, character));
    navigating = true;
    editorView.dispatch({
      selection: { anchor: offset },
      effects: EditorView.scrollIntoView(offset, { y: 'center' }),
    });
    navigating = false;
    editorView.focus();
  }
  let serverStatus = $state(
    native ? 'Connecting language server…' : 'Language server requires the Linux app.',
  );
  const highlighting = HighlightStyle.define([
    { tag: [tags.keyword, tags.modifier], color: 'var(--editor-syntax-mauve)' },
    { tag: [tags.string, tags.special(tags.string)], color: 'var(--editor-syntax-green)' },
    { tag: [tags.number, tags.bool, tags.atom, tags.null], color: 'var(--editor-syntax-peach)' },
    {
      tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
      color: 'var(--editor-syntax-blue)',
    },
    { tag: [tags.typeName, tags.className, tags.namespace], color: 'var(--editor-syntax-yellow)' },
    { tag: [tags.propertyName, tags.attributeName], color: 'var(--editor-syntax-lavender)' },
    { tag: [tags.operator, tags.punctuation], color: 'var(--editor-syntax-sky)' },
    { tag: [typstTags.interpolated, typstTags.listMarker], color: 'var(--editor-syntax-mauve)' },
    { tag: [typstTags.mathDelimiter, tags.escape], color: 'var(--editor-syntax-sky)' },
    { tag: [tags.heading, tags.tagName], color: 'var(--editor-syntax-blue)', fontWeight: 'bold' },
    {
      tag: [tags.link, tags.url],
      color: 'var(--editor-syntax-rosewater)',
      textDecoration: 'underline',
    },
    { tag: tags.strong, fontWeight: 'bold' },
    { tag: tags.emphasis, fontStyle: 'italic' },
    { tag: tags.comment, color: 'var(--editor-syntax-comment)', fontStyle: 'italic' },
    { tag: tags.invalid, color: 'var(--editor-syntax-red)' },
  ]);

  const completionIcons: Record<string, string> = {
    method: 'method',
    function: 'method',
    class: 'class',
    interface: 'interface',
    namespace: 'namespace',
    property: 'property',
    variable: 'variable',
    constant: 'constant',
    type: 'type-parameter',
    keyword: 'keyword',
    text: 'text',
    snippet: 'snippet',
  };

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

  function scrollCompletionDetails(view: EditorView, direction: number): boolean {
    const body = view.dom.querySelector<HTMLElement>('.completion-detail-scroll');
    if (!body || body.scrollHeight <= body.clientHeight) return false;
    body.scrollTop += direction * Math.max(1, body.clientHeight * 0.8);
    return true;
  }

  onMount(() => {
    let disposed = false;
    let closeServer: (() => Promise<void>) | undefined;
    function reportPosition(view: EditorView) {
      const position = view.state.selection.main.head;
      const line = view.state.doc.lineAt(position);
      onposition?.(line.number - 1, position - line.from);
    }
    const snippetSource = completeFromList(snippets[language]);
    const completionSettings = new Compartment();
    const languageSupport =
      language === 'markdown'
        ? markdown()
        : language === 'typst'
          ? new LanguageSupport(typst_lezer().language, [
              typstLezerIndentService,
              typstLezerListKeymap,
              typstLezerFoldService,
              typstLezerLinter,
            ])
          : StreamLanguage.define(stex);
    function completionExtensions(sources?: CompletionSource[]) {
      return autocompletion({
        override: sources,
        icons: false,
        positionInfo(view, list, _option, _info, space) {
          const scale = view.dom.offsetWidth
            ? view.dom.getBoundingClientRect().width / view.dom.offsetWidth || 1
            : 1;
          const cursor = view.coordsAtPos(view.state.selection.main.head);
          const above = !!cursor && list.bottom <= cursor.top;
          const available = Math.max(0, above ? list.top - space.top : space.bottom - list.bottom);
          const spaceFromLeft = space.right - list.left;
          const spaceFromRight = list.right - space.left;
          const alignLeft = spaceFromLeft >= Math.min(400 * scale, spaceFromRight);
          const availableWidth = Math.max(0, alignLeft ? spaceFromLeft : spaceFromRight);
          const maxHeight = Math.min(10 * view.defaultLineHeight, available / scale);
          return {
            style: `${above ? 'bottom: 100%' : 'top: 100%'}; ${alignLeft ? 'left: 0' : 'right: 0'}; width: min(25rem, ${availableWidth / scale}px); max-width: none; --completion-detail-height: ${maxHeight}px; max-height: var(--completion-detail-height)`,
            class: above ? 'completion-details-above' : 'completion-details-below',
          };
        },
        addToOptions: [
          {
            position: 20,
            render(completion) {
              const icon = document.createElement('span');
              const glyph = (completion as typeof completion & { symbolGlyph?: string })
                .symbolGlyph;
              if (glyph) {
                icon.className = 'completion-kind completion-symbol-icon';
                icon.textContent = glyph;
              } else {
                const kind = completion.type?.split(/\s+/)[0] ?? '';
                icon.className = `codicon codicon-symbol-${completionIcons[kind] ?? 'misc'} completion-kind`;
              }
              icon.setAttribute('aria-hidden', 'true');
              return icon;
            },
          },
        ],
      });
    }
    const view = new EditorView({
      parent: container,
      state: EditorState.create({
        doc: initialText,
        extensions: [
          keymap.of([
            { key: 'Tab', run: acceptCompletion },
            { key: 'Alt-PageDown', run: (editor) => scrollCompletionDetails(editor, 1) },
            { key: 'Alt-PageUp', run: (editor) => scrollCompletionDetails(editor, -1) },
            {
              key: 'Mod-s',
              run: () => {
                onsave();
                return true;
              },
            },
          ]),
          basicSetup,
          tooltips({
            tooltipSpace(editor) {
              const bounds = editor.scrollDOM.getBoundingClientRect();
              let bottom = Math.min(window.innerHeight, bounds.bottom);
              let top = Math.max(0, bounds.top);
              for (let parent = editor.dom.parentElement; parent; parent = parent.parentElement) {
                const overflow = getComputedStyle(parent).overflowY;
                if (overflow === 'visible') continue;
                const clip = parent.getBoundingClientRect();
                top = Math.max(top, clip.top);
                bottom = Math.min(bottom, clip.bottom);
              }
              if (container.classList.contains('show-completion-details')) {
                const cursor = editor.coordsAtPos(editor.state.selection.main.head);
                const list = editor.dom.querySelector<HTMLElement>('.cm-tooltip-autocomplete');
                const details = editor.dom.querySelector<HTMLElement>('.cm-completionInfo');
                if (cursor && list && details) {
                  const listHeight = list.getBoundingClientRect().height;
                  const detailHeight = Math.min(
                    details.scrollHeight,
                    10 * editor.defaultLineHeight,
                  );
                  const roomBelow = bottom - cursor.bottom;
                  const roomAbove = cursor.top - top;
                  if (
                    roomBelow < listHeight + detailHeight &&
                    roomAbove > roomBelow &&
                    roomAbove >= listHeight + editor.defaultLineHeight
                  ) {
                    bottom = cursor.bottom;
                  }
                }
              }
              return {
                left: Math.max(0, bounds.left),
                right: Math.min(window.innerWidth, bounds.right),
                top,
                bottom,
              };
            },
          }),
          completionSettings.of(completionExtensions()),
          EditorView.lineWrapping,
          languageSupport,
          syntaxHighlighting(highlighting),
          EditorState.languageData.of(() => [{ autocomplete: snippetSource }]),
          EditorView.domEventHandlers({
            pointerup(event, view) {
              if (
                event.button === 0 &&
                event.target instanceof Node &&
                view.contentDOM.contains(event.target) &&
                view.hasFocus &&
                !navigating
              )
                reportPosition(view);
              return false;
            },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onchange(update.state.doc.toString());
            if (update.selectionSet && !update.docChanged && !navigating && update.view.hasFocus) {
              reportPosition(update.view);
            }
          }),
          EditorView.contentAttributes.of({ 'aria-label': 'Source editor', spellcheck: 'false' }),
        ],
      }),
    });
    editorView = view;
    const updateControlKey = (event: KeyboardEvent) => {
      const held = event.key === 'Control' ? event.type === 'keydown' : event.ctrlKey;
      container.classList.toggle('show-completion-details', held);
      view.scrollDOM.dispatchEvent(new Event('scroll', { bubbles: true }));
    };
    const clearControlKey = () => container.classList.remove('show-completion-details');
    window.addEventListener('keydown', updateControlKey);
    window.addEventListener('keyup', updateControlKey);
    window.addEventListener('blur', clearControlKey);
    const resizeObserver = new ResizeObserver(() => {
      container.style.setProperty(
        '--completion-width',
        `${Math.max(0, container.clientWidth - 16)}px`,
      );
      view.requestMeasure();
    });
    resizeObserver.observe(container);
    if (native) {
      void connectEditorLanguageServer(language, dirname(path), serverPath, (message) => {
        if (!disposed) {
          serverStatus = message;
          view.dispatch({ effects: completionSettings.reconfigure(completionExtensions()) });
        }
      })
        .then((connection) => {
          if (disposed) {
            void connection.close().catch((error: unknown) => console.error(error));
            return;
          }
          closeServer = connection.close;
          view.dispatch({
            effects: [
              StateEffect.appendConfig.of(connection.client.plugin(fileUri(path), language)),
              completionSettings.reconfigure(
                completionExtensions([snippetSource, connection.completions]),
              ),
            ],
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
      window.removeEventListener('keydown', updateControlKey);
      window.removeEventListener('keyup', updateControlKey);
      window.removeEventListener('blur', clearControlKey);
      resizeObserver.disconnect();
      editorView = undefined;
      view.destroy();
      if (closeServer) void closeServer().catch((error: unknown) => console.error(error));
    };
  });
</script>

<div class="source-editor" aria-label="Source editing">
  <div class="editor-content" bind:this={container}></div>
  <div class="editor-status" role="status">{serverStatus}</div>
</div>

<style>
  .source-editor {
    --editor-syntax-mauve: #cba6f7;
    --editor-syntax-green: #a6e3a1;
    --editor-syntax-peach: #fab387;
    --editor-syntax-blue: #89b4fa;
    --editor-syntax-yellow: #f9e2af;
    --editor-syntax-lavender: #b4befe;
    --editor-syntax-sky: #89dceb;
    --editor-syntax-rosewater: #f5e0dc;
    --editor-syntax-comment: #9399b2;
    --editor-syntax-red: #f38ba8;
    display: flex;
    flex: 1;
    min-width: 0;
    min-height: 0;
    flex-direction: column;
  }
  :global([data-theme='latte']) .source-editor {
    --editor-syntax-mauve: #8839ef;
    --editor-syntax-green: #40a02b;
    --editor-syntax-peach: #fe640b;
    --editor-syntax-blue: #1e66f5;
    --editor-syntax-yellow: #df8e1d;
    --editor-syntax-lavender: #7287fd;
    --editor-syntax-sky: #04a5e5;
    --editor-syntax-rosewater: #dc8a78;
    --editor-syntax-comment: #6c6f85;
    --editor-syntax-red: #d20f39;
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
  .editor-content :global(.cm-tooltip) {
    color: var(--color-base-content);
    background: var(--color-base-200);
    border: 1px solid color-mix(in srgb, var(--color-base-content) 20%, transparent);
    border-radius: 4px;
    box-shadow: 0 8px 24px #0004;
  }
  .editor-content :global(.cm-tooltip-autocomplete > ul) {
    min-width: min(18rem, var(--completion-width, calc(100vw - 32px)));
    max-width: min(34rem, var(--completion-width, calc(100vw - 32px)));
    max-height: 16rem;
    padding: 2px 0;
    font-family: var(--code-font, monospace);
    font-size: 13px;
  }
  .editor-content :global(.cm-tooltip-autocomplete.cm-tooltip-above) {
    translate: 0 -4px;
  }
  .editor-content :global(.cm-tooltip-autocomplete.cm-tooltip-below) {
    translate: 0 4px;
  }
  .editor-content :global(.cm-tooltip-autocomplete > ul > li) {
    display: flex;
    align-items: center;
    min-width: 0;
    min-height: 25px;
    padding: 2px 8px;
    line-height: 1.4;
    color: var(--color-base-content);
  }
  .editor-content :global(.cm-tooltip-autocomplete > ul > li[aria-selected]) {
    color: var(--color-base-content);
    background: color-mix(in srgb, var(--color-primary) 22%, var(--color-base-200));
  }
  .editor-content :global(.cm-tooltip-autocomplete > ul > li[aria-selected])::after {
    content: '⌃';
    flex: 0 0 auto;
    margin-left: auto;
    padding: 0 4px;
    border: 1px solid currentColor;
    border-radius: 3px;
    color: var(--muted);
    opacity: 0.65;
    font: 11px var(--ui-font, system-ui, sans-serif);
  }
  .editor-content :global(.completion-kind) {
    display: inline-flex;
    flex: 0 0 20px;
    width: 20px;
    height: 20px;
    align-items: center;
    justify-content: center;
    padding: 0;
    margin-right: 6px;
    color: var(--color-primary);
    opacity: 1;
  }
  .editor-content :global(.completion-symbol-icon) {
    font-family: var(--ui-font, system-ui, sans-serif);
    font-size: 16px;
    color: var(--color-secondary);
  }
  .editor-content :global(.codicon-symbol-variable),
  .editor-content :global(.codicon-symbol-property) {
    color: var(--color-secondary);
  }
  .editor-content :global(.codicon-symbol-class),
  .editor-content :global(.codicon-symbol-interface),
  .editor-content :global(.codicon-symbol-type-parameter) {
    color: color-mix(in srgb, var(--color-warning) 55%, var(--color-base-content));
  }
  .editor-content :global(.codicon-symbol-snippet) {
    color: color-mix(in srgb, var(--color-accent) 55%, var(--color-base-content));
  }
  .editor-content :global(.cm-completionLabel) {
    flex: 0 0 auto;
    min-width: 0;
    max-width: 55%;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .editor-content :global(.cm-completionMatchedText) {
    color: inherit;
    font-weight: 700;
    text-decoration: none;
  }
  .editor-content :global(.cm-completionDetail) {
    flex: 1 1 0;
    min-width: 0;
    margin-left: 10px;
    overflow: hidden;
    color: var(--color-base-content);
    font-family: inherit;
    font-size: 12px;
    font-style: normal;
    text-overflow: ellipsis;
    text-align: left;
  }
  .editor-content :global(.cm-tooltip.cm-completionInfo),
  .editor-content :global(.cm-tooltip-hover) {
    max-width: min(25rem, calc(100vw - 32px));
    max-height: 17rem;
    overflow: auto;
    padding: 10px 12px;
    font-family: var(--ui-font, system-ui, sans-serif);
    font-size: 12px;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  .editor-content :global(.cm-tooltip.cm-completionInfo.completion-details-below) {
    box-sizing: border-box;
    padding: 10px 12px;
    border-radius: 0 0 4px 4px;
    border-top: 1px solid var(--line);
  }
  .editor-content:not(.show-completion-details) :global(.cm-completionInfo) {
    visibility: hidden;
    pointer-events: none;
  }
  .editor-content :global(.completion-details) {
    white-space: normal;
  }
  .editor-content :global(.completion-details-title) {
    min-width: 0;
    color: var(--color-primary);
    font-family: var(--code-font, monospace);
    font-size: 13px;
    font-weight: 700;
    overflow-wrap: anywhere;
  }
  .editor-content :global(.completion-details-heading) {
    display: block;
    margin: 10px 0 5px;
    color: var(--muted);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .editor-content :global(.completion-card) {
    display: flex;
    max-height: max(0px, calc(var(--completion-detail-height, 17rem) - 24px));
    flex-direction: column;
  }
  .editor-content :global(.completion-card-header) {
    display: flex;
    flex: none;
    align-items: center;
    gap: 10px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--line);
  }
  .editor-content :global(.completion-card-glyph) {
    display: grid;
    width: 34px;
    height: 34px;
    flex: none;
    place-items: center;
    border-radius: 7px;
    background: color-mix(in srgb, var(--color-primary) 16%, var(--color-base-100));
    color: var(--color-primary);
    font: 19px var(--ui-font, system-ui, sans-serif);
  }
  .editor-content :global(.completion-function .completion-card-glyph) {
    font:
      italic 22px Georgia,
      serif;
  }
  .editor-content :global(.completion-card-identity) {
    min-width: 0;
    line-height: 1.3;
  }
  .editor-content :global(.completion-card-kind),
  .editor-content :global(.completion-function-section-title) {
    color: var(--muted);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .editor-content :global(.completion-detail-scroll) {
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
  }
  .editor-content :global(.completion-function-section),
  .editor-content :global(.completion-documentation-section) {
    display: flex;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 4px 10px;
    padding: 10px 0 5px;
  }
  .editor-content :global(.completion-function-count),
  .editor-content :global(.completion-function-scroll-hint) {
    color: var(--muted);
    font-size: 10px;
  }
  .editor-content :global(.completion-function-scroll-hint) {
    white-space: nowrap;
  }
  .editor-content :global(.completion-parameter) {
    display: grid;
    grid-template-columns: 19px minmax(64px, 34%) minmax(0, 1fr);
    gap: 7px;
    align-items: baseline;
    padding: 5px 0;
    font-family: var(--code-font, monospace);
  }
  .editor-content :global(.completion-parameter + .completion-parameter) {
    border-top: 1px solid color-mix(in srgb, var(--color-base-content) 6%, transparent);
  }
  .editor-content :global(.completion-parameter-index) {
    color: var(--muted);
    font-size: 10px;
  }
  .editor-content :global(.completion-parameter-name) {
    color: var(--color-secondary);
    overflow-wrap: anywhere;
  }
  .editor-content :global(.completion-parameter-positional) {
    color: var(--muted);
    font-style: italic;
  }
  .editor-content :global(.completion-type-list) {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 3px;
    min-width: 0;
  }
  .editor-content :global(.completion-type-token) {
    padding: 1px 5px;
    border-radius: 3px;
    background: color-mix(in srgb, var(--color-primary) 10%, var(--color-base-100));
    color: var(--color-base-content);
    font: 11px var(--code-font, monospace);
    overflow-wrap: anywhere;
  }
  .editor-content :global(.completion-type-separator) {
    color: var(--muted);
    font-size: 10px;
  }
  .editor-content :global(.completion-property-type) {
    display: flex;
    flex: none;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 5px 10px;
    margin-top: 10px;
  }
  .editor-content :global(.completion-return) {
    display: flex;
    flex: none;
    align-items: flex-start;
    gap: 10px;
    margin-top: 8px;
    padding: 9px 10px;
    border-radius: 5px;
    background: color-mix(in srgb, var(--color-primary) 8%, var(--color-base-100));
  }
  .editor-content :global(.completion-return-arrow) {
    color: var(--color-primary);
    font-size: 17px;
    line-height: 1;
  }
  .editor-content :global(.completion-return-content) {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 5px 10px;
    min-width: 0;
  }
  .editor-content :global(.completion-return-label),
  .editor-content :global(.completion-property-type-label) {
    color: var(--muted);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .editor-content :global(.completion-symbol-preview),
  .editor-content :global(.completion-color-preview) {
    display: flex;
    flex: none;
    align-items: center;
    gap: 14px;
    margin-top: 10px;
    padding: 10px;
    border-radius: 5px;
    background: color-mix(in srgb, var(--color-primary) 8%, var(--color-base-100));
  }
  .editor-content :global(.completion-symbol-glyph) {
    min-width: 48px;
    color: var(--color-base-content);
    font-size: 36px;
    line-height: 1.2;
    text-align: center;
  }
  .editor-content :global(.completion-symbol-info .completion-details-heading),
  .editor-content :global(.completion-color-info .completion-details-heading) {
    margin: 0 0 3px;
  }
  .editor-content :global(.completion-symbol-code),
  .editor-content :global(.completion-color-value) {
    font: 12px var(--code-font, monospace);
  }
  .editor-content :global(.completion-color-swatch) {
    flex: 0 0 48px;
    width: 48px;
    height: 40px;
    border: 1px solid color-mix(in srgb, var(--color-base-content) 25%, transparent);
    border-radius: 4px;
  }
  .editor-content :global(.completion-reference-preview) {
    flex: none;
    padding-bottom: 4px;
  }
  .editor-content :global(.completion-reference-title) {
    font-weight: 600;
  }
  .editor-content :global(.completion-documentation) {
    line-height: 1.55;
  }
  .editor-content :global(.completion-documentation p) {
    margin: 0 0 9px;
  }
  .editor-content :global(.completion-documentation ul),
  .editor-content :global(.completion-documentation ol) {
    margin: 6px 0 10px;
    padding-left: 1.4em;
  }
  .editor-content :global(.completion-documentation ul) {
    list-style: disc;
  }
  .editor-content :global(.completion-documentation ol) {
    list-style: decimal;
  }
  .editor-content :global(.completion-documentation li) {
    margin: 3px 0;
  }
  .editor-content :global(.completion-documentation li > p) {
    margin: 0;
  }
  .editor-content :global(.completion-documentation pre) {
    max-width: 100%;
    overflow: auto;
    padding: 8px 10px;
    border-radius: 4px;
    background: var(--color-base-100);
    white-space: pre;
  }
  .editor-content :global(.completion-documentation code) {
    font-family: var(--code-font, monospace);
  }
  .editor-content :global(.completion-documentation .doc-code-keyword) {
    color: var(--color-primary);
    font-weight: 600;
  }
  .editor-content :global(.completion-documentation .doc-code-strong) {
    color: var(--color-primary);
    font-weight: 700;
  }
  .editor-content :global(.completion-documentation .doc-code-emphasis) {
    color: color-mix(in srgb, var(--color-accent) 35%, var(--color-base-content));
    font-style: italic;
  }
  .editor-content :global(.completion-documentation .doc-code-link) {
    color: color-mix(in srgb, var(--color-secondary) 85%, var(--color-base-content));
    text-decoration: underline;
  }
  .editor-content :global(.completion-documentation .doc-code-name) {
    color: color-mix(in srgb, var(--color-secondary) 85%, var(--color-base-content));
  }
  .editor-content :global(.completion-documentation .doc-code-property),
  .editor-content :global(.completion-documentation .doc-code-string) {
    color: color-mix(in srgb, var(--color-accent) 35%, var(--color-base-content));
  }
  .editor-content :global(.completion-documentation .doc-code-literal) {
    color: color-mix(in srgb, var(--color-warning) 35%, var(--color-base-content));
  }
  .editor-content :global(.completion-documentation .doc-code-comment) {
    color: var(--muted);
    font-style: italic;
  }
  .editor-content :global(.completion-documentation .doc-code-punctuation) {
    color: var(--muted);
  }
  .editor-content :global(.completion-documentation a) {
    color: var(--color-primary);
    text-decoration: underline;
  }
  .editor-content :global(.cm-tooltip-above .cm-tooltip-arrow::before) {
    border-top-color: color-mix(in srgb, var(--color-base-content) 20%, var(--color-base-200));
  }
  .editor-content :global(.cm-tooltip-above .cm-tooltip-arrow::after) {
    border-top-color: var(--color-base-200);
  }
  .editor-content :global(.cm-tooltip-below .cm-tooltip-arrow::before) {
    border-bottom-color: color-mix(in srgb, var(--color-base-content) 20%, var(--color-base-200));
  }
  .editor-content :global(.cm-tooltip-below .cm-tooltip-arrow::after) {
    border-bottom-color: var(--color-base-200);
  }
  .editor-content :global(.cm-completionInfo p:first-child),
  .editor-content :global(.cm-tooltip-hover p:first-child) {
    margin-top: 0;
  }
  .editor-content :global(.cm-completionInfo p:last-child),
  .editor-content :global(.cm-tooltip-hover p:last-child) {
    margin-bottom: 0;
  }
  .editor-status {
    padding: 4px 12px;
    font-size: 0.75rem;
    opacity: 0.7;
  }
</style>

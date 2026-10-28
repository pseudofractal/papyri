import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import tasks from 'markdown-it-task-lists';
import GithubSlugger from 'github-slugger';
import hljs from 'highlight.js/lib/common';
import { configureReferences } from './references';
import { configureMath } from './math';
import { defaults } from '../lib/preferences';
import type { Delimiter, Heading, Rendered } from '../lib/types';
import { MAX_DOCUMENT_BYTES } from '../lib/limits';
const formats = new Set(['mermaid', 'dot', 'graphviz', 'vega', 'vega-lite', 'plantuml']);
/** Parse in a disposable worker. HTML stays unprivileged until the frame sanitizes it. */
export function renderMarkdown(
  source: string,
  delimiters: Delimiter[] = defaults.delimiters,
): Rendered {
  if (new TextEncoder().encode(source).length > MAX_DOCUMENT_BYTES)
    throw new Error('This document exceeds the 8 MiB preview limit.');
  const start = performance.now();
  const headings: Heading[] = [];
  const markdown = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: false,
    highlight(code, language) {
      if (code.length <= 100_000 && language && hljs.getLanguage(language)) {
        return hljs.highlight(code, { language, ignoreIllegals: true }).value;
      }
      return '';
    },
  })
    .use(footnote)
    .use(tasks, { enabled: false });
  const slugger = new GithubSlugger();
  markdown.renderer.rules.heading_open = (tokens, index, options, env, renderer) => {
    const title = (tokens[index + 1].children || [])
      .filter((token) => ['text', 'code_inline'].includes(token.type))
      .map((token) => token.content)
      .join('');
    const id = slugger.slug(title);
    tokens[index].attrSet('id', id);
    headings.push({ id, text: title, level: Number(tokens[index].tag.slice(1)) });
    return renderer.renderToken(tokens, index, options);
  };
  configureMath(markdown, delimiters);
  configureReferences(markdown);
  const defaultFence = markdown.renderer.rules.fence!;
  markdown.renderer.rules.fence = (tokens, index, options, env, renderer) => {
    const token = tokens[index];
    const language = token.info.trim().split(/\s+/)[0].toLowerCase();
    if (!formats.has(language)) return defaultFence(tokens, index, options, env, renderer);
    return `<pre class="diagram-source" data-format="${language}"><code>${markdown.utils.escapeHtml(token.content)}</code></pre>`;
  };
  return { html: markdown.render(source), headings, elapsed: performance.now() - start };
}

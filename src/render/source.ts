import hljs from 'highlight.js/lib/core';
import latex from 'highlight.js/lib/languages/latex';
import type { LanguageFn } from 'highlight.js';
import type { Rendered } from '../lib/types';
import { MAX_DOCUMENT_BYTES } from '../lib/limits';

const typst: LanguageFn = (highlight) => ({
  name: 'Typst',
  contains: [
    highlight.C_LINE_COMMENT_MODE,
    highlight.C_BLOCK_COMMENT_MODE,
    highlight.QUOTE_STRING_MODE,
    {
      scope: 'keyword',
      begin: /#(?:let|set|show|if|else|for|while|import|include|return|context)\b/,
    },
    { scope: 'built_in', begin: /#[a-zA-Z_][\w-]*/ },
    { scope: 'section', begin: /^=+\s.+$/ },
    { scope: 'number', begin: /\b\d+(?:\.\d+)?(?:pt|mm|cm|in|em|%|fr)?\b/ },
  ],
});
hljs.registerLanguage('typst', typst);
hljs.registerLanguage('latex', latex);
const HIGHLIGHT_LIMIT = 100_000;

/** Render source as inert code inside the existing isolated preview. */
export function renderSource(text: string, language: 'typst' | 'latex'): Rendered {
  if (new TextEncoder().encode(text).length > MAX_DOCUMENT_BYTES)
    throw new Error('This document exceeds the 8 MiB preview limit.');
  const start = performance.now();
  const escaped = (value: string) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const code =
    text.length <= HIGHLIGHT_LIMIT
      ? hljs.highlight(text, { language, ignoreIllegals: true }).value
      : escaped(text);
  return {
    html: `<pre><code class="hljs language-${language}">${code}</code></pre>`,
    headings: [],
    elapsed: performance.now() - start,
  };
}

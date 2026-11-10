import hljs from 'highlight.js/lib/core';
import latex from 'highlight.js/lib/languages/latex';
import type { LanguageFn } from 'highlight.js';
import type { Rendered } from '../lib/types';
import type { BuildDiagnostic, BuildFailure } from '../lib/build-diagnostics';
import { explainBuildMessage } from '../lib/build-diagnostics';
import {
  LUCIDE_ARROW_UP_RIGHT_MARKUP,
  LUCIDE_WARNING_MARKUP,
  LUCIDE_X_MARKUP,
} from '../lib/lucide-svg';
import { basename } from '../lib/paths';
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

export interface BuildRenderOptions {
  path: string;
  failure: BuildFailure;
  mode: 'inline' | 'inspector';
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function diagnosticLocation(diagnostic: BuildDiagnostic): string {
  const column = diagnostic.column ? `:${diagnostic.column}` : '';
  return `${escapeHtml(diagnostic.file)}:${diagnostic.line}${column}`;
}

function diagnosticCard(diagnostic: BuildDiagnostic): string {
  const position = diagnosticLocation(diagnostic);
  const openIcon = diagnostic.line
    ? `<button type="button" class="build-diagnostic-link-icon" data-build-jump="${diagnostic.line}" aria-label="Open line ${diagnostic.line}" title="Open line ${diagnostic.line}"><svg viewBox="0 0 24 24" aria-hidden="true">${LUCIDE_ARROW_UP_RIGHT_MARKUP}</svg></button>`
    : '';
  return `<div class="build-inline-diagnostic ${diagnostic.severity}" role="note">
    <span class="build-diagnostic-mark" aria-hidden="true"><svg viewBox="0 0 24 24">${diagnostic.severity === 'error' ? LUCIDE_X_MARKUP : LUCIDE_WARNING_MARKUP}</svg></span>
    <div class="build-diagnostic-head">
      <strong>${escapeHtml(diagnostic.message)}</strong>
      <span class="build-diagnostic-location">${position}</span>
      ${openIcon}
    </div>
    <p class="build-diagnostic-explanation">${escapeHtml(explainBuildMessage(diagnostic.message))}</p>
  </div>`;
}

function railDiagnostic(diagnostic: BuildDiagnostic): string {
  const jump = diagnostic.line
    ? `<button type="button" class="build-link" data-build-jump="${diagnostic.line}">Open line ${diagnostic.line} →</button>`
    : '';
  return `<article class="build-rail-diagnostic ${diagnostic.severity}">
    <div class="build-rail-diagnostic-head">
      <strong>${escapeHtml(diagnostic.message)}</strong>
      <span>${diagnosticLocation(diagnostic)}</span>
    </div>
    <p>${escapeHtml(explainBuildMessage(diagnostic.message))}</p>
    ${jump}
  </article>`;
}

function renderBuildView(
  text: string,
  language: 'typst' | 'latex',
  options: BuildRenderOptions,
): Rendered {
  const started = performance.now();
  const { failure, mode, path } = options;
  const lines = text.split(/\r?\n/);
  const byLine = new Map<number, BuildDiagnostic[]>();
  for (const diagnostic of failure.diagnostics) {
    if (diagnostic.line < 1) continue;
    const list = byLine.get(diagnostic.line) ?? [];
    list.push(diagnostic);
    byLine.set(diagnostic.line, list);
  }
  const highlight = (line: string) =>
    text.length <= HIGHLIGHT_LIMIT
      ? hljs.highlight(line || ' ', { language, ignoreIllegals: true }).value
      : escapeHtml(line);

  const sourceLines = lines
    .map((line, index) => {
      const lineNumber = index + 1;
      const diagnostics = byLine.get(lineNumber) ?? [];
      const severity = diagnostics.some((diagnostic) => diagnostic.severity === 'error')
        ? ' bad'
        : diagnostics.length
          ? ' warn'
          : '';
      const row = `<div class="build-line${severity}" id="build-line-${lineNumber}" data-source-start="${index}" data-source-end="${index + 1}"><span class="build-ln">${lineNumber}</span><code class="build-code">${highlight(line)}</code></div>`;
      return diagnostics.length ? row + diagnostics.map(diagnosticCard).join('') : row;
    })
    .join('');

  const errors = failure.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length;
  const warnings = failure.diagnostics.filter(
    (diagnostic) => diagnostic.severity === 'warning',
  ).length;
  const countLabel =
    errors || warnings
      ? [
          errors ? `${errors} error${errors === 1 ? '' : 's'}` : '',
          warnings ? `${warnings} warning${warnings === 1 ? '' : 's'}` : '',
        ]
          .filter(Boolean)
          .join(' · ')
      : 'Build failed';
  const compiler = failure.compiler === 'typst' ? 'Typst' : `LaTeX · ${failure.compiler}`;
  const firstLine = failure.diagnostics.find((diagnostic) => diagnostic.line > 0)?.line;
  const fileName =
    failure.diagnostics[0]?.file ??
    (path ? basename(path) : failure.language === 'typst' ? 'Typst source' : 'LaTeX source');
  const logLines = failure.log ? failure.log.split('\n').length : 0;
  const logBody = failure.log ? escapeHtml(failure.log) : 'No compiler output was captured.';
  const environment = failure.environment.length
    ? `<p class="build-environment">${escapeHtml(failure.environment.join(' '))}</p>`
    : '';
  const modeButtons = `<div class="build-segments" role="group" aria-label="Build view">
    <button type="button" class="build-segment${mode === 'inline' ? ' active' : ''}" data-build-action="mode" data-build-mode="inline" aria-pressed="${mode === 'inline'}">Inline</button>
    <button type="button" class="build-segment${mode === 'inspector' ? ' active' : ''}" data-build-action="mode" data-build-mode="inspector" aria-pressed="${mode === 'inspector'}">Inspector</button>
  </div>`;
  const toolbar = `<header class="build-toolbar">
    <div class="build-toolbar-status">
      <span class="build-status-dot" aria-hidden="true"></span>
      <strong>${countLabel}</strong>
      <span class="build-compiler">${compiler}</span>
    </div>
    <div class="build-toolbar-actions">
      ${firstLine ? `<button type="button" class="build-button" data-build-action="edit" data-build-line="${firstLine}">Edit source</button>` : ''}
      <button type="button" class="build-button build-toolbar-retry" data-build-action="retry">Retry</button>
      ${modeButtons}
    </div>
  </header>`;

  const fileBar = `<div class="build-filebar"><span class="build-file-name">${escapeHtml(fileName)}</span><span>Source · read-only</span></div>`;
  const source = `<div class="build-source-scroll"><div class="build-lines">${sourceLines}</div></div>`;
  const inlineLog = `<details class="build-log build-inline-log"><summary><span>Compiler output</span><span>${logLines} line${logLines === 1 ? '' : 's'} · ${compiler}</span></summary>${environment}<pre>${logBody}</pre></details>`;

  const rail = `<aside class="build-rail" aria-label="Build inspector">
    <div class="build-rail-head"><strong>Build inspector</strong><button type="button" class="build-rail-close" data-build-action="mode" data-build-mode="inline" aria-label="Close build inspector">×</button></div>
    <div class="build-rail-status"><span class="build-status-dot" aria-hidden="true"></span><span>Build failed</span><span class="build-rail-meta">${compiler}</span></div>
    <div class="build-rail-body">
      ${failure.diagnostics.length ? failure.diagnostics.map(railDiagnostic).join('') : `<article class="build-rail-diagnostic error"><div class="build-rail-diagnostic-head"><strong>${escapeHtml(failure.summary)}</strong></div><p>${escapeHtml(explainBuildMessage(failure.summary))}</p></article>`}
      <details class="build-rail-log" open><summary><span>Build log</span><span>${logLines} line${logLines === 1 ? '' : 's'}</span></summary>${environment}<pre>${logBody}</pre></details>
    </div>
    <div class="build-rail-foot"><button type="button" class="build-button primary" data-build-action="retry">Recompile</button><button type="button" class="build-button" data-build-action="copy-log">Copy log</button></div>
  </aside>`;

  const html = `<div class="build-view build-inline" data-build-mode="${mode}">${toolbar}<div class="build-workspace"><section class="build-main">${fileBar}${source}${inlineLog}</section>${rail}</div></div>`;

  return { html, headings: [], elapsed: performance.now() - started };
}

/** Render source as inert code, or as a readable failed-build view. */
export function renderSource(
  text: string,
  language: 'typst' | 'latex',
  options?: BuildRenderOptions,
): Rendered {
  if (new TextEncoder().encode(text).length > MAX_DOCUMENT_BYTES)
    throw new Error('This document exceeds the 8 MiB preview limit.');
  if (options) return renderBuildView(text, language, options);
  const start = performance.now();
  const code =
    text.length <= HIGHLIGHT_LIMIT
      ? hljs.highlight(text, { language, ignoreIllegals: true }).value
      : escapeHtml(text);
  return {
    html: `<pre><code class="hljs language-${language}">${code}</code></pre>`,
    headings: [],
    elapsed: performance.now() - start,
  };
}

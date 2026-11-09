import { describe, expect, it } from 'vitest';
import { CompletionContext } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import {
  combineCompletionSources,
  createLatexCompletionSource,
  isInMath,
  toCodeMirrorSnippet,
} from '../src/lib/latex-completions';

function context(document: string, position = document.length, explicit = true) {
  const state = EditorState.create({ doc: document });
  return new CompletionContext(state, position, explicit);
}

async function labels(
  language: 'latex' | 'markdown',
  document: string,
  position = document.length,
) {
  const source = createLatexCompletionSource(language);
  const result = await source(context(document, position));
  return result?.options.map((option) => option.label) ?? [];
}

describe('LaTeX completion data', () => {
  it('converts VS Code snippets to CodeMirror placeholders', () => {
    expect(toCodeMirrorSnippet('\\section{$1}', '\\')).toBe('\\section{${1}}');
    expect(toCodeMirrorSnippet('\\begin{$1}\n\t${0:${TM_SELECTED_TEXT}}\n\\end{$1}')).toBe(
      '\\begin{${1}}\n\t${0}\n\\end{${1}}',
    );
  });

  it('detects inline math and ignores fenced code', () => {
    expect(isInMath('value $x + y$', 9)).toBe(true);
    expect(isInMath('value $x + y$', 13)).toBe(false);
    expect(isInMath('```tex\n$x$\n```\n', 11)).toBe(false);
    expect(isInMath('\\[x + y\\]', 5)).toBe(true);
  });

  it('completes LaTeX commands', async () => {
    expect(await labels('latex', '\\fra')).toContainEqual(expect.stringMatching(/^\\frac/));
    expect(await labels('latex', '\\usep')).toContainEqual(expect.stringMatching(/^\\usepackage/));
  });

  it('completes environment names after begin and end', async () => {
    expect(await labels('latex', '\\begin{eq')).toContain('equation');
    expect(await labels('latex', '\\end{eq')).toContain('equation');
  });

  it('completes package names inside usepackage', async () => {
    expect(await labels('latex', '\\usepackage{amsm')).toContain('amsmath');
  });

  it('completes commands inside a LaTeX equation environment', async () => {
    const document = String.raw`\documentclass{article}
\begin{document}
\begin{equation}\label{eq:gaussian}
\fra
\end{equation}
\end{document}
`;
    const source = createLatexCompletionSource('latex');
    const result = await source(context(document, document.indexOf('\\fra') + '\\fra'.length));
    expect(result?.options[0].label).toMatch(/^\\frac/);
  });

  it('only completes markdown outside code when the cursor is in math', async () => {
    expect(await labels('markdown', '$\\fra')).toContainEqual(expect.stringMatching(/^\\frac/));
    expect(await labels('markdown', '\\fra')).toEqual([]);
    expect(await labels('markdown', '`\\fra`')).toEqual([]);
  });

  it('prefers the local source even when the remote source has more options', async () => {
    const local = () => ({ from: 0, options: [{ label: '\\frac' }] });
    const remote = () => ({
      from: 0,
      options: [{ label: '\\alpha' }, { label: '\\beta' }],
    });
    const result = await combineCompletionSources([local, remote], local)(context('\\'));
    expect(result?.options.map((option) => option.label)).toEqual(['\\frac']);
  });

  it('prioritizes the first completion source and removes duplicate labels', async () => {
    const first = () => ({
      from: 0,
      options: [{ label: '\\frac' }, { label: '\\alpha' }],
    });
    const second = () => ({
      from: 0,
      options: [{ label: '\\frac' }, { label: '\\beta' }],
    });
    const result = await combineCompletionSources([first, second])(context('\\'));
    expect(result?.options.map((option) => option.label)).toEqual(['\\frac', '\\alpha', '\\beta']);
  });
});

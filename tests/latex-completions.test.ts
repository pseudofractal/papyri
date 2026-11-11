import { describe, expect, it } from 'vitest';
import { CompletionContext } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import {
  combineCompletionSources,
  createLatexCompletionSource,
  isInMath,
  toCodeMirrorSnippet,
} from '../src/lib/latex-completions';
import type { Delimiter } from '../src/lib/types';
import type { LatexProjectMetadata } from '../src/lib/latex-project';

function context(document: string, position = document.length, explicit = true) {
  const state = EditorState.create({ doc: document });
  return new CompletionContext(state, position, explicit);
}

async function labels(
  language: 'latex' | 'markdown',
  document: string,
  position = document.length,
  delimiters?: Delimiter[],
) {
  const source = createLatexCompletionSource(language, delimiters ? () => delimiters : undefined);
  const result = await source(context(document, position));
  return result?.options.map((option) => option.label) ?? [];
}

function projectMetadata(values: Partial<LatexProjectMetadata> = {}): LatexProjectMetadata {
  return {
    labels: [],
    citations: [],
    citedKeys: {},
    packages: [],
    commands: [],
    environments: [],
    files: [],
    ...values,
  };
}

async function projectLabels(
  document: string,
  project: LatexProjectMetadata,
  position = document.length,
) {
  const source = createLatexCompletionSource('latex', undefined, () => project);
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
    expect(isInMath('value \\(x + y\\)', 9)).toBe(true);
    expect(isInMath('value \\(x + y\\)', 15)).toBe(false);
    expect(isInMath('```tex\n\\(x\\)\n```\n', 11)).toBe(false);
    expect(isInMath('\\[x + y\\]', 5)).toBe(true);
  });

  it('completes LaTeX commands', async () => {
    expect(await labels('latex', '\\fra')).toContainEqual(expect.stringMatching(/^\\frac/));
    expect(await labels('latex', '\\usep')).toContainEqual(expect.stringMatching(/^\\usepackage/));
  });

  it('does not reuse a truncated command list for a longer prefix', async () => {
    const source = createLatexCompletionSource('latex');
    const atBackslash = await source(context('\\'));
    expect(atBackslash?.options).toHaveLength(300);
    expect(atBackslash?.validFor).toBeUndefined();

    const atFra = await source(context('\\fra'));
    expect(atFra?.options[0].label).toBe('\\frac{}{}');
    expect(atFra?.validFor).toBeDefined();

    const atVsp = await source(context('\\vsp'));
    expect(atVsp?.options.some((option) => option.label === '\\vspace{}')).toBe(true);
  });

  it('completes environment names after begin and end', async () => {
    expect(await labels('latex', '\\begin{eq')).toContain('equation');
    const source = createLatexCompletionSource('latex');
    const closed = await source(context('\\end{eq'));
    expect(closed).not.toBeNull();
    expect(closed?.options).toEqual([]);
    expect(await labels('latex', '\\begin{equation}\n\\end{eq')).toContain('equation');
  });

  it('completes common environments missing from the upstream data', async () => {
    expect(await labels('latex', '\\begin{fig')).toContain('figure');
    expect(await labels('latex', '\\begin{frame')).toContain('frame');
  });

  it('completes commands and environments defined in the document', async () => {
    const document = String.raw`\newcommand{\foo}[1]{\textbf{#1}}
\newenvironment{myenv}{\begin{quote}}{\end{quote}}
\fo`;
    expect(await labels('latex', document, document.length)).toContain('\\foo{}');
    const environmentDocument = document.slice(0, document.lastIndexOf('\\fo')) + '\\begin{my';
    expect(await labels('latex', environmentDocument, environmentDocument.length)).toContain(
      'myenv',
    );
  });

  it('completes packages in a comma-separated list and excludes used packages', async () => {
    const document = '\\usepackage{amsmath}\n\\usepackage{ams';
    const first = await labels('latex', document);
    expect(first).toContain('amsfonts');
    expect(first).not.toContain('amsmath');

    const multiple = await labels('latex', '\\usepackage{amsmath, amsf');
    expect(multiple).toContain('amsfonts');
    expect(multiple).not.toContain('amsmath');
  });

  it('completes commands and environments provided by used packages', async () => {
    expect(await labels('latex', '\\usepackage{amsmath}\n\\boxe')).toContain('\\boxed{}');
    expect(await labels('latex', '\\usepackage{tikz}\n\\begin{scop')).toContain('scope');

    const project = projectMetadata({ packages: ['booktabs'] });
    expect(await projectLabels('\\topr', project)).toContain('\\toprule');
  });

  it('completes project-defined commands and environments', async () => {
    const project = projectMetadata({
      commands: [{ name: 'chaptercmd', args: 1 }],
      environments: ['projectenv'],
    });
    expect(await projectLabels('\\chapterc', project)).toContain('\\chaptercmd{}');
    expect(await projectLabels('\\begin{projecte', project)).toContain('projectenv');
  });

  it('completes project citations and references, including comma-separated keys', async () => {
    const project = projectMetadata({
      citations: ['alpha', 'beta', 'gamma'],
      labels: ['sec:one', 'sec:two', 'fig:one'],
    });
    const citations = await projectLabels('\\cite{alpha, ', project);
    expect(citations).toEqual(expect.arrayContaining(['beta', 'gamma']));
    expect(citations).not.toContain('alpha');

    const references = await projectLabels('\\ref{sec:one, sec', project);
    expect(references).toContain('sec:two');
    expect(references).not.toContain('sec:one');
  });

  it('completes project files by argument type', async () => {
    const project = projectMetadata({
      files: [
        { path: 'chapter.tex', directory: false },
        { path: 'main.tex', directory: false },
        { path: 'figure.pdf', directory: false },
        { path: 'references.bib', directory: false },
        { path: 'assets', directory: true },
      ],
    });
    expect(await projectLabels('\\input{cha', project)).toContain('chapter');
    expect(await projectLabels('\\input{fig', project)).not.toContain('figure.pdf');
    expect(await projectLabels('\\includegraphics{fig', project)).toContain('figure.pdf');
    expect(await projectLabels('\\includegraphics{cha', project)).not.toContain('chapter');
    expect(await projectLabels('\\bibliography{ref', project)).toContain('references');
    expect(await projectLabels('\\addbibresource{ref', project)).toContain('references.bib');
  });

  it('completes full file and project-package commands', async () => {
    const project = projectMetadata({
      packages: ['booktabs'],
      files: [
        { path: 'chapter.tex', directory: false },
        { path: 'figure.pdf', directory: false },
        { path: 'references.bib', directory: false },
      ],
    });
    expect(await projectLabels('\\inp', project)).toContain('\\input{chapter}');
    expect(await projectLabels('\\incl', project)).toContain('\\includegraphics{figure.pdf}');
    expect(await projectLabels('\\bib', project)).toContain('\\bibliography{references}');
    expect(await projectLabels('\\usep', project)).toContain('\\usepackage{booktabs}');
  });

  it('completes bibliography styles', async () => {
    const styles = await labels('latex', '\\bibliographystyle{plai');
    expect(styles).toEqual(expect.arrayContaining(['plain', 'plainnat']));
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
    expect(await labels('markdown', '\\(\\fra')).toContainEqual(expect.stringMatching(/^\\frac/));
    expect(await labels('markdown', '\\fra')).toEqual([]);
    expect(await labels('markdown', '`\\fra`')).toEqual([]);
  });

  it('honors the configured delimiters instead of always accepting dollars', async () => {
    const dollars: Delimiter[] = [{ left: '$', right: '$', display: false }];
    expect(await labels('markdown', '$\\fra')).toEqual([]);
    expect(await labels('markdown', '$\\fra', undefined, dollars)).toContainEqual(
      expect.stringMatching(/^\\frac/),
    );
  });

  it('recognizes configured block delimiters such as bare brackets', async () => {
    const delimiters: Delimiter[] = [{ left: '[', right: ']', display: true }];
    const document = '# Math\n\n[\n\\fra\n]\n';
    const position = document.indexOf('\\fra') + '\\fra'.length;
    expect(isInMath(document, position, delimiters)).toBe(true);
    expect(await labels('markdown', document, position, delimiters)).toContainEqual(
      expect.stringMatching(/^\\frac/),
    );
  });

  it('does not treat brackets in prose or links as math', () => {
    const delimiters: Delimiter[] = [{ left: '[', right: ']', display: true }];
    expect(isInMath('text [\\fra](url)', 8, delimiters)).toBe(false);
    expect(isInMath('text [\\fra]', 8, [{ left: '[', right: ']', display: false }])).toBe(true);
  });

  it('suppresses LaTeX completions in comments and verbatim environments', async () => {
    expect(await labels('latex', '% \\fra')).toEqual([]);
    expect(await labels('latex', '\\fra % comment')).toEqual([]);
    expect(await labels('latex', '\\fra % 100\\%')).toEqual([]);
    expect(await labels('latex', '\\begin{verbatim}\n\\fra')).toEqual([]);
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

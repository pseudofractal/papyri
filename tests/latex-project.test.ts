import { describe, expect, it } from 'vitest';
import {
  loadLatexProject,
  scanLatexBibKeys,
  scanLatexCommandDefinitions,
  scanLatexEnvironmentDefinitions,
  scanLatexLabels,
  scanLatexPackages,
  stripLatexComments,
} from '../src/lib/latex-project';
import type { Entry, Source } from '../src/lib/types';

function treeSource(tree: Record<string, string | null>): Source {
  return {
    label: 'test',
    root: '/',
    live: false,
    async list(path: string): Promise<Entry[]> {
      const prefix = path === '/' ? '/' : `${path}/`;
      const entries = new Map<string, Entry>();
      for (const key of Object.keys(tree)) {
        if (!key.startsWith(prefix)) continue;
        const remainder = key.slice(prefix.length);
        if (!remainder) continue;
        const name = remainder.split('/')[0];
        const childPath = `${prefix}${name}`;
        const directory = Object.keys(tree).some((child) => child.startsWith(`${childPath}/`));
        entries.set(name, {
          name,
          path: childPath,
          directory,
        });
      }
      return [...entries.values()];
    },
    async read(path: string) {
      const text = tree[path];
      if (text == null) throw new Error('not a file');
      return { text, stamp: '1' };
    },
    async asset() {
      throw new Error('not an asset');
    },
  };
}

describe('LaTeX project metadata', () => {
  it('strips comments without removing escaped percent signs', () => {
    expect(stripLatexComments('a 50\\% b % comment\nc')).toBe('a 50\\% b \nc');
  });

  it('extracts labels, packages, citations, and document definitions', () => {
    const document = String.raw`\documentclass{article}
\usepackage{amsmath, graphicx}
\newcommand{\foo}[1]{\textbf{#1}}
\newenvironment{myenv}{\begin{quote}}{\end{quote}}
\section{Intro}\label{sec:intro}
% \label{commented:out}
100\% done
\bibitem{manual}
`;
    expect(scanLatexLabels(document)).toEqual(['sec:intro']);
    expect(scanLatexPackages(document)).toEqual(['amsmath', 'graphicx']);
    expect(scanLatexCommandDefinitions(document)).toEqual([{ name: 'foo', args: 1 }]);
    expect(scanLatexEnvironmentDefinitions(document)).toEqual(['myenv']);
  });

  it('extracts BibTeX keys', () => {
    expect(scanLatexBibKeys('@article{key1,\n title={A}\n}\n@book{key2, title={B}}')).toEqual([
      'key1',
      'key2',
    ]);
  });

  it('walks the project without entering ignored directories', async () => {
    const source = treeSource({
      '/project': null,
      '/project/main.tex': String.raw`\usepackage{amsmath}
\newcommand{\foo}[2]{}
\newenvironment{myenv}{}{}
\label{sec:intro}
\cite{key1,key2}
\cite{key1}
\bibitem{manual}
`,
      '/project/chapter.tex': String.raw`\label{ch:one}
`,
      '/project/refs.bib': '@article{key1, title={A}}\n',
      '/project/fig.png': 'png',
      '/project/sub': null,
      '/project/sub/deep.tex': String.raw`\usepackage{graphicx}
\label{deep:one}
`,
      '/project/node_modules': null,
      '/project/node_modules/ignored.tex': String.raw`\usepackage{ignored}
\label{ignored:one}
`,
    });
    const metadata = await loadLatexProject(source, '/project');
    expect(metadata.labels.sort()).toEqual(['ch:one', 'deep:one', 'sec:intro']);
    expect(metadata.citations.sort()).toEqual(['key1', 'manual']);
    expect(metadata.packages.sort()).toEqual(['amsmath', 'graphicx']);
    expect(metadata.commands).toEqual([{ name: 'foo', args: 2 }]);
    expect(metadata.environments).toEqual(['myenv']);
    expect(metadata.citedKeys).toEqual({ key1: 2, key2: 1 });
    expect(metadata.files.map((file) => file.path)).toEqual(
      expect.arrayContaining(['main.tex', 'chapter.tex', 'refs.bib', 'fig.png', 'sub/deep.tex']),
    );
    expect(metadata.files.map((file) => file.path)).not.toContain('node_modules/ignored.tex');
  });

  it('uses unsaved drafts instead of the file on disk', async () => {
    const source = treeSource({
      '/project': null,
      '/project/main.tex': '\\label{old}',
    });
    const metadata = await loadLatexProject(source, '/project', {
      draftText: (path) => (path === '/project/main.tex' ? '\\label{new}' : undefined),
    });
    expect(metadata.labels).toEqual(['new']);
  });
});

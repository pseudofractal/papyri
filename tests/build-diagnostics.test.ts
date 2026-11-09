import { describe, expect, it } from 'vitest';
import { explainBuildMessage, parseBuildFailure } from '../src/lib/build-diagnostics';

const latexError = `Compilation failed. lualatex compilation failed (exit status: 1):
This is LuaHBTeX, Version 1.22.0 (TeX Live 2025/nixos.org)
(/project/broken.tex
LaTeX2e <2025-11-01>
L3 programming layer <2026-01-19>
No file broken.aux.
/project/broken.tex:3: Undefined control sequence.
l.3 ... undefined command: \\papyriUndefinedExample
 775 words of node memory still in use:
/project/broken.tex:3:  ==> Fatal error occurred, no output PDF file produced!
Transcript written on broken.log.
 Showing source.`;

const typstError = `Compilation failed. Typst compilation failed (exit status: 1): <stdin>:3:4: error: expected pattern

Compilation requires Linux user namespaces. Imports must stay in the document folder; packages must already be cached. Showing source.`;

describe('build diagnostics', () => {
  it('extracts the LaTeX file-line diagnostic and drops the fatal summary', () => {
    const failure = parseBuildFailure(latexError, 'latex', '/work/broken.tex');
    expect(failure.compiler).toBe('lualatex');
    expect(failure.language).toBe('latex');
    expect(failure.diagnostics).toEqual([
      {
        severity: 'error',
        message: 'Undefined control sequence',
        file: 'broken.tex',
        line: 3,
      },
    ]);
    expect(failure.summary).toBe('Undefined control sequence');
    expect(failure.log).toContain('/project/broken.tex:3:');
    expect(failure.log).not.toContain('Showing source');
    expect(failure.environment).toEqual([]);
  });

  it('extracts Typst locations and separates sandbox notes from the log', () => {
    const failure = parseBuildFailure(typstError, 'typst', '/work/broken.typ');
    expect(failure.compiler).toBe('typst');
    expect(failure.diagnostics).toEqual([
      {
        severity: 'error',
        message: 'expected pattern',
        file: 'broken.typ',
        line: 3,
        column: 4,
      },
    ]);
    expect(failure.summary).toBe('expected pattern');
    expect(failure.log).toBe('<stdin>:3:4: error: expected pattern');
    expect(failure.environment).toHaveLength(1);
    expect(failure.environment[0]).toContain('Linux user namespaces');
  });

  it('falls back to the caret block when Typst omits the inline location', () => {
    const failure = parseBuildFailure(
      `Compilation failed. Typst compilation failed (exit status: 1):
error: unknown variable
  ┌─ <stdin>:7:9
  │
7 │ #value
  │      ^`,
      'typst',
      '/work/notes.typ',
    );
    expect(failure.diagnostics).toEqual([
      {
        severity: 'error',
        message: 'unknown variable',
        file: 'notes.typ',
        line: 7,
        column: 9,
      },
    ]);
  });

  it('uses the bang line and l. line when LaTeX omits file-line output', () => {
    const failure = parseBuildFailure(
      `Compilation failed. pdflatex compilation failed (exit status: 1):
! LaTeX Error: File \`missing.sty' not found.
l.5 \\usepackage
               {missing}`,
      'latex',
      '/work/paper.tex',
    );
    expect(failure.compiler).toBe('pdflatex');
    expect(failure.diagnostics).toEqual([
      {
        severity: 'error',
        message: "LaTeX Error: File `missing.sty' not found",
        file: 'paper.tex',
        line: 5,
      },
    ]);
  });

  it('keeps warnings as warnings and deduplicates repeated locations', () => {
    const failure = parseBuildFailure(
      `Compilation failed. Typst compilation failed (exit status: 1):
<stdin>:2:5: warning: unused import
<stdin>:2:5: warning: unused import
<stdin>:4:1: error: expected expression`,
      'typst',
      '/work/notes.typ',
    );
    expect(failure.diagnostics).toHaveLength(2);
    expect(failure.diagnostics[0].severity).toBe('warning');
    expect(failure.diagnostics[1].severity).toBe('error');
    expect(failure.summary).toBe('expected expression');
  });

  it('explains the common diagnostics in plain language', () => {
    expect(explainBuildMessage('Undefined control sequence')).toContain('does not recognize');
    expect(explainBuildMessage('expected pattern')).toContain('Typst expected');
    expect(explainBuildMessage('Something unexpected')).toContain('The compiler stopped');
  });
});

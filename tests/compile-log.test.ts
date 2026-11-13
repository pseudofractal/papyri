import { describe, expect, it } from 'vitest';
import {
  errorLinesMissingFromLog,
  logLineTone,
  preview,
  type CompileLogSnapshot,
} from '../src/lib/compile-log';

describe('compile log error lines', () => {
  it('does not repeat a diagnostic already captured from the compiler', () => {
    const log = ['<stdin>:3:4: error: expected pattern'];
    const error = 'Typst compilation failed (exit status: 1): <stdin>:3:4: error: expected pattern';

    expect(errorLinesMissingFromLog(log, error)).toEqual([]);
  });

  it('compares diagnostics with captured trailing newlines', () => {
    const log = ['<stdin>:3:4: error: expected pattern\n'];
    const error = 'Typst compilation failed (exit status: 1): <stdin>:3:4: error: expected pattern';

    expect(errorLinesMissingFromLog(log, error)).toEqual([]);
  });

  it('keeps a more specific location when the log has only a shorter message', () => {
    const log = ['error: expected pattern'];
    const error = '<stdin>:3:4: error: expected pattern';

    expect(errorLinesMissingFromLog(log, error)).toEqual(['<stdin>:3:4: error: expected pattern']);
  });

  it('recognizes signal status wrappers with nested parentheses', () => {
    const log = ['error: expected pattern'];
    const error = 'Typst compilation failed (signal: 9 (SIGKILL)): error: expected pattern';

    expect(errorLinesMissingFromLog(log, error)).toEqual([]);
  });

  it('ignores whitespace-only retained lines when checking for duplicates', () => {
    const log = ['   '];
    const error = 'error: unknown variable: heading';

    expect(errorLinesMissingFromLog(log, error)).toEqual(['error: unknown variable: heading']);
  });

  it('adds only the error lines missing from the retained output', () => {
    const log = ['! Undefined control sequence.'];
    const error = 'LaTeX compilation failed\n! Undefined control sequence.';

    expect(errorLinesMissingFromLog(log, error)).toEqual(['LaTeX compilation failed']);
  });

  it('adds error text when the compiler captured no matching diagnostics', () => {
    expect(errorLinesMissingFromLog([], 'Typst was not found on PATH.')).toEqual([
      'Typst was not found on PATH.',
    ]);
  });

  it('ignores blank error text', () => {
    expect(errorLinesMissingFromLog(['output'], '\n  \n')).toEqual([]);
  });
});

describe('compile log presentation', () => {
  const snapshot: CompileLogSnapshot = {
    path: '/work/paper.tex',
    engine: 'lualatex',
    phase: '',
    detail: '',
    elapsedSeconds: 1,
    page: 0,
    totalPages: null,
    log: [],
    active: false,
    success: false,
    cancelled: false,
    error: '',
  };

  it('classifies compiler output lines', () => {
    expect(logLineTone('! Undefined control sequence.')).toBe('error');
    expect(logLineTone('<stdin>:3:4: error: expected pattern')).toBe('error');
    expect(logLineTone('LaTeX Warning: Reference undefined')).toBe('warning');
    expect(logLineTone('[2]')).toBe('page');
    expect(logLineTone('Output written on paper.pdf (2 pages).')).toBe('success');
    expect(logLineTone('ordinary output')).toBe('plain');
  });

  it('shows completed page progress only for successful compiles', () => {
    const failed = preview({ ...snapshot, page: 13, totalPages: 13, active: false });
    expect(failed.totalPages).toBe(0);
    expect(failed.page).toBe(13);

    const cancelled = preview({
      ...snapshot,
      cancelled: true,
      page: 4,
      totalPages: 13,
    });
    expect(cancelled.totalPages).toBe(0);
    expect(cancelled.phase).toBe('Cancelled');

    const success = preview({ ...snapshot, success: true, page: 0, totalPages: 13 });
    expect(success.totalPages).toBe(13);
    expect(success.page).toBe(13);
  });

  it('clamps active page progress to the reported total', () => {
    const current = preview({ ...snapshot, active: true, page: 15, totalPages: 13 });
    expect(current.page).toBe(13);
    expect(current.totalPages).toBe(13);
  });
});

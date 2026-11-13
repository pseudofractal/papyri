export type LogTone = 'plain' | 'muted' | 'page' | 'warning' | 'error' | 'success';

export interface CompileLogLine {
  text: string;
  tone: LogTone;
}

export interface CompileLogSnapshot {
  path: string;
  engine: string;
  phase: string;
  detail: string;
  elapsedSeconds: number;
  page: number;
  totalPages: number | null;
  log: string[];
  active: boolean;
  success: boolean;
  cancelled: boolean;
  error: string;
}

export interface CompilePreview {
  path: string;
  engine: string;
  phase: string;
  detail: string;
  page: number;
  totalPages: number;
  log: CompileLogLine[];
}

const FAILURE_PREFIX = /^(?:Typst|lualatex|pdflatex|xelatex) compilation failed \(.*\):\s*/i;

/**
 * Return error lines that the retained compiler output does not already show.
 * Compiler errors often wrap diagnostics that were also captured on stderr.
 */
export function errorLinesMissingFromLog(log: string[], error: string): string[] {
  const retained = new Set(log.map((line) => line.trim()).filter(Boolean));
  return error
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) => line && !retained.has(line) && !retained.has(line.replace(FAILURE_PREFIX, '')),
    );
}

export function logLineTone(line: string): LogTone {
  if (line.startsWith('!') || /(^|:\s)error:/i.test(line)) return 'error';
  if (line.includes('Warning') || line.includes('Overfull') || line.includes('Underfull'))
    return 'warning';
  if (/^warning:/i.test(line)) return 'warning';
  if (/^hint:/i.test(line)) return 'muted';
  if (line.startsWith('Output written') || line.startsWith('SyncTeX written')) return 'success';
  if (line.startsWith('Transcript written')) return 'muted';
  if (/^\[\d/.test(line)) return 'page';
  if (line.startsWith('luaotfload') || line.startsWith('(')) return 'muted';
  return 'plain';
}

/** Convert a backend snapshot into the bounded presentation model. */
export function preview(value: CompileLogSnapshot): CompilePreview {
  const totalPages = value.active || value.success ? (value.totalPages ?? 0) : 0;
  const page = value.active
    ? totalPages > 0
      ? Math.min(value.page, totalPages)
      : value.page
    : value.success
      ? Math.max(value.page, totalPages)
      : value.page;
  const lines: CompileLogLine[] = value.log.map((line) => ({
    text: line,
    tone: logLineTone(line),
  }));
  for (const line of errorLinesMissingFromLog(value.log, value.error)) {
    lines.push({ text: line, tone: 'error' });
  }
  return {
    path: value.path,
    engine: value.engine,
    phase: describePhase(value),
    detail: describeDetail(value),
    page,
    totalPages,
    log: lines,
  };
}

function describePhase(value: CompileLogSnapshot): string {
  if (value.phase) return value.phase;
  if (value.active) return 'Compiling';
  if (value.cancelled) return 'Cancelled';
  return value.success ? 'Complete' : 'Failed';
}

function describeDetail(value: CompileLogSnapshot): string {
  if (value.detail) return value.detail;
  if (value.active) return 'Reading compiler output';
  if (value.cancelled) return 'Compilation cancelled';
  return value.success ? 'Compilation finished' : 'Compilation failed';
}

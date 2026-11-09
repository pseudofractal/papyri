/** A source location returned by the SyncTeX command-line utility. */
export interface SyncSourceLocation {
  path: string;
  line: number;
  column: number;
}

/** A position on a PDF page in points, measured from its top-left corner. */
export interface SyncPdfLocation {
  page: number;
  x: number;
  y: number;
}

function resultFields(output: string): Map<string, string> | null {
  const match = /SyncTeX result begin\r?\n([\s\S]*?)\r?\nSyncTeX result end/.exec(output);
  if (!match) return null;
  const fields = new Map<string, string>();
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const key = line.slice(0, separator);
    if (!fields.has(key)) fields.set(key, line.slice(separator + 1));
  }
  return fields;
}

/** Parse the first inverse-search match; SyncTeX lines are one-based and columns may be unavailable. */
export function parseSyncSource(output: string): SyncSourceLocation | null {
  const fields = resultFields(output);
  const path = fields?.get('Input');
  const line = Number(fields?.get('Line'));
  const column = Number(fields?.get('Column'));
  if (!path || !Number.isSafeInteger(line) || line < 1 || !Number.isSafeInteger(column))
    return null;
  return { path, line: line - 1, column: Math.max(0, column - 1) };
}

/** Parse the first forward-search match, rejecting invalid PDF coordinates. */
export function parseSyncPdf(output: string): SyncPdfLocation | null {
  const fields = resultFields(output);
  const page = Number(fields?.get('Page'));
  const x = Number(fields?.get('x'));
  const y = Number(fields?.get('y'));
  if (
    !fields?.has('x') ||
    !fields.has('y') ||
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < 0 ||
    y < 0
  )
    return null;
  return { page, x, y };
}

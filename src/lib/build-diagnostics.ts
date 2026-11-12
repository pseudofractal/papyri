import { basename } from './paths';

export type BuildSeverity = 'error' | 'warning' | 'info';

export interface BuildDiagnostic {
  severity: BuildSeverity;
  message: string;
  file: string;
  /** One-based source line, or 0 when the compiler did not report one. */
  line: number;
  /** One-based source column when the compiler reports one. */
  column?: number;
}

export interface BuildFailure {
  compiler: string;
  language: 'latex' | 'typst';
  diagnostics: BuildDiagnostic[];
  environment: string[];
  /** Compiler output with the wrapper and environment notes removed. */
  log: string;
  summary: string;
}

const MAX_LOG_CHARS = 80_000;
const MAX_DIAGNOSTICS = 50;

function compilerName(raw: string, language: 'latex' | 'typst'): string {
  const match = raw.match(/Compilation failed\.\s*([A-Za-z]+)\s+compilation failed/i);
  if (match) return match[1].toLowerCase();
  return language === 'typst' ? 'typst' : 'latex';
}

function displayFile(file: string | undefined, path: string): string {
  if (!file || file === '<stdin>' || file === 'stdin') return basename(path);
  const project = file.indexOf('/project/');
  if (project >= 0) return file.slice(project + '/project/'.length);
  return file.replace(/^\.\//, '');
}

function cleanMessage(message: string): string {
  return message.trim().replace(/\.$/, '').replace(/\s+/g, ' ');
}

/** Plain-language guidance for a compiler diagnostic. */
export function explainBuildMessage(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('undefined control sequence'))
    return 'LaTeX does not recognize this command. Check the spelling or define it in the preamble.';
  if (lower.includes('expected pattern'))
    return 'Typst expected a name or pattern here, such as a binding after #let.';
  if (lower.includes('not found'))
    return 'A file or package could not be found. Check the path and the installed toolchain.';
  if (lower.includes('missing $ inserted'))
    return 'Math mode was opened or closed incorrectly. Check the dollar signs around this expression.';
  if (lower.includes('missing') && lower.includes('inserted'))
    return 'The compiler had to insert a missing token. Check the surrounding syntax.';
  if (lower.includes('runaway argument'))
    return 'An argument was not closed. Check the braces near this location.';
  return 'The compiler stopped at this location. Review the surrounding source and build log.';
}

function dedupe(diagnostics: BuildDiagnostic[]): BuildDiagnostic[] {
  const seen = new Set<string>();
  const result: BuildDiagnostic[] = [];
  for (const diagnostic of diagnostics) {
    if (diagnostic.line < 1 || !diagnostic.message) continue;
    const key = `${diagnostic.file}\0${diagnostic.line}\0${diagnostic.column ?? ''}\0${diagnostic.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(diagnostic);
    if (result.length >= MAX_DIAGNOSTICS) break;
  }
  return result;
}

function typstDiagnostics(log: string, path: string): BuildDiagnostic[] {
  const diagnostics: BuildDiagnostic[] = [];
  const direct = /^(?:<stdin>|([^:\n]+?\.typ)):(\d+):(\d+):\s*(error|warning|hint):\s*(.+)$/;
  const plain = /^(error|warning|hint):\s*(.+)$/;
  const location = /[┌│]?\s*(?:<stdin>|([^:\n]+?\.typ)):(\d+):(\d+)/;
  const lines = log.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    const match = line.match(direct);
    if (match) {
      diagnostics.push({
        severity: match[4] === 'warning' ? 'warning' : match[4] === 'hint' ? 'info' : 'error',
        message: cleanMessage(match[5]),
        file: displayFile(match[1], path),
        line: Number(match[2]),
        column: Number(match[3]),
      });
      continue;
    }
    const heading = line.match(plain);
    if (!heading) continue;
    for (let lookahead = index + 1; lookahead < Math.min(lines.length, index + 4); lookahead++) {
      const position = lines[lookahead].match(location);
      if (!position) continue;
      diagnostics.push({
        severity: heading[1] === 'warning' ? 'warning' : heading[1] === 'hint' ? 'info' : 'error',
        message: cleanMessage(heading[2]),
        file: displayFile(position[1], path),
        line: Number(position[2]),
        column: Number(position[3]),
      });
      break;
    }
  }
  return dedupe(diagnostics);
}

function latexDiagnostics(log: string, path: string): BuildDiagnostic[] {
  const diagnostics: BuildDiagnostic[] = [];
  const fileLine = /^(?:\/project\/)?([^:\n]+?\.(?:tex|sty|cls|ltx|bib)):(\d+):\s*(.+)$/;
  const bang = /^!\s*(.+)$/;
  const sourceLine = /^l\.(\d+)\s*(.*)$/;
  const lines = log.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    const match = line.match(fileLine);
    if (match) {
      const message = match[3].trim();
      if (
        !message.startsWith('==>') &&
        !/^Fatal error occurred/i.test(message) &&
        !/no output PDF file produced/i.test(message)
      ) {
        diagnostics.push({
          severity: 'error',
          message: cleanMessage(message),
          file: displayFile(match[1], path),
          line: Number(match[2]),
        });
      }
      continue;
    }
    const heading = line.match(bang);
    if (!heading) continue;
    for (let lookahead = index + 1; lookahead < Math.min(lines.length, index + 5); lookahead++) {
      const position = lines[lookahead].match(sourceLine);
      if (!position) continue;
      diagnostics.push({
        severity: 'error',
        message: cleanMessage(heading[1]),
        file: basename(path),
        line: Number(position[1]),
      });
      break;
    }
  }
  return dedupe(diagnostics);
}

export interface LspDiagnosticLike {
  path: string;
  line: number;
  character: number;
  severity: 1 | 2 | 3 | 4;
  message: string;
}

/** Convert editor LSP diagnostics into the same model used by the build card. */
export function buildFailureFromLspDiagnostics(
  diagnostics: LspDiagnosticLike[],
  language: 'latex' | 'typst',
  path: string,
): BuildFailure | null {
  const items = diagnostics.filter(
    (diagnostic) => diagnostic.severity === 1 || diagnostic.severity === 2,
  );
  if (!items.length) return null;
  const mapped: BuildDiagnostic[] = items.slice(0, MAX_DIAGNOSTICS).map((diagnostic) => ({
    severity: diagnostic.severity === 1 ? 'error' : 'warning',
    message: diagnostic.message,
    file: basename(diagnostic.path || path),
    line: diagnostic.line + 1,
    column: diagnostic.character + 1,
  }));
  return {
    compiler: language === 'typst' ? 'typst' : 'latex',
    language,
    diagnostics: mapped,
    environment: [],
    log: '',
    summary: mapped[0].message,
  };
}

/**
 * Turn a compiler error string into the small structured model used by the
 * failed-build preview. The raw log stays available separately so the UI never
 * has to choose between readable diagnostics and full compiler output.
 */
export function parseBuildFailure(
  error: string,
  language: 'latex' | 'typst',
  path: string,
): BuildFailure {
  const raw = error.replace(/\r\n/g, '\n').trim();
  const compiler = compilerName(raw, language);
  let body = raw.replace(/^Compilation failed\.\s*/i, '');
  body = body
    .replace(/^[A-Za-z]+\s+compilation failed\s*\([^)]*\):\s*/i, '')
    .replace(/^[A-Za-z]+\s+compilation failed:\s*/i, '');
  body = body.replace(/\n?\s*(?:Showing source\.|Last preview retained\.)\s*$/i, '').trim();

  const log = body.trim().slice(0, MAX_LOG_CHARS);
  const diagnostics =
    language === 'typst' ? typstDiagnostics(log, path) : latexDiagnostics(log, path);
  const summary =
    diagnostics.find((diagnostic) => diagnostic.severity === 'error')?.message ||
    diagnostics[0]?.message ||
    'Build failed';

  return {
    compiler,
    language,
    diagnostics,
    environment: [],
    log,
    summary,
  };
}

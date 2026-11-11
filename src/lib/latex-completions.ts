import {
  snippetCompletion,
  type Completion,
  type CompletionResult,
  type CompletionSource,
} from '@codemirror/autocomplete';
import type { EditorState } from '@codemirror/state';
import bibliographyStylesJson from '../assets/latex-completions/bibliography-styles.json';
import commandsJson from '../assets/latex-completions/commands.json';
import environmentsJson from '../assets/latex-completions/environments.json';
import macrosJson from '../assets/latex-completions/macros.json';
import classNamesJson from '../assets/latex-completions/classnames.json';
import type { EditorLanguage } from './editor-lsp';
import {
  scanLatexBibItems,
  scanLatexCommandDefinitions,
  scanLatexEnvironmentDefinitions,
  scanLatexLabels,
  scanLatexPackages,
  type LatexProjectCommand,
  type LatexProjectMetadata,
} from './latex-project';
import { defaults as defaultPreferences } from './preferences';
import type { Delimiter } from './types';

type CompletionKind =
  | 'command'
  | 'environment'
  | 'package'
  | 'class'
  | 'symbol'
  | 'citation'
  | 'label'
  | 'file'
  | 'bibstyle';

type PackageMacro = string | [name: string, format?: string, snippet?: string, detail?: string];

interface PackageRecord {
  macros: PackageMacro[];
  envs: string[];
  deps: string[];
}

interface CommandRecord {
  snippet?: string;
  detail?: string;
  documentation?: string;
}

interface MacroRecord {
  name: string;
  arg?: { format?: string; snippet?: string };
  detail?: string;
  doc?: string;
}

interface EnvironmentRecord {
  name: string;
  arg?: { format?: string; snippet?: string };
}

interface NamedRecord {
  command?: string;
  detail?: string;
  documentation?: string;
}

interface LatexCompletion {
  label: string;
  detail?: string;
  documentation?: string;
  snippet?: string;
  kind: CompletionKind;
  boost: number;
  insertSuffix?: string;
}

const commands = commandsJson as Record<string, CommandRecord>;
const macros = macrosJson as MacroRecord[];
const environments = environmentsJson as EnvironmentRecord[];
const classNames = classNamesJson as Record<string, NamedRecord>;

/** Common environments missing from the upstream data, plus richer bodies. */
const extraEnvironments: EnvironmentRecord[] = [
  { name: 'abstract' },
  { name: 'figure' },
  { name: 'figure*' },
  { name: 'frame' },
  { name: 'table*' },
  { name: 'tikzpicture' },
];

const environmentBodies = new Map<string, string>([
  ['figure', '[${1}]\n\t\\centering\n\t${0}\n\t\\caption{${2}}\n\t\\label{${3}}\n'],
  ['figure*', '[${1}]\n\t\\centering\n\t${0}\n\t\\caption{${2}}\n\t\\label{${3}}\n'],
  ['frame', '{${1}}\n\t${0}\n'],
  [
    'table',
    '[${1}]\n\t\\centering\n\t\\begin{tabular}{${2}}\n\t\t${0}\n\t\\end{tabular}\n\t\\caption{${3}}\n\t\\label{${4}}\n',
  ],
  [
    'table*',
    '[${1}]\n\t\\centering\n\t\\begin{tabular}{${2}}\n\t\t${0}\n\t\\end{tabular}\n\t\\caption{${3}}\n\t\\label{${4}}\n',
  ],
  ['tikzpicture', '\n\t${0}\n'],
]);

const environmentRecords = [...environments, ...extraEnvironments];

const commonBoosts = new Map<string, number>([
  ['\\begin', 100],
  ['\\end', 99],
  ['\\section', 98],
  ['\\subsection', 97],
  ['\\label', 96],
  ['\\ref', 95],
  ['\\cite', 94],
  ['\\frac', 93],
  ['\\textbf', 92],
  ['\\emph', 91],
  ['\\item', 90],
  ['\\includegraphics', 89],
  ['\\caption', 88],
  ['\\documentclass', 87],
  ['\\usepackage', 86],
  ['\\left', 85],
  ['\\right', 84],
]);

/** Rank argument-taking commands such as `\frac{}{}` by their command name. */
function commandBoost(label: string): number {
  const command = /^\\[A-Za-z]+/.exec(label)?.[0];
  return command ? (commonBoosts.get(command) ?? 0) : 0;
}

const commandEntries = new Map<string, LatexCompletion>();
const environmentEntries: LatexCompletion[] = [];
const beginEnvironmentNames: LatexCompletion[] = [];
const packageEntries: LatexCompletion[] = [];
const classEntries: LatexCompletion[] = [];
let mathSymbols: LatexCompletion[] | undefined;
let packagesPromise: Promise<LatexCompletion[]> | undefined;
let packageCommandsPromise: Promise<Record<string, PackageRecord>> | undefined;
let mathSymbolsPromise: Promise<LatexCompletion[]> | undefined;

/** Convert VS Code-style snippet placeholders to CodeMirror snippet placeholders. */
export function toCodeMirrorSnippet(raw: string, prefix = ''): string {
  let snippet = raw.trim();
  if (prefix && !snippet.startsWith(prefix)) snippet = prefix + snippet;
  snippet = snippet.replace(/\$\{TM_SELECTED_TEXT\}/g, '');
  snippet = snippet.replace(/\$\{(\d+):[^}]*\}/g, '${$1}');
  snippet = snippet.replace(/\$(\d+)/g, '${$1}');
  return snippet.replace(/\$\{([^}]*)\}/g, (whole, name) => (/^\d+$/.test(name) ? whole : '${}'));
}

/** Build the body inserted after `\begin{name}`. */
function environmentBody(name: string, record: EnvironmentRecord): string {
  const configured = environmentBodies.get(name);
  if (configured) return configured;
  const raw = record.arg?.snippet;
  if (!raw) return '\n\t${0}\n';
  const snippet = toCodeMirrorSnippet(raw);
  if (snippet.startsWith('{') || snippet.startsWith('[')) {
    return `${snippet}\n\t\${0}\n`;
  }
  return `\n\t${snippet}\n`;
}

function makeBeginEnvironmentEntry(
  name: string,
  body: string,
  boost: number,
  detail = 'environment',
): LatexCompletion {
  return {
    label: name,
    detail,
    kind: 'environment',
    boost,
    snippet: `${name}}${body}\\end{${name}}`,
  };
}

function makeEnvironmentCommandEntry(
  name: string,
  body: string,
  boost: number,
  detail = 'environment',
): LatexCompletion {
  return {
    label: `\\begin{${name}}`,
    detail,
    kind: 'environment',
    boost,
    snippet: `\\begin{${name}}${body}\\end{${name}}`,
  };
}

/** Turn scanned command definitions into completion entries. */
function commandDefinitionEntries(
  commands: readonly LatexProjectCommand[],
  detail: string,
  boost: number,
): LatexCompletion[] {
  return commands.map(({ name, args }) => {
    const label = `\\${name}${'{}'.repeat(args)}`;
    const placeholders = Array.from({ length: args }, (_, index) => `{\${${index + 1}}}`).join('');
    return {
      label,
      detail,
      kind: 'command',
      boost,
      snippet: args ? `\\${name}${placeholders}` : undefined,
    };
  });
}

/** Commands defined in the current document, such as `\newcommand{\foo}[1]`. */
function documentCommandEntries(document: string): LatexCompletion[] {
  return commandDefinitionEntries(scanLatexCommandDefinitions(document), 'document command', 120);
}

/** Environments defined in the current document. */
function documentEnvironmentNames(document: string): string[] {
  return scanLatexEnvironmentDefinitions(document);
}

/** Environments still open at the cursor, most recently opened first. */
function openEnvironmentNames(document: string, position: number): string[] {
  const stack: string[] = [];
  for (const match of document.slice(0, position).matchAll(/\\(begin|end)\s*\{([^}]+)\}/g)) {
    const name = match[2].trim();
    if (!name) continue;
    if (match[1] === 'begin') {
      stack.push(name);
    } else {
      const index = stack.lastIndexOf(name);
      if (index >= 0) stack.splice(index, 1);
    }
  }
  return stack.reverse();
}

/** Package names used on other lines, matching Overleaf's behavior. */
function usedPackageNames(document: string, excludeLine: number): Set<string> {
  const used = new Set<string>();
  document.split('\n').forEach((line, index) => {
    if (index + 1 === excludeLine) return;
    for (const match of line.matchAll(
      /\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g,
    )) {
      for (const name of match[1].split(',')) {
        const trimmed = name.trim();
        if (trimmed) used.add(trimmed);
      }
    }
  });
  return used;
}

function addCommand(entry: LatexCompletion) {
  const previous = commandEntries.get(entry.label);
  if (!previous) {
    commandEntries.set(entry.label, entry);
    return;
  }
  commandEntries.set(entry.label, {
    ...previous,
    detail: previous.detail || entry.detail,
    documentation:
      (previous.documentation?.length ?? 0) >= (entry.documentation?.length ?? 0)
        ? previous.documentation
        : entry.documentation,
    snippet: previous.snippet ?? entry.snippet,
  });
}

for (const [name, record] of Object.entries(commands)) {
  const label = `\\${name}`;
  addCommand({
    label,
    detail: record.detail,
    documentation: record.documentation,
    snippet: record.snippet ? toCodeMirrorSnippet(record.snippet, '\\') : undefined,
    kind: 'command',
    boost: commandBoost(label),
  });
}

for (const macro of macros) {
  const label = `\\${macro.name}${macro.arg?.format ?? ''}`;
  addCommand({
    label,
    detail: macro.detail,
    documentation: macro.doc,
    snippet: macro.arg?.snippet ? toCodeMirrorSnippet(macro.arg.snippet, '\\') : undefined,
    kind: 'command',
    boost: commandBoost(label),
  });
}

for (const environment of environmentRecords) {
  const name = environment.name;
  const body = environmentBody(name, environment);
  const boost = commonBoosts.get(`\\begin{${name}}`) ?? 50;
  beginEnvironmentNames.push(makeBeginEnvironmentEntry(name, body, boost));
  environmentEntries.push(makeEnvironmentCommandEntry(name, body, boost));
}

for (const [name, record] of Object.entries(classNames)) {
  classEntries.push({
    label: name,
    detail: record.detail || 'document class',
    documentation: record.documentation,
    kind: 'class',
    boost: 0,
    insertSuffix: '}',
  });
}

function toPackageEntries(data: Record<string, NamedRecord>): LatexCompletion[] {
  return Object.entries(data).map(([name, record]) => ({
    label: name,
    detail: record.detail || 'package',
    documentation: record.documentation,
    kind: 'package' as const,
    boost: 0,
    insertSuffix: '}',
  }));
}

function toMathEntries(data: Record<string, NamedRecord>): LatexCompletion[] {
  return Object.entries(data).map(([name, record]) => ({
    label: `\\${name}`,
    detail: record.detail,
    documentation: record.documentation,
    kind: 'symbol' as const,
    boost: 0,
  }));
}

async function loadPackages(): Promise<LatexCompletion[]> {
  packagesPromise ??= import('../assets/latex-completions/packagenames.json')
    .then((module) => {
      packageEntries.push(...toPackageEntries(module.default as Record<string, NamedRecord>));
      return packageEntries;
    })
    .catch((error) => {
      console.warn('Could not load LaTeX package names:', error);
      return [];
    });
  return packagesPromise;
}

async function loadMathSymbols(): Promise<LatexCompletion[]> {
  mathSymbolsPromise ??= import('../assets/latex-completions/unimathsymbols.json')
    .then((module) => {
      mathSymbols = toMathEntries(module.default as Record<string, NamedRecord>);
      return mathSymbols;
    })
    .catch((error) => {
      console.warn('Could not load LaTeX math symbols:', error);
      return [];
    });
  return mathSymbolsPromise;
}

async function loadPackageCommands(): Promise<Record<string, PackageRecord>> {
  packageCommandsPromise ??= import('../assets/latex-completions/package-commands.json')
    .then((module) => module.default as unknown as Record<string, PackageRecord>)
    .catch((error) => {
      console.warn('Could not load LaTeX package commands:', error);
      return {};
    });
  return packageCommandsPromise;
}

/** Build CodeMirror placeholders from a LaTeX-Workshop argument format. */
function formatToSnippet(name: string, format: string): string {
  let snippet = `\\${name}`;
  let index = 0;
  for (let position = 0; position < format.length; position++) {
    const open = format[position];
    const close = format[position + 1];
    if ((open === '{' && close === '}') || (open === '[' && close === ']')) {
      snippet += `${open}\${${++index}}${close}`;
      position++;
    } else {
      snippet += open;
    }
  }
  return snippet;
}

interface PackageCompletions {
  commands: LatexCompletion[];
  beginEnvironments: LatexCompletion[];
  environmentCommands: LatexCompletion[];
}

const packageCompletionCache = new Map<string, PackageCompletions>();

async function packageCompletionEntries(
  packageNames: readonly string[],
): Promise<PackageCompletions> {
  const cacheKey = [...new Set(packageNames)].sort().join('\0');
  const cached = packageCompletionCache.get(cacheKey);
  if (cached) return cached;
  const result: PackageCompletions = {
    commands: [],
    beginEnvironments: [],
    environmentCommands: [],
  };
  if (!packageNames.length) {
    packageCompletionCache.set(cacheKey, result);
    return result;
  }
  const data = await loadPackageCommands();
  const visitedPackages = new Set<string>();
  const seenCommands = new Set<string>();
  const seenEnvironments = new Set<string>();

  const visit = (packageName: string, depth: number) => {
    if (depth > 16 || visitedPackages.has(packageName)) return;
    visitedPackages.add(packageName);
    const record = data[packageName];
    if (!record) return;
    for (const dependency of record.deps) visit(dependency, depth + 1);
    for (const raw of record.macros) {
      const [name, format = '', snippet = ''] = typeof raw === 'string' ? [raw] : raw;
      if (!name) continue;
      const label = `\\${name}${format}`;
      if (commandEntries.has(label) || seenCommands.has(label)) continue;
      seenCommands.add(label);
      result.commands.push({
        label,
        detail: `package ${packageName}`,
        kind: 'command',
        boost: 60,
        snippet: snippet
          ? toCodeMirrorSnippet(snippet, '\\')
          : format
            ? formatToSnippet(name, format)
            : undefined,
      });
    }
    for (const environment of record.envs) {
      if (!environment || seenEnvironments.has(environment)) continue;
      if (beginEnvironmentNames.some((entry) => entry.label === environment)) continue;
      seenEnvironments.add(environment);
      const body = '\n\t${0}\n';
      result.beginEnvironments.push(
        makeBeginEnvironmentEntry(environment, body, 40, `package ${packageName}`),
      );
      result.environmentCommands.push(
        makeEnvironmentCommandEntry(environment, body, 40, `package ${packageName}`),
      );
    }
  };

  for (const packageName of packageNames) visit(packageName, 0);
  packageCompletionCache.set(cacheKey, result);
  return result;
}

const bibliographyStyleBoosts = new Map<string, number>([
  ['plain', 9],
  ['unsrt', 8],
  ['alpha', 7],
  ['abbrv', 6],
  ['apalike', 5],
  ['plainnat', 4],
  ['unsrtnat', 3],
  ['abbrvnat', 2],
]);

const bibliographyStyleEntries: LatexCompletion[] = (bibliographyStylesJson as string[]).map(
  (label) => ({
    label,
    detail: 'bibliography style',
    kind: 'bibstyle',
    boost: bibliographyStyleBoosts.get(label) ?? 0,
    insertSuffix: '}',
  }),
);

const COMPLETION_LIMIT = 300;

function selectEntries(
  entries: readonly LatexCompletion[],
  prefix: string,
  limit = COMPLETION_LIMIT,
): { selected: LatexCompletion[]; complete: boolean } {
  const query = prefix.toLocaleLowerCase();
  const matches = query
    ? entries.filter((entry) => entry.label.toLocaleLowerCase().startsWith(query))
    : entries;
  const seen = new Set<string>();
  const selected: LatexCompletion[] = [];
  for (const entry of matches
    .slice()
    .sort((left, right) => right.boost - left.boost || left.label.localeCompare(right.label))) {
    if (seen.has(entry.label)) continue;
    seen.add(entry.label);
    selected.push(entry);
    if (selected.length >= limit) break;
  }
  return { selected, complete: selected.length < limit };
}

function completionType(kind: CompletionKind): string {
  switch (kind) {
    case 'command':
      return 'keyword';
    case 'environment':
      return 'function';
    case 'package':
      return 'namespace';
    case 'class':
      return 'class';
    case 'symbol':
      return 'constant';
    case 'citation':
    case 'label':
    case 'file':
      return 'text';
    case 'bibstyle':
      return 'namespace';
  }
}

function kindGlyph(kind: CompletionKind): string {
  switch (kind) {
    case 'command':
      return '\\';
    case 'environment':
      return '⌘';
    case 'package':
      return '▦';
    case 'class':
      return 'T';
    case 'symbol':
      return '∑';
    case 'citation':
      return '❝';
    case 'label':
      return '⚓';
    case 'file':
      return '▤';
    case 'bibstyle':
      return '≡';
  }
}

function createInfo(entry: LatexCompletion): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'completion-details completion-card';

  const header = document.createElement('div');
  header.className = 'completion-card-header';
  const glyph = document.createElement('span');
  glyph.className = 'completion-card-glyph';
  glyph.textContent = kindGlyph(entry.kind);
  glyph.setAttribute('aria-hidden', 'true');

  const identity = document.createElement('div');
  identity.className = 'completion-card-identity';
  const kind = document.createElement('div');
  kind.className = 'completion-card-kind';
  kind.textContent = entry.kind;
  const title = document.createElement('div');
  title.className = 'completion-details-title';
  title.textContent = entry.label;
  identity.append(kind, title);
  header.append(glyph, identity);
  panel.append(header);

  if (entry.detail || entry.documentation) {
    const section = document.createElement('div');
    section.className = 'completion-documentation-section';
    const heading = document.createElement('span');
    heading.className = 'completion-function-section-title';
    heading.textContent = 'Details';
    section.append(heading);
    const body = document.createElement('div');
    body.className = 'completion-detail-scroll';
    const documentation = document.createElement('div');
    documentation.className = 'completion-documentation completion-plain-text';
    documentation.textContent = [entry.detail, entry.documentation].filter(Boolean).join('\n\n');
    body.append(documentation);
    section.append(body);
    panel.append(section);
  }

  const source = document.createElement('div');
  source.className = 'completion-details-source';
  source.textContent = 'LaTeX-Workshop data · MIT';
  panel.append(source);
  return panel;
}

function toCompletion(entry: LatexCompletion, applyName: boolean): Completion {
  let completion: Completion = {
    label: entry.label,
    type: completionType(entry.kind),
    detail: entry.detail,
    boost: entry.boost,
    info: () => createInfo(entry),
  };
  if (entry.snippet) {
    completion = snippetCompletion(entry.snippet, completion);
  } else if (applyName && entry.insertSuffix) {
    completion = {
      ...completion,
      apply: (view, _completion, from, to) => {
        const suffix = entry.insertSuffix!;
        const extendClosingBrace = suffix === '}' && view.state.doc.sliceString(to, to + 1) === '}';
        view.dispatch({
          changes: {
            from,
            to: extendClosingBrace ? to + 1 : to,
            insert: extendClosingBrace ? entry.label : `${entry.label}${suffix}`,
          },
        });
      },
    };
  }
  return completion;
}

function result(
  from: number,
  entries: readonly LatexCompletion[],
  prefix: string,
  applyName: boolean,
  validFor: RegExp,
): CompletionResult | null {
  const { selected, complete } = selectEntries(entries, prefix);
  if (!selected.length) return null;
  return {
    from,
    options: selected.map((entry) => toCompletion(entry, applyName)),
    // A truncated list cannot safely answer longer prefixes. Without this,
    // CodeMirror filters the old short list instead of asking for the now
    // more specific prefix, which can hide ordinary commands such as \frac.
    ...(complete ? { validFor } : {}),
  };
}

/** Complete a comma-separated argument, excluding keys already in the list. */
function argumentResult(
  from: number,
  entries: readonly LatexCompletion[],
  argument: string,
  applyName: boolean,
  validFor: RegExp,
): CompletionResult | null {
  const comma = argument.lastIndexOf(',');
  const raw = comma >= 0 ? argument.slice(comma + 1) : argument;
  const prefix = raw.trimStart();
  const existing =
    comma >= 0
      ? argument
          .slice(0, comma)
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      : [];
  const available = existing.length
    ? entries.filter((entry) => !existing.includes(entry.label))
    : entries;
  return result(from + argument.length - prefix.length, available, prefix, applyName, validFor);
}

function stringEntries(
  values: readonly string[],
  kind: CompletionKind,
  detail: string,
): LatexCompletion[] {
  return values.map((label) => ({
    label,
    detail,
    kind,
    boost: 0,
    insertSuffix: '}',
  }));
}

function projectFileEntries(
  files: readonly { path: string; directory: boolean }[],
  extensions: RegExp,
  stripExtension?: RegExp,
): LatexCompletion[] {
  return files
    .filter((file) => !file.directory && extensions.test(file.path))
    .map((file) => ({
      label: stripExtension ? file.path.replace(stripExtension, '') : file.path,
      detail: 'file',
      kind: 'file' as const,
      boost: 0,
      insertSuffix: '}',
    }));
}

/** Full command completions such as `\input{chapter}` for project files. */
function projectFileCommandEntries(
  files: readonly { path: string; directory: boolean }[],
): LatexCompletion[] {
  const entries: LatexCompletion[] = [];
  for (const file of files) {
    if (file.directory) continue;
    if (/\.(?:tex|txt)$/i.test(file.path)) {
      const target = file.path.replace(/\.tex$/i, '');
      for (const command of ['input', 'include', 'subfile']) {
        entries.push({
          label: `\\${command}{${target}}`,
          detail: 'file command',
          kind: 'command',
          boost: 20,
        });
      }
    } else if (/\.(?:pdf|png|jpe?g|eps|ps|svg|bmp|tiff?)$/i.test(file.path)) {
      entries.push({
        label: `\\includegraphics{${file.path}}`,
        detail: 'file command',
        kind: 'command',
        boost: 20,
      });
    } else if (/\.bib$/i.test(file.path)) {
      entries.push({
        label: `\\bibliography{${file.path.replace(/\.bib$/i, '')}}`,
        detail: 'file command',
        kind: 'command',
        boost: 20,
      });
    }
  }
  return entries;
}

const standardMathDelimiters: readonly Delimiter[] = defaultPreferences.delimiters;

function startsBareBracketBlock(document: string, position: number): boolean {
  const lineStart = document.lastIndexOf('\n', position - 1) + 1;
  return !/[^ \t]/.test(document.slice(lineStart, position));
}

function delimiterOpensAt(document: string, position: number, delimiter: Delimiter): boolean {
  if (!document.startsWith(delimiter.left, position)) return false;
  // Bare brackets are block math: mirror the renderer, which leaves Markdown
  // links and brackets in running prose alone.
  return (
    !(delimiter.left === '[' && delimiter.right === ']' && delimiter.display) ||
    startsBareBracketBlock(document, position)
  );
}

/** Return whether the cursor is inside Markdown/LaTeX math delimiters. */
export function isInMath(
  document: string,
  position: number,
  delimiters: readonly Delimiter[] = standardMathDelimiters,
): boolean {
  const pairs = delimiters
    .filter((delimiter) => delimiter.left && delimiter.right)
    .slice()
    .sort((left, right) => right.left.length - left.left.length);
  let open: Delimiter | null = null;
  let fence = '';
  let lineStart = true;
  for (let index = 0; index < position; index++) {
    if (lineStart) {
      const lineEnd = document.indexOf('\n', index);
      const end = lineEnd < 0 ? document.length : lineEnd;
      const line = document.slice(index, end);
      const marker = /^\s*(`{3,}|~{3,})/.exec(line);
      if (marker) {
        const character = marker[1][0];
        if (!fence) fence = character;
        else if (fence === character) fence = '';
        index = end;
        lineStart = true;
        continue;
      }
      lineStart = false;
    }
    if (fence) {
      if (document[index] === '\n') lineStart = true;
      continue;
    }
    const character = document[index];
    if (character === '`') {
      const close = document.indexOf('`', index + 1);
      if (close >= 0 && close < position) {
        index = close;
        continue;
      }
    }

    if (open) {
      const closes =
        (character !== '\\' || open.right.startsWith('\\')) &&
        document.startsWith(open.right, index);
      if (closes) {
        index += open.right.length - 1;
        open = null;
      } else if (character === '\\') {
        index++;
      } else if (character === '\n') {
        lineStart = true;
      }
      continue;
    }

    if (character === '\\') {
      const opener = pairs.find((delimiter) => delimiterOpensAt(document, index, delimiter));
      if (opener) {
        open = opener;
        index += opener.left.length - 1;
      } else {
        index++;
      }
      continue;
    }

    const opener = pairs.find((delimiter) => delimiterOpensAt(document, index, delimiter));
    if (opener) {
      open = opener;
      index += opener.left.length - 1;
      continue;
    }
    if (character === '\n') lineStart = true;
  }
  return open !== null;
}

function linePrefix(state: EditorState, position: number): string {
  const line = state.doc.lineAt(position);
  return line.text.slice(0, position - line.from);
}

const verbatimEnvironments = new Set(['verbatim', 'Verbatim', 'lstlisting', 'minted', 'comment']);

function isInVerbatim(document: string, position: number): boolean {
  let open: string | null = null;
  for (const match of document.slice(0, position).matchAll(/\\(begin|end)\{([^}]+)\}/g)) {
    const name = match[2].trim();
    if (!verbatimEnvironments.has(name)) continue;
    if (match[1] === 'begin') open = name;
    else if (open === name) open = null;
  }
  return open !== null;
}

function matchesCommand(before: string): RegExpExecArray | null {
  const match = /\\[A-Za-z]*$/.exec(before);
  if (!match) return null;
  if (match.index > 0 && before[match.index - 1] === '\\') return null;
  return match;
}

/** Merge completion sources, preferring the local LaTeX source when it has data. */
export function combineCompletionSources(
  sources: CompletionSource[],
  preferred?: CompletionSource,
): CompletionSource {
  return async (context) => {
    const answers = (
      await Promise.all(sources.map(async (source) => ({ source, answer: await source(context) })))
    ).filter(
      (entry): entry is { source: CompletionSource; answer: CompletionResult } =>
        entry.answer !== null,
    );
    if (!answers.length) return null;
    if (answers.length === 1) return answers[0].answer;

    const preferredAnswer = answers.find((entry) => entry.source === preferred)?.answer;
    if (preferredAnswer) return preferredAnswer;

    // Different sources can use different replacement ranges. Merge answers
    // that agree on the range, then keep the largest compatible option set.
    const groups = new Map<
      number,
      { result: CompletionResult; options: Completion[]; seen: Set<string> }
    >();
    for (const { answer } of answers) {
      const existing = groups.get(answer.from);
      if (!existing) {
        groups.set(answer.from, {
          result: answer,
          options: [...answer.options],
          seen: new Set(answer.options.map((option) => option.label)),
        });
        continue;
      }
      for (const option of answer.options) {
        if (existing.seen.has(option.label)) continue;
        existing.seen.add(option.label);
        existing.options.push(option);
      }
    }
    const winner = [...groups.values()].sort(
      (left, right) => right.options.length - left.options.length,
    )[0];
    return { ...winner.result, options: winner.options };
  };
}

export function createLatexCompletionSource(
  language: EditorLanguage,
  getDelimiters: () => readonly Delimiter[] = () => standardMathDelimiters,
  getProject?: () => LatexProjectMetadata | undefined,
): CompletionSource {
  if (language !== 'latex' && language !== 'markdown') return () => null;
  return async (context) => {
    const document = context.state.doc.toString();
    const math = language === 'markdown' ? isInMath(document, context.pos, getDelimiters()) : false;
    if (language === 'markdown' && !math) return null;
    const before = linePrefix(context.state, context.pos);
    if (language === 'latex' && (/(^|[^\\])%/.test(before) || isInVerbatim(document, context.pos)))
      return null;
    const project = language === 'latex' ? getProject?.() : undefined;
    const definedCommands = language === 'latex' ? documentCommandEntries(document) : [];
    const definedEnvironments = language === 'latex' ? documentEnvironmentNames(document) : [];
    const definedBeginEntries = definedEnvironments.map((name) =>
      makeBeginEnvironmentEntry(name, '\n\t${0}\n', 120, 'document environment'),
    );
    const definedEnvironmentCommands = definedEnvironments.map((name) =>
      makeEnvironmentCommandEntry(name, '\n\t${0}\n', 120, 'document environment'),
    );
    const projectCommands =
      language === 'latex'
        ? commandDefinitionEntries(project?.commands ?? [], 'project command', 120)
        : [];
    const projectEnvironments = language === 'latex' ? (project?.environments ?? []) : [];
    const projectBeginEntries = projectEnvironments.map((name) =>
      makeBeginEnvironmentEntry(name, '\n\t${0}\n', 110, 'project environment'),
    );
    const projectEnvironmentCommands = projectEnvironments.map((name) =>
      makeEnvironmentCommandEntry(name, '\n\t${0}\n', 110, 'project environment'),
    );
    const packageNames =
      language === 'latex'
        ? [...new Set([...scanLatexPackages(document), ...(project?.packages ?? [])])]
        : [];

    const begin = /\\begin\{([^}]*)$/.exec(before);
    if (begin && !(begin.index > 0 && before[begin.index - 1] === '\\')) {
      const packageCompletions = await packageCompletionEntries(packageNames);
      return result(
        context.pos - begin[1].length,
        [
          ...beginEnvironmentNames,
          ...definedBeginEntries,
          ...projectBeginEntries,
          ...packageCompletions.beginEnvironments,
        ],
        begin[1],
        true,
        /^[^}]*$/,
      );
    }

    const end = /\\end\{([^}]*)$/.exec(before);
    if (end && !(end.index > 0 && before[end.index - 1] === '\\')) {
      const from = context.pos - end[1].length;
      const entries = openEnvironmentNames(document, context.pos).map((name, index) => ({
        label: name,
        detail: 'open environment',
        kind: 'environment' as const,
        boost: 10 + index,
        insertSuffix: '}',
      }));
      // Returning an empty preferred result suppresses unrelated language-server
      // environment names: only environments that are actually open can be closed.
      return result(from, entries, end[1], true, /^[^}]*$/) ?? { from, options: [] };
    }

    const citation = /\\(?:[A-Za-z]*cite[A-Za-z]*|nocite)\*?(?:\[[^\]]*\])*\{([^}]*)$/i.exec(
      before,
    );
    if (citation) {
      const keys = [
        ...new Set([
          ...(language === 'latex' ? scanLatexBibItems(document) : []),
          ...(project?.citations ?? []),
        ]),
      ];
      if (keys.length) {
        const citations = argumentResult(
          context.pos - citation[1].length,
          stringEntries(keys, 'citation', 'citation key'),
          citation[1],
          true,
          /^[^},]*$/,
        );
        if (citations) return citations;
      }
    }

    const reference =
      /\\(?:ref|pageref|eqref|autoref|cref|Cref|vref|Vref|nameref|cpageref|Cpageref|labelcref|subref|Subref)\*?(?:\[[^\]]*\])?\{([^}]*)$/i.exec(
        before,
      );
    if (reference) {
      const labels = [
        ...new Set([
          ...(language === 'latex' ? scanLatexLabels(document) : []),
          ...(project?.labels ?? []),
        ]),
      ];
      if (labels.length) {
        const references = argumentResult(
          context.pos - reference[1].length,
          stringEntries(labels, 'label', 'label'),
          reference[1],
          true,
          /^[^},]*$/,
        );
        if (references) return references;
      }
    }

    const input = /\\(?:input|include|subfile)\*?\{([^}]*)$/.exec(before);
    if (input && project?.files.length) {
      const entries = projectFileEntries(project.files, /\.(?:tex|txt)$/i, /\.tex$/i);
      const includes = argumentResult(
        context.pos - input[1].length,
        entries,
        input[1],
        true,
        /^[^}]*$/,
      );
      if (includes) return includes;
    }

    const graphics =
      /\\(?:includegraphics|includesvg|includepdf)\*?(?:\[[^\]]*\])*\{([^}]*)$/i.exec(before);
    if (graphics && project?.files.length) {
      const entries = projectFileEntries(
        project.files,
        /\.(?:pdf|png|jpe?g|eps|ps|svg|bmp|tiff?)$/i,
      );
      const images = argumentResult(
        context.pos - graphics[1].length,
        entries,
        graphics[1],
        true,
        /^[^}]*$/,
      );
      if (images) return images;
    }

    const bibliography = /\\(bibliography|addbibresource)\*?(?:\[[^\]]*\])?\{([^}]*)$/.exec(before);
    if (bibliography && project?.files.length) {
      const entries = projectFileEntries(
        project.files,
        /\.bib$/i,
        bibliography[1] === 'bibliography' ? /\.bib$/i : undefined,
      );
      const bibliographies = argumentResult(
        context.pos - bibliography[2].length,
        entries,
        bibliography[2],
        true,
        /^[^},]*$/,
      );
      if (bibliographies) return bibliographies;
    }

    const bibliographyStyle = /\\bibliographystyle\*?\{([^}]*)$/.exec(before);
    if (bibliographyStyle) {
      return result(
        context.pos - bibliographyStyle[1].length,
        bibliographyStyleEntries,
        bibliographyStyle[1],
        true,
        /^[^}]*$/,
      );
    }

    const usePackage = /\\(?:usepackage|RequirePackage)(?:\[[^\]]*\])?\{([^}]*)$/.exec(before);
    if (usePackage && !(usePackage.index > 0 && before[usePackage.index - 1] === '\\')) {
      const used = usedPackageNames(document, context.state.doc.lineAt(context.pos).number);
      const entries = (await loadPackages()).filter((entry) => !used.has(entry.label));
      return argumentResult(
        context.pos - usePackage[1].length,
        entries,
        usePackage[1],
        true,
        /^[^},]*$/,
      );
    }

    const documentClass = /\\documentclass(?:\[[^\]]*\])?\{([^}]*)$/.exec(before);
    if (documentClass && !(documentClass.index > 0 && before[documentClass.index - 1] === '\\')) {
      return result(
        context.pos - documentClass[1].length,
        classEntries,
        documentClass[1],
        true,
        /^[^}]*$/,
      );
    }

    const command = matchesCommand(before);
    if (!command) return null;
    const commandPrefix = command[0].toLocaleLowerCase();
    const packageCompletions = await packageCompletionEntries(packageNames);
    const projectFileCommands = project?.files.length
      ? projectFileCommandEntries(project.files).filter((entry) =>
          entry.label.toLocaleLowerCase().startsWith(commandPrefix),
        )
      : [];
    const projectPackageCommands =
      commandPrefix.startsWith('\\usep') || commandPrefix.startsWith('\\requi')
        ? (project?.packages ?? []).map((name) => ({
            label: `\\usepackage{${name}}`,
            detail: 'project package',
            kind: 'command' as const,
            boost: 10,
          }))
        : [];
    const entries = [
      ...definedCommands,
      ...projectCommands,
      ...packageCompletions.commands,
      ...commandEntries.values(),
      ...environmentEntries,
      ...definedEnvironmentCommands,
      ...projectEnvironmentCommands,
      ...packageCompletions.environmentCommands,
      ...projectFileCommands,
      ...projectPackageCommands,
    ];
    if (language === 'latex' || math) entries.push(...(await loadMathSymbols()));
    return result(context.pos - command[0].length, entries, command[0], false, /^\\[A-Za-z]*$/);
  };
}

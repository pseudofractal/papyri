import {
  snippetCompletion,
  type Completion,
  type CompletionResult,
  type CompletionSource,
} from '@codemirror/autocomplete';
import commandsJson from '../assets/latex-completions/commands.json';
import environmentsJson from '../assets/latex-completions/environments.json';
import macrosJson from '../assets/latex-completions/macros.json';
import classNamesJson from '../assets/latex-completions/classnames.json';
import type { EditorLanguage } from './editor-lsp';
import type { EditorState } from '@codemirror/state';

type CompletionKind = 'command' | 'environment' | 'package' | 'class' | 'symbol';

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

const commandEntries = new Map<string, LatexCompletion>();
const environmentEntries: LatexCompletion[] = [];
const environmentNames: LatexCompletion[] = [];
const packageEntries: LatexCompletion[] = [];
const classEntries: LatexCompletion[] = [];
let mathSymbols: LatexCompletion[] | undefined;
let packagesPromise: Promise<LatexCompletion[]> | undefined;
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
    boost: commonBoosts.get(label) ?? 0,
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
    boost: commonBoosts.get(label) ?? 0,
  });
}

for (const environment of environments) {
  const name = environment.name;
  environmentNames.push({
    label: name,
    detail: 'environment',
    kind: 'environment',
    boost: commonBoosts.get(`\\begin{${name}}`) ?? 50,
    insertSuffix: '}',
  });
  environmentEntries.push({
    label: `\\begin{${name}}`,
    detail: 'environment',
    kind: 'environment',
    boost: commonBoosts.get(`\\begin{${name}}`) ?? 50,
    snippet: `\\begin{${name}}\n\t\${0}\n\\end{${name}}`,
  });
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

function selectEntries(
  entries: readonly LatexCompletion[],
  prefix: string,
  limit = 300,
): LatexCompletion[] {
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
  return selected;
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
        view.dispatch({ changes: { from, to, insert: `${entry.label}${entry.insertSuffix}` } });
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
  const selected = selectEntries(entries, prefix);
  if (!selected.length) return null;
  return {
    from,
    options: selected.map((entry) => toCompletion(entry, applyName)),
    validFor,
  };
}

/** Return whether the cursor is inside Markdown/LaTeX math delimiters. */
export function isInMath(document: string, position: number): boolean {
  let math: 'none' | 'inline' | 'display' = 'none';
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
    if (character === '\\') {
      const next = document[index + 1];
      if (next === '$') {
        index++;
        continue;
      }
      if (next === '(') {
        math = 'inline';
        index++;
        continue;
      }
      if (next === '[') {
        math = 'display';
        index++;
        continue;
      }
      if (next === ')' || next === ']') {
        math = 'none';
        index++;
        continue;
      }
      index++;
      continue;
    }
    if (character === '`') {
      const close = document.indexOf('`', index + 1);
      if (close >= 0 && close < position) {
        index = close;
        continue;
      }
    }
    if (character === '$') {
      if (document[index + 1] === '$') {
        math = math === 'display' ? 'none' : 'display';
        index++;
      } else if (math === 'none') {
        math = 'inline';
      } else if (math === 'inline') {
        math = 'none';
      }
      continue;
    }
    if (character === '\n') lineStart = true;
  }
  return math !== 'none';
}

function linePrefix(state: EditorState, position: number): string {
  const line = state.doc.lineAt(position);
  return line.text.slice(0, position - line.from);
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

export function createLatexCompletionSource(language: EditorLanguage): CompletionSource {
  if (language !== 'latex' && language !== 'markdown') return () => null;
  return async (context) => {
    const document = context.state.doc.toString();
    const math = language === 'markdown' ? isInMath(document, context.pos) : false;
    if (language === 'markdown' && !math) return null;
    const before = linePrefix(context.state, context.pos);

    const begin = /\\begin\{([^}]*)$/.exec(before);
    if (begin && !(begin.index > 0 && before[begin.index - 1] === '\\')) {
      return result(context.pos - begin[1].length, environmentNames, begin[1], true, /^[^}]*$/);
    }

    const end = /\\end\{([^}]*)$/.exec(before);
    if (end && !(end.index > 0 && before[end.index - 1] === '\\')) {
      return result(context.pos - end[1].length, environmentNames, end[1], true, /^[^}]*$/);
    }

    const usePackage = /\\usepackage(?:\[[^\]]*\])?\{([^}]*)$/.exec(before);
    if (usePackage && !(usePackage.index > 0 && before[usePackage.index - 1] === '\\')) {
      return result(
        context.pos - usePackage[1].length,
        await loadPackages(),
        usePackage[1],
        true,
        /^[^}]*$/,
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
    const entries = [...commandEntries.values(), ...environmentEntries];
    if (language === 'latex' || math) entries.push(...(await loadMathSymbols()));
    return result(context.pos - command[0].length, entries, command[0], false, /^\\[A-Za-z]*$/);
  };
}

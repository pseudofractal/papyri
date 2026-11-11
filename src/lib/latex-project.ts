import { normalize, relativeProjectPath } from './paths';
import type { Entry, Source } from './types';

export interface LatexProjectFile {
  path: string;
  directory: boolean;
}

export interface LatexProjectCommand {
  name: string;
  args: number;
}

export interface LatexProjectMetadata {
  labels: string[];
  citations: string[];
  citedKeys: Record<string, number>;
  packages: string[];
  commands: LatexProjectCommand[];
  environments: string[];
  files: LatexProjectFile[];
}

export interface LatexProjectOptions {
  /** Unsaved editor text takes precedence over the file on disk. */
  draftText?: (path: string) => string | undefined;
}

const MAX_PROJECT_FILES = 1500;
const MAX_PROJECT_DEPTH = 20;
const MAX_PROJECT_TEXT_LENGTH = 2 * 1024 * 1024;
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  '.obsidian',
  '.vscode',
  '.idea',
  '.cache',
  '.pytest_cache',
  '.ruff_cache',
  '__pycache__',
  'node_modules',
  'target',
  'dist',
  'build',
  'out',
]);

/** Remove TeX comments while preserving escaped percent signs. */
export function stripLatexComments(text: string): string {
  return text.replace(/(^|[^\\])%.*$/gm, '$1');
}

export function scanLatexLabels(text: string): string[] {
  const labels = new Set<string>();
  const source = stripLatexComments(text);
  for (const match of source.matchAll(/\\label\{([^}]+)\}/g)) {
    const label = match[1].trim();
    if (label) labels.add(label);
  }
  for (const match of source.matchAll(/\blabel=\{?([^\s},\]]+)/g)) {
    const label = match[1].trim();
    if (label) labels.add(label);
  }
  return [...labels];
}

export function scanLatexBibItems(text: string): string[] {
  const keys = new Set<string>();
  for (const match of stripLatexComments(text).matchAll(/\\bibitem(?:\[[^\]]*\])?\{([^}]+)\}/g)) {
    const key = match[1].trim();
    if (key) keys.add(key);
  }
  return [...keys];
}

/** Citation keys used by `\cite`-family commands in a TeX document. */
export function scanLatexCitedKeys(text: string): string[] {
  return [...countLatexCitedKeys(text).keys()];
}

/** Count every citation occurrence per key across `\cite`-family commands. */
export function countLatexCitedKeys(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const match of stripLatexComments(text).matchAll(
    /\\(?:[A-Za-z]*cite[A-Za-z]*|nocite)\*?(?:\[[^\]]*\])*\{([^}]*)\}/g,
  )) {
    for (const key of match[1].split(',')) {
      const trimmed = key.trim();
      if (trimmed) counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
    }
  }
  return counts;
}

export function scanLatexBibKeys(text: string): string[] {
  const keys = new Set<string>();
  for (const match of text.matchAll(/@(?!string\b|comment\b|preamble\b)\w+\s*\{\s*([^,\s{}]+)/gi)) {
    const key = match[1].trim();
    if (key) keys.add(key);
  }
  return [...keys];
}

export function scanLatexPackages(text: string): string[] {
  const packages = new Set<string>();
  for (const match of stripLatexComments(text).matchAll(
    /\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g,
  )) {
    for (const name of match[1].split(',')) {
      const packageName = name.trim();
      if (packageName) packages.add(packageName);
    }
  }
  return [...packages];
}

export function scanLatexCommandDefinitions(text: string): LatexProjectCommand[] {
  const commands = new Map<string, number>();
  const source = stripLatexComments(text);
  const add = (name: string, args = 0) => {
    if (!name) return;
    const argumentCount = Math.min(9, Math.max(0, args));
    commands.set(name, Math.max(commands.get(name) ?? 0, argumentCount));
  };
  for (const match of source.matchAll(
    /\\(?:newcommand|renewcommand|providecommand)\*?\s*\{?\s*\\([A-Za-z@]+)\s*\}?(?:\s*\[(\d+)\])?/g,
  )) {
    add(match[1], Number(match[2] ?? 0));
  }
  for (const match of source.matchAll(
    /\\(?:DeclareMathOperator|DeclareRobustCommand)\*?\s*\{?\s*\\([A-Za-z@]+)/g,
  )) {
    add(match[1]);
  }
  for (const match of source.matchAll(/\\def\s*\\([A-Za-z@]+)/g)) add(match[1]);
  for (const match of source.matchAll(
    /\\NewDocumentCommand\s*\{?\s*\\([A-Za-z@]+)\s*\}?\s*\{([^}]*)\}/g,
  )) {
    add(match[1], match[2].replace(/[^a-zA-Z]/g, '').length);
  }
  return [...commands].map(([name, args]) => ({ name, args }));
}

export function scanLatexEnvironmentDefinitions(text: string): string[] {
  const names = new Set<string>();
  const source = stripLatexComments(text);
  for (const match of source.matchAll(/\\newenvironment\*?\s*\{([^}]+)\}/g)) {
    const name = match[1].trim();
    if (name) names.add(name);
  }
  for (const match of source.matchAll(/\\newtheorem\*?\s*\{([^}]+)\}/g)) {
    const name = match[1].trim();
    if (name) names.add(name);
  }
  return [...names];
}

function isLatexSource(path: string): boolean {
  return /\.(?:tex|ltx)$/i.test(path);
}

function isBibSource(path: string): boolean {
  return /\.bib$/i.test(path);
}

function addUnique<T>(set: Set<T>, values: Iterable<T>) {
  for (const value of values) set.add(value);
}

/**
 * Collect the completion metadata Overleaf normally gets from its project
 * server: labels, citations, packages, document definitions, and a file tree.
 */
export async function loadLatexProject(
  source: Source,
  root: string,
  options: LatexProjectOptions = {},
): Promise<LatexProjectMetadata> {
  const normalizedRoot = normalize(root);
  const files: LatexProjectFile[] = [];
  const labels = new Set<string>();
  const citations = new Set<string>();
  const citedKeys = new Map<string, number>();
  const packages = new Set<string>();
  const commands = new Map<string, number>();
  const environments = new Set<string>();

  const readText = async (path: string): Promise<string | undefined> => {
    const draft = options.draftText?.(path);
    if (draft !== undefined) return draft;
    try {
      if (source.readText) return await source.readText(path);
      return (await source.read(path)).text;
    } catch {
      return undefined;
    }
  };

  const walk = async (directory: string, depth: number) => {
    if (depth > MAX_PROJECT_DEPTH || files.length >= MAX_PROJECT_FILES) return;
    let entries: Entry[];
    try {
      entries = await source.list(directory);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= MAX_PROJECT_FILES) return;
      files.push({
        path: relativeProjectPath(normalizedRoot, entry.path),
        directory: entry.directory,
      });
      if (entry.directory) {
        if (entry.symlink || IGNORED_DIRECTORIES.has(entry.name)) continue;
        await walk(entry.path, depth + 1);
        continue;
      }
      if (!isLatexSource(entry.path) && !isBibSource(entry.path)) continue;
      const text = await readText(entry.path);
      if (text === undefined || text.length > MAX_PROJECT_TEXT_LENGTH) continue;
      if (isBibSource(entry.path)) {
        addUnique(citations, scanLatexBibKeys(text));
        continue;
      }
      addUnique(labels, scanLatexLabels(text));
      addUnique(citations, scanLatexBibItems(text));
      for (const [key, count] of countLatexCitedKeys(text)) {
        citedKeys.set(key, (citedKeys.get(key) ?? 0) + count);
      }
      addUnique(packages, scanLatexPackages(text));
      addUnique(environments, scanLatexEnvironmentDefinitions(text));
      for (const command of scanLatexCommandDefinitions(text)) {
        commands.set(command.name, Math.max(commands.get(command.name) ?? 0, command.args));
      }
    }
  };

  await walk(normalizedRoot, 0);

  return {
    labels: [...labels],
    citations: [...citations],
    citedKeys: Object.fromEntries(citedKeys),
    packages: [...packages],
    commands: [...commands].map(([name, args]) => ({ name, args })),
    environments: [...environments],
    files,
  };
}

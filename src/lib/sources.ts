import {
  sortEntries,
  normalize,
  dirname,
  basename,
  isMarkdown,
  isPdf,
  isTypst,
  isLatex,
} from './paths';
import type { Source, Entry, FileData, Preferences } from './types';
import { invokeHost } from './native';
import { MAX_DOCUMENT_BYTES, MAX_PDF_BYTES } from './limits';
const MAX_ASSET_BYTES = 16 * 1024 * 1024;
function decode(bytes: Uint8Array): string {
  if (bytes.length > MAX_DOCUMENT_BYTES)
    throw new Error('This document exceeds the 8 MiB preview limit.');
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
async function readBrowserDocument(file: File): Promise<FileData> {
  if (isPdf(file.name)) {
    if (file.size > MAX_PDF_BYTES) throw new Error('This PDF exceeds the 64 MiB preview limit.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length > MAX_PDF_BYTES) throw new Error('This PDF exceeds the 64 MiB preview limit.');
    return { text: '', bytes, stamp: `${file.lastModified}:${file.size}` };
  }
  if (file.size > MAX_DOCUMENT_BYTES)
    throw new Error('This document exceeds the 8 MiB preview limit.');
  return {
    text: decode(new Uint8Array(await file.arrayBuffer())),
    stamp: `${file.lastModified}:${file.size}`,
    ...(isLatex(file.name) || isTypst(file.name)
      ? { compilationError: 'Compilation requires the Linux app.' }
      : {}),
  };
}
/** Imported files are snapshots: no paths outside the selected set are reachable. */
export function importedSource(files: File[]): Source {
  const map = new Map(files.map((file) => [normalize(file.webkitRelativePath || file.name), file]));
  const rootName = files[0]?.webkitRelativePath.split('/')[0];
  const root = rootName && files[0].webkitRelativePath.includes('/') ? '/' + rootName : '/';
  const get = (path: string) => {
    const file = map.get(path);
    if (!file) throw new Error('File is outside the imported selection or no longer available.');
    return file;
  };
  return {
    label: 'Imported snapshot',
    root,
    live: false,
    async list(path) {
      const entries = new Map<string, Entry>();
      for (const key of map.keys()) {
        const prefix = path === '/' ? '/' : path + '/';
        if (!key.startsWith(prefix)) continue;
        const remainder = key.slice(prefix.length);
        const name = remainder.split('/')[0];
        entries.set(name, {
          name,
          path: normalize(prefix + name),
          directory: remainder.includes('/'),
        });
      }
      return sortEntries([...entries.values()]);
    },
    async read(path) {
      return readBrowserDocument(get(path));
    },
    async asset(path) {
      const file = get(path);
      if (file.size > MAX_ASSET_BYTES) throw new Error('Asset exceeds 16 MiB.');
      return new Uint8Array(await file.arrayBuffer());
    },
  };
}
export const native = '__TAURI_INTERNALS__' in window;
export async function desktopSource(getPreferences: () => Preferences): Promise<{
  source: Source;
  initial: { path: string; directory: boolean };
}> {
  const initial = await invokeHost<{ path: string; directory: boolean }>('initial_path');
  initial.path = normalize(initial.path);
  return {
    initial,
    source: {
      label: 'Local filesystem',
      root: '/',
      live: true,
      async stamp(path) {
        const stamp = await invokeHost<string>('document_stamp', { path });
        const prefs = getPreferences();
        if (isTypst(path)) return `${stamp}|${prefs.typstPath}`;
        return isLatex(path)
          ? `${stamp}|${prefs.latexEngine}:${prefs.latexPaths[prefs.latexEngine]}`
          : stamp;
      },
      list: (path) => invokeHost<Entry[]>('list_directory', { path }),
      create: (directory, name, kind) =>
        invokeHost<string>('create_entry', { directory, name, kind }),
      rename: (path, name) => invokeHost<string>('rename_file', { path, name }),
      readText: (path) => invokeHost<string>('read_text_file', { path }),
      deleteFile: (path) => invokeHost<void>('delete_file', { path }),
      readSource: (path) => invokeHost<FileData>('read_document', { path }),
      write: (path, text, expected) =>
        invokeHost<FileData>('write_document', {
          path,
          text,
          expectedText: expected.text,
          expectedStamp: expected.stamp,
        }),
      async read(path) {
        if (!isPdf(path) && !isTypst(path) && !isLatex(path))
          return invokeHost<FileData>('read_document', { path });
        const prefs = getPreferences();
        const engine = prefs.latexEngine;
        const compilerPath = isTypst(path) ? prefs.typstPath : prefs.latexPaths[engine];
        let stamp = await invokeHost<string>('document_stamp', { path });
        try {
          const bytes = new Uint8Array(
            await invokeHost<ArrayBuffer>('read_pdf', { path, engine, compilerPath }),
          );
          if (isTypst(path) || isLatex(path)) {
            const latestStamp = await invokeHost<string>('document_stamp', { path });
            if (stamp.split('|', 1)[0] !== latestStamp.split('|', 1)[0])
              throw new Error('Document changed during compilation. Try again.');
            stamp = latestStamp;
          }
          if (isTypst(path)) {
            if (getPreferences().typstPath !== compilerPath)
              throw new Error('Typst compiler settings changed during compilation. Try again.');
            stamp += `|${compilerPath}`;
          }
          if (isLatex(path)) {
            const current = getPreferences();
            if (current.latexEngine !== engine || current.latexPaths[engine] !== compilerPath)
              throw new Error('LaTeX compiler settings changed during compilation. Try again.');
            stamp += `|${engine}:${compilerPath}`;
          }
          return { text: '', bytes, stamp };
        } catch (error) {
          if (isPdf(path)) throw error;
          const file = await invokeHost<FileData>('read_document', { path });
          return {
            ...file,
            compilationError: `Compilation failed. ${String(error)}`,
            retryCompilation: true,
          };
        }
      },
      asset: async (path) => new Uint8Array(await invokeHost<number[]>('read_asset', { path })),
    },
  };
}
/** File System Access is optional. Firefox and Android use snapshot import. */
export async function browserDirectory(): Promise<Source> {
  const picker = (
    window as unknown as { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }
  ).showDirectoryPicker;
  if (!picker)
    throw new Error(
      'Live folder access is unavailable in this browser. Use Import folder or Open files.',
    );
  const root = await picker();
  async function directory(path: string): Promise<FileSystemDirectoryHandle> {
    let handle = root;
    for (const part of normalize(path).split('/').filter(Boolean))
      handle = await handle.getDirectoryHandle(part);
    return handle;
  }
  async function fileHandle(path: string) {
    return (await directory(dirname(path))).getFileHandle(basename(path));
  }
  async function file(path: string) {
    return (await fileHandle(path)).getFile();
  }
  return {
    root: '/',
    label: root.name + ' · granted folder',
    live: true,
    async stamp(path) {
      const value = await file(path);
      return `${value.lastModified}:${value.size}`;
    },
    async list(path) {
      const entries: Entry[] = [];
      const handle = await directory(path);
      for await (const child of (
        handle as unknown as { values(): AsyncIterable<FileSystemHandle> }
      ).values())
        entries.push({
          name: child.name,
          path: normalize(path + '/' + child.name),
          directory: child.kind === 'directory',
        });
      return sortEntries(entries);
    },
    async read(path) {
      return readBrowserDocument(await file(path));
    },
    async write(path, text, expected) {
      if (!isMarkdown(path) && !isTypst(path) && !isLatex(path))
        throw new Error('Only Markdown, Typst, and LaTeX source documents can be saved.');
      if (new TextEncoder().encode(text).length > MAX_DOCUMENT_BYTES)
        throw new Error('This document exceeds the 8 MiB limit.');
      const handle = await fileHandle(path);
      const unchanged = async () => {
        const current = await readBrowserDocument(await handle.getFile());
        return current.stamp === expected.stamp && current.text === expected.text;
      };
      if (!(await unchanged())) throw new Error('Document changed on disk; reload before saving.');
      const writable = await handle.createWritable();
      try {
        await writable.write(text);
        if (!(await unchanged()))
          throw new Error('Document changed on disk; reload before saving.');
        await writable.close();
      } catch (error) {
        try {
          await writable.abort();
        } catch (abortError) {
          throw new AggregateError(
            [error, abortError],
            'Could not save or cancel the pending write.',
            { cause: abortError },
          );
        }
        throw error;
      }
      return readBrowserDocument(await handle.getFile());
    },
    async asset(path) {
      const value = await file(path);
      if (value.size > MAX_ASSET_BYTES) throw new Error('Asset exceeds 16 MiB.');
      return new Uint8Array(await value.arrayBuffer());
    },
  };
}

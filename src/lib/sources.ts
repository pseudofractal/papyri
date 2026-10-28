import { sortEntries, normalize, dirname, basename } from './paths';
import type { Source, Entry, FileData } from './types';
import { invokeHost } from './native';
import { MAX_DOCUMENT_BYTES } from './limits';
const MAX_ASSET_BYTES = 16 * 1024 * 1024;
function decode(bytes: Uint8Array): string {
  if (bytes.length > MAX_DOCUMENT_BYTES)
    throw new Error('This document exceeds the 8 MiB preview limit.');
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
async function readBrowserDocument(file: File): Promise<FileData> {
  if (file.size > MAX_DOCUMENT_BYTES)
    throw new Error('This document exceeds the 8 MiB preview limit.');
  return {
    text: decode(new Uint8Array(await file.arrayBuffer())),
    stamp: `${file.lastModified}:${file.size}`,
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
export async function desktopSource(): Promise<{
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
      stamp: (path) => invokeHost<string>('document_stamp', { path }),
      list: (path) => invokeHost<Entry[]>('list_directory', { path }),
      read: (path) => invokeHost<FileData>('read_document', { path }),
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
  async function file(path: string) {
    return (await (await directory(dirname(path))).getFileHandle(basename(path))).getFile();
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
    async asset(path) {
      const value = await file(path);
      if (value.size > MAX_ASSET_BYTES) throw new Error('Asset exceeds 16 MiB.');
      return new Uint8Array(await value.arrayBuffer());
    },
  };
}

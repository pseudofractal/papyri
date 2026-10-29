import type { Source } from './types';
import { isDocument, normalize } from './paths';
import { listDirectory } from './directories';
export interface AnchorTarget {
  id: string;
  request: number;
}
export interface Tab {
  path: string;
  text: string;
  bytes?: Uint8Array;
  stamp: string;
  scroll: number;
  error: string;
  revision: number;
}
/** Owns navigation and live refresh; frame messages never have access to this object. */
export class Workspace {
  source = $state.raw<Source | null>(null);
  tabs = $state<Tab[]>([]);
  active = $state('');
  secondary = $state('');
  directory = $state('/');
  error = $state('');
  busy = $state(false);
  treeRevision = $state(0);
  anchor = $state<AnchorTarget | null>(null);
  activeTab = $derived(this.tabs.find((tab) => tab.path === this.active));
  secondaryTab = $derived(this.tabs.find((tab) => tab.path === this.secondary));
  private navigation = 0;
  changeSource(source: Source) {
    this.navigation++;
    this.source = source;
    this.tabs = [];
    this.active = '';
    this.secondary = '';
    this.anchor = null;
    this.directory = source.root;
    this.error = '';
    this.busy = false;
    this.treeRevision++;
  }
  /** Select a source and its first document unless a newer source or navigation supersedes it. */
  async selectSource(source: Source) {
    this.changeSource(source);
    const request = this.navigation;
    try {
      const entries = await listDirectory(source, source.root);
      if (request !== this.navigation || source !== this.source) return;
      const first = entries.find((entry) => !entry.directory && isDocument(entry.path));
      if (first) await this.open(first.path);
    } catch (error) {
      if (request === this.navigation && source === this.source) this.error = String(error);
    }
  }
  async open(path: string, anchor = '') {
    path = normalize(path);
    if (!isDocument(path)) {
      this.error = 'Open a Markdown, PDF, or Typst document.';
      return;
    }
    const request = ++this.navigation;
    this.anchor = null;
    const existing = this.tabs.find((tab) => tab.path === path);
    if (existing) {
      this.active = path;
      this.busy = false;
      this.anchor = anchor ? { id: anchor, request } : null;
      return;
    }
    const source = this.source;
    if (!source) return;
    this.busy = true;
    try {
      const file = await source.read(path);
      if (request !== this.navigation || source !== this.source) return;
      this.tabs.push({
        path,
        text: file.text,
        bytes: file.bytes,
        stamp: file.stamp,
        scroll: 0,
        error: '',
        revision: 0,
      });
      this.active = path;
      this.anchor = anchor ? { id: anchor, request } : null;
      this.error = '';
    } catch (error) {
      if (request === this.navigation) this.error = String(error);
    } finally {
      if (request === this.navigation) this.busy = false;
    }
  }
  /** Queue a one-time heading command for the active preview, including repeated clicks. */
  navigateAnchor(id: string) {
    if (!this.active) return;
    this.busy = false;
    this.anchor = { id, request: ++this.navigation };
  }
  consumeAnchor(request: number) {
    if (this.anchor?.request === request) this.anchor = null;
  }
  close(path: string) {
    const index = this.tabs.findIndex((tab) => tab.path === path);
    this.tabs = this.tabs.filter((tab) => tab.path !== path);
    if (this.active === path) {
      this.anchor = null;
      this.active = this.tabs[Math.min(index, this.tabs.length - 1)]?.path || '';
    }
    if (this.secondary === path) this.secondary = '';
  }
  setScroll(path: string, y: number) {
    const tab = this.tabs.find((tab) => tab.path === path);
    if (tab) tab.scroll = y;
  }
  async refresh() {
    const source = this.source;
    if (!source) return;
    this.treeRevision++;
    const visiblePaths = [this.active, this.secondary].filter(
      (path, index, paths) => path && paths.indexOf(path) === index,
    );
    for (const path of visiblePaths) {
      const tab = this.tabs.find((tab) => tab.path === path);
      if (!tab) continue;
      try {
        if (source.stamp && (await source.stamp(path)) === tab.stamp) {
          tab.error = '';
          continue;
        }
        const file = await source.read(path);
        if (source !== this.source || !this.tabs.includes(tab)) continue;
        if (file.stamp !== tab.stamp || file.text !== tab.text) {
          tab.text = file.text;
          tab.bytes = file.bytes;
          tab.stamp = file.stamp;
          tab.revision++;
        }
        tab.error = '';
      } catch (error) {
        if (source === this.source)
          tab.error = `File unavailable. Last preview retained. ${String(error)}`;
      }
    }
  }
}

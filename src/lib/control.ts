import type { Preferences } from './types';

/** Keep in sync with `PROTOCOL_VERSION` in `src-tauri/src/control.rs`. */
export const CONTROL_PROTOCOL = 1;

/** State exposed to the control socket and `papyri ctl state`. */
export interface ControlState {
  protocol: number;
  active: string | null;
  secondary: string | null;
  tabs: ControlTab[];
  pdf: { path: string; page: number; total: number } | null;
  view: {
    sidebar: boolean;
    outline: boolean;
    settings: boolean;
    palette: boolean;
    search: boolean;
    split: boolean;
    query: string;
  };
  preferences: Preferences;
  directory: string;
  source: { label: string; root: string; live: boolean } | null;
  busy: boolean;
  error: string | null;
}

export interface ControlTab {
  path: string;
  kind: 'markdown' | 'pdf' | 'typst-source' | 'latex-source';
  active: boolean;
  secondary: boolean;
  scroll: number;
  error: string | null;
}

export type ControlPane = 'main' | 'secondary';
export type ControlPanel = 'sidebar' | 'outline' | 'settings' | 'palette' | 'search' | 'split';
export type ToggleAction = 'on' | 'off' | 'toggle';

export type ScrollTarget = { y: number } | { dy: number } | { top: true } | { bottom: true };

export interface OpenOptions {
  pane: ControlPane;
  anchor?: string;
  directory?: boolean;
}

/** The host implements these actions; the control bridge only validates and dispatches. */
export interface ControlActions {
  state(): ControlState;
  headings(): unknown;
  commands(): unknown;
  open(path: string, options: OpenOptions): Promise<unknown>;
  close(path?: string): Promise<unknown>;
  focus(path: string): Promise<unknown>;
  tab(direction: 'next' | 'previous'): Promise<unknown>;
  activate(path: string): Promise<unknown>;
  closeTab(path?: string): Promise<unknown>;
  scroll(pane: ControlPane, target: ScrollTarget): Promise<unknown>;
  zoom(
    target: 'document' | 'ui',
    action?: 'in' | 'out' | 'reset',
    value?: number,
  ): Promise<unknown>;
  fitWidth(enabled?: boolean): Promise<unknown>;
  theme(theme: 'latte' | 'mocha' | 'toggle'): Promise<unknown>;
  panel(name: ControlPanel, action: ToggleAction): Promise<unknown>;
  search(query: string): Promise<unknown>;
  heading(id: string): Promise<unknown>;
  page(page: number): Promise<unknown>;
  command(id: string): Promise<unknown>;
  preferences(patch: Record<string, unknown>): Promise<unknown>;
  refresh(): Promise<unknown>;
}

const PANELS: ControlPanel[] = ['sidebar', 'outline', 'settings', 'palette', 'search', 'split'];
const ACTIONS = ['on', 'off', 'toggle'] as const;
const PANES = ['main', 'secondary'] as const;
const ZOOM_TARGETS = ['document', 'ui'] as const;
const ZOOM_ACTIONS = ['in', 'out', 'reset'] as const;
const THEMES = ['latte', 'mocha', 'toggle'] as const;

/** Validate a control request and invoke the corresponding host action. */
export function createControlExecutor(
  actions: ControlActions,
): (method: string, params: Record<string, unknown>) => Promise<unknown> {
  return async (method, rawParams) => {
    const params = requestObject(rawParams);
    switch (method) {
      case 'state':
        return actions.state();
      case 'headings':
        return actions.headings();
      case 'commands':
        return actions.commands();
      case 'open': {
        const path = requiredString(params, 'path');
        const pane = optionalEnum(params, 'pane', PANES, 'main');
        const anchor = optionalString(params, 'anchor');
        const directory = optionalBoolean(params, 'directory') ?? false;
        return actions.open(path, { pane, anchor, directory });
      }
      case 'close':
        return actions.close(optionalString(params, 'path'));
      case 'focus':
        return actions.focus(requiredString(params, 'path'));
      case 'tab.next':
        return actions.tab('next');
      case 'tab.previous':
        return actions.tab('previous');
      case 'tab.activate':
        return actions.activate(requiredString(params, 'path'));
      case 'tab.close':
        return actions.closeTab(optionalString(params, 'path'));
      case 'scroll.to':
        return actions.scroll(paneParameter(params), { y: requiredNumber(params, 'y') });
      case 'scroll.by':
        return actions.scroll(paneParameter(params), { dy: requiredNumber(params, 'dy') });
      case 'scroll.top':
        return actions.scroll(paneParameter(params), { top: true });
      case 'scroll.bottom':
        return actions.scroll(paneParameter(params), { bottom: true });
      case 'zoom': {
        const target = optionalEnum(params, 'target', ZOOM_TARGETS, 'document');
        const action = optionalEnum(params, 'action', ZOOM_ACTIONS, undefined);
        const value = optionalNumber(params, 'value');
        if (action === undefined && value === undefined)
          throw new Error('zoom needs an `action` or a `value`.');
        if (action !== undefined && value !== undefined)
          throw new Error('zoom accepts either an `action` or a `value`, not both.');
        return actions.zoom(target, action, value);
      }
      case 'fit-width':
        return actions.fitWidth(optionalBoolean(params, 'enabled'));
      case 'theme':
        return actions.theme(optionalEnum(params, 'theme', THEMES, 'toggle'));
      case 'panel':
        return actions.panel(
          requiredEnum(params, 'name', PANELS),
          optionalEnum(params, 'action', ACTIONS, 'toggle'),
        );
      case 'search':
        return actions.search(requiredString(params, 'query', true));
      case 'heading':
        return actions.heading(requiredString(params, 'id'));
      case 'page': {
        const page = requiredNumber(params, 'page');
        if (!Number.isInteger(page) || page < 1)
          throw new Error('`page` must be a positive integer.');
        return actions.page(page);
      }
      case 'command':
        return actions.command(requiredString(params, 'id'));
      case 'preferences.set': {
        const patch = params.patch;
        if (!patch || typeof patch !== 'object' || Array.isArray(patch))
          throw new Error('`patch` must be an object.');
        return actions.preferences(patch as Record<string, unknown>);
      }
      case 'refresh':
        return actions.refresh();
      default:
        throw new Error(`Unknown control method: ${method}`);
    }
  };
}

function requestObject(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value))
    throw new Error('Control parameters must be an object.');
  return value as Record<string, unknown>;
}

function requiredString(params: Record<string, unknown>, key: string, allowEmpty = false): string {
  const value = params[key];
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()))
    throw new Error(`\`${key}\` must be a ${allowEmpty ? 'string' : 'non-empty string'}.`);
  return value;
}

function optionalString(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error(`\`${key}\` must be a string.`);
  return value;
}

function requiredNumber(params: Record<string, unknown>, key: string): number {
  const value = params[key];
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`\`${key}\` must be a finite number.`);
  return value;
}

function optionalNumber(params: Record<string, unknown>, key: string): number | undefined {
  const value = params[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`\`${key}\` must be a finite number.`);
  return value;
}

function optionalBoolean(params: Record<string, unknown>, key: string): boolean | undefined {
  const value = params[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw new Error(`\`${key}\` must be a boolean.`);
  return value;
}

function optionalEnum<T extends string>(
  params: Record<string, unknown>,
  key: string,
  values: readonly T[],
  fallback: T,
): T;
function optionalEnum<T extends string>(
  params: Record<string, unknown>,
  key: string,
  values: readonly T[],
  fallback: undefined,
): T | undefined;
function optionalEnum<T extends string>(
  params: Record<string, unknown>,
  key: string,
  values: readonly T[],
  fallback: T | undefined,
): T | undefined {
  const value = params[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string' || !values.includes(value as T))
    throw new Error(`\`${key}\` must be one of: ${values.join(', ')}.`);
  return value as T;
}

function requiredEnum<T extends string>(
  params: Record<string, unknown>,
  key: string,
  values: readonly T[],
): T {
  const value = optionalEnum(params, key, values, undefined);
  if (value === undefined) throw new Error(`\`${key}\` must be one of: ${values.join(', ')}.`);
  return value;
}

function paneParameter(params: Record<string, unknown>): ControlPane {
  return optionalEnum(params, 'pane', PANES, 'main');
}

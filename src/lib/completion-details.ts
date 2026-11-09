import type { CompletionSource } from '@codemirror/autocomplete';
import { LSPPlugin, serverCompletionSource, type LSPClient } from '@codemirror/lsp-client';
import type { EditorLanguage } from './editor-lsp';
import { highlightDocumentation } from './documentation-highlight';

export interface CompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string | { kind: 'markdown' | 'plaintext'; value: string };
  labelDetails?: { detail?: string; description?: string };
  data?: unknown;
}

interface CompletionList {
  items: CompletionItem[];
}

export interface Signature {
  parameters: { name?: string; type: string }[];
  result: string;
}

/** Parse Tinymist's function detail only when its complete shape is understood. */
export function parseTypstSignature(detail: string): Signature | null {
  if (!detail.startsWith('(')) return null;
  let quote = '';
  let escaped = false;
  const stack: string[] = [];
  let end = -1;
  const parts: string[] = [];
  let start = 1;
  const closing: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  for (let index = 0; index < detail.length; index++) {
    const char = detail[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
    } else if (closing[char]) {
      stack.push(closing[char]);
    } else if (char === ')' || char === ']' || char === '}') {
      if (stack.pop() !== char) return null;
      if (stack.length === 0) {
        parts.push(detail.slice(start, index).trim());
        end = index;
        break;
      }
    } else if (char === ',' && stack.length === 1) {
      parts.push(detail.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (end < 0 || quote || stack.length) return null;
  const match = /^\s*=>\s*(\S[\s\S]*)$/.exec(detail.slice(end + 1));
  if (!match) return null;
  if (parts.length === 1 && parts[0] === '') parts.pop();
  if (parts.some((part) => !part)) return null;
  return {
    parameters: parts.map((part) => {
      const named = /^([\w-]+):\s*(\S[\s\S]*)$/.exec(part);
      return named ? { name: named[1], type: named[2] } : { type: part };
    }),
    result: match[1],
  };
}

/** Split top-level type alternatives without interpreting nested or quoted expressions. */
export function splitTypeAlternatives(type: string): string[] | null {
  const parts: string[] = [];
  const stack: string[] = [];
  const closing: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  let quote = '';
  let escaped = false;
  let start = 0;
  for (let index = 0; index < type.length; index++) {
    const char = type[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (closing[char]) {
      stack.push(closing[char]);
    } else if (char === ')' || char === ']' || char === '}') {
      if (stack.pop() !== char) return null;
    } else if (char === '|' && stack.length === 0) {
      parts.push(type.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(type.slice(start).trim());
  return quote || stack.length || parts.some((part) => !part) ? null : parts;
}

function appendText(parent: HTMLElement, tag: string, className: string, text: string) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  parent.append(element);
  return element;
}

function appendType(parent: HTMLElement, value: string) {
  const list = appendText(parent, 'span', 'completion-type-list', '');
  const alternatives = splitTypeAlternatives(value) ?? [value];
  alternatives.forEach((alternative, index) => {
    if (index) appendText(list, 'span', 'completion-type-separator', '|');
    appendText(list, 'code', 'completion-type-token', alternative);
  });
}

const detailGlyphs: Record<string, string> = {
  Function: 'ƒ',
  Property: '◇',
  Symbol: '∑',
  Color: '◉',
  Reference: '§',
  Citation: '❞',
  Value: '◆',
  Type: 'T',
  Module: '▦',
  Snippet: '‹›',
};

function appendHeader(panel: HTMLElement, label: string, kind: string) {
  panel.classList.add('completion-card');
  const header = appendText(panel, 'div', 'completion-card-header', '');
  const glyph = appendText(header, 'span', 'completion-card-glyph', detailGlyphs[kind] ?? '·');
  glyph.setAttribute('aria-hidden', 'true');
  const identity = appendText(header, 'div', 'completion-card-identity', '');
  appendText(identity, 'div', 'completion-card-kind', kind);
  appendText(identity, 'div', 'completion-details-title', label);
}

function appendDetailBody(panel: HTMLElement, item: CompletionItem) {
  const section = appendText(panel, 'div', 'completion-documentation-section', '');
  appendText(section, 'span', 'completion-function-section-title', 'Details');
  const documentation =
    typeof item.documentation === 'string' ? item.documentation : (item.documentation?.value ?? '');
  const longDocumentationLength = 400;
  if ((item.detail?.length ?? 0) + documentation.length > longDocumentationLength) {
    const hint = appendText(section, 'span', 'completion-function-scroll-hint', 'Alt+PgUp/PgDn');
    hint.title = 'Scroll details with Alt + Page Up or Alt + Page Down';
  }
  return appendText(panel, 'div', 'completion-detail-scroll', '');
}

function appendDocumentation(
  parent: HTMLElement,
  plugin: LSPPlugin,
  doc: NonNullable<CompletionItem['documentation']>,
) {
  const element = document.createElement('div');
  element.className = 'completion-documentation';
  element.innerHTML = plugin.docToHTML(doc);
  highlightDocumentation(element);
  parent.append(element);
}

/** Recognize Tinymist symbol details without guessing at arbitrary property descriptions. */
export function parseTypstSymbol(
  item: CompletionItem,
): { glyph: string; codepoint: string } | null {
  if (item.kind !== 5 || !item.detail) return null;
  const match = /^(.+), unicode: `\\u\{([0-9a-fA-F]+)\}`$/.exec(item.detail);
  if (!match || item.labelDetails?.description !== match[1]) return null;
  const codepoint = Number.parseInt(match[2], 16);
  if (codepoint > 0x10ffff || String.fromCodePoint(codepoint) !== match[1]) return null;
  return { glyph: match[1], codepoint: `U+${match[2].toUpperCase().padStart(4, '0')}` };
}

/** Render only the information supplied by the server, preserving unknown formats. */
export function renderCompletionDetails(
  item: CompletionItem,
  language: EditorLanguage,
  plugin: LSPPlugin,
): HTMLElement | null {
  const signature =
    language === 'typst' && item.kind === 3 && item.detail
      ? parseTypstSignature(item.detail)
      : null;
  const symbol = language === 'typst' ? parseTypstSymbol(item) : null;
  const color =
    language === 'typst' && item.kind === 6
      ? /^rgb\("(#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?)"\)$/.exec(item.detail ?? '')
      : null;
  const reference =
    language === 'latex' && item.kind === 1 && item.detail
      ? /^Section \(([^\n]*)\)$/.exec(item.detail)
      : null;
  const citation =
    language === 'latex' &&
    typeof item.data === 'object' &&
    item.data !== null &&
    'citation' in item.data;
  const type =
    language === 'typst' && item.kind === 5 && !symbol ? item.labelDetails?.description : undefined;
  if (!signature && !item.detail && !item.documentation && !type) return null;
  const panel = document.createElement('div');
  panel.className = 'completion-details';
  if (signature) {
    panel.classList.add('completion-function');
    appendHeader(panel, item.label, 'Function');

    const heading = appendText(panel, 'div', 'completion-function-section', '');
    appendText(heading, 'span', 'completion-function-section-title', 'Parameters');
    const count = signature.parameters.length;
    appendText(heading, 'span', 'completion-function-count', `${count} total`);
    if (count > 4) {
      const hint = appendText(heading, 'span', 'completion-function-scroll-hint', 'Alt+PgUp/PgDn');
      hint.title = 'Scroll parameters with Alt + Page Up or Alt + Page Down';
    }
    const body = appendText(panel, 'div', 'completion-detail-scroll completion-function-body', '');
    const parameters = appendText(body, 'div', 'completion-parameters', '');
    signature.parameters.forEach((parameter, index) => {
      const row = appendText(parameters, 'div', 'completion-parameter', '');
      const number = appendText(
        row,
        'span',
        'completion-parameter-index',
        String(index + 1).padStart(2, '0'),
      );
      number.setAttribute('aria-hidden', 'true');
      const name = appendText(
        row,
        'span',
        'completion-parameter-name',
        parameter.name ?? 'positional',
      );
      if (!parameter.name) name.classList.add('completion-parameter-positional');
      appendType(row, parameter.type);
    });
    if (item.documentation) appendDocumentation(body, plugin, item.documentation);

    const result = appendText(panel, 'div', 'completion-return', '');
    const arrow = appendText(result, 'span', 'completion-return-arrow', '↳');
    arrow.setAttribute('aria-hidden', 'true');
    const resultContent = appendText(result, 'div', 'completion-return-content', '');
    appendText(resultContent, 'span', 'completion-return-label', 'Returns');
    appendType(resultContent, signature.result);
  } else if (symbol) {
    appendHeader(panel, item.label, 'Symbol');
    const preview = appendText(panel, 'div', 'completion-symbol-preview', '');
    appendText(preview, 'span', 'completion-symbol-glyph', symbol.glyph);
    const info = appendText(preview, 'div', 'completion-symbol-info', '');
    appendText(info, 'span', 'completion-details-heading', 'Unicode');
    appendText(info, 'code', 'completion-symbol-code', symbol.codepoint);
    if (item.documentation)
      appendDocumentation(appendDetailBody(panel, item), plugin, item.documentation);
  } else if (color) {
    appendHeader(panel, item.label, 'Color');
    const preview = appendText(panel, 'div', 'completion-color-preview', '');
    const swatch = appendText(preview, 'span', 'completion-color-swatch', '');
    swatch.style.backgroundColor = color[1];
    const info = appendText(preview, 'div', 'completion-color-info', '');
    appendText(info, 'span', 'completion-details-heading', 'Value');
    appendText(info, 'code', 'completion-color-value', item.detail!);
    if (item.documentation)
      appendDocumentation(appendDetailBody(panel, item), plugin, item.documentation);
  } else if (reference) {
    appendHeader(panel, item.label, 'Reference');
    const preview = appendText(panel, 'div', 'completion-reference-preview', '');
    appendText(preview, 'div', 'completion-details-heading', 'Section');
    appendText(preview, 'div', 'completion-reference-title', reference[1]);
    if (item.documentation)
      appendDocumentation(appendDetailBody(panel, item), plugin, item.documentation);
  } else {
    let hasHeader = false;
    if (type) {
      appendHeader(panel, item.label, 'Property');
      hasHeader = true;
      const typeRow = appendText(panel, 'div', 'completion-property-type', '');
      appendText(typeRow, 'span', 'completion-property-type-label', 'Type');
      appendType(typeRow, type);
    } else if (citation) {
      appendHeader(panel, item.label, 'Citation');
      hasHeader = true;
    } else if (language === 'typst') {
      const kindLabels: Record<number, string> = {
        3: 'Function',
        6: 'Value',
        7: 'Type',
        9: 'Module',
        15: 'Snippet',
      };
      const kind = item.kind && kindLabels[item.kind];
      if (kind) {
        appendHeader(panel, item.label, kind);
        hasHeader = true;
      }
    }
    const documentationTarget =
      hasHeader && (item.detail || item.documentation) ? appendDetailBody(panel, item) : panel;
    if (item.detail) {
      appendDocumentation(documentationTarget, plugin, {
        kind: language === 'typst' ? 'markdown' : 'plaintext',
        value: item.detail,
      });
    }
    if (item.documentation) appendDocumentation(documentationTarget, plugin, item.documentation);
  }
  return panel;
}

/** Retain LSP completion metadata while delegating insertion and ranges to CodeMirror. */
export function completionSource(client: LSPClient, language: EditorLanguage): CompletionSource {
  // CodeMirror drops labelDetails and resolve data, so carry an opaque key through its detail field.
  const items = new Map<string, CompletionItem>();
  const request = client.request.bind(client);
  let nextId = 0;
  client.request = async <Params, Result>(method: string, params: Params): Promise<Result> => {
    const result = await request<Params, Result>(method, params);
    if (method !== 'textDocument/completion' || !result) return result;
    const list = result as CompletionItem[] | CompletionList;
    const completions = Array.isArray(list) ? list : list.items;
    for (const item of completions) {
      const id = `papyri-completion-${nextId++}`;
      items.set(id, { ...item });
      item.detail = id;
    }
    const maxRetainedItems = Math.max(5000, completions.length);
    while (items.size > maxRetainedItems) items.delete(items.keys().next().value!);
    return result;
  };
  return async (context) => {
    const result = await serverCompletionSource(context);
    if (!result) return null;
    const plugin = context.view && LSPPlugin.get(context.view);
    if (!plugin) return result;
    const options = result.options.map((option) => {
      const item = option.detail && items.get(option.detail);
      if (!item) {
        return option.detail?.startsWith('papyri-completion-')
          ? { ...option, detail: undefined, info: undefined }
          : option;
      }
      items.delete(option.detail!);
      const canResolve = Boolean(
        client.serverCapabilities?.completionProvider?.resolveProvider && item.data,
      );
      const hasDetails = Boolean(
        item.detail || item.documentation || item.labelDetails?.description || canResolve,
      );
      const symbol = language === 'typst' ? parseTypstSymbol(item) : null;
      return {
        ...option,
        ...(symbol ? { symbolGlyph: symbol.glyph } : {}),
        detail: undefined,
        info: !hasDetails
          ? undefined
          : !canResolve
            ? () => renderCompletionDetails(item, language, plugin)
            : async () => {
                try {
                  const resolved = await request<CompletionItem, CompletionItem>(
                    'completionItem/resolve',
                    item,
                  );
                  return renderCompletionDetails({ ...item, ...resolved }, language, plugin);
                } catch (error) {
                  console.warn('Could not resolve completion details:', error);
                  const panel =
                    renderCompletionDetails(item, language, plugin) ??
                    document.createElement('div');
                  appendText(
                    panel,
                    'div',
                    'completion-details-error',
                    'Could not load additional details.',
                  );
                  return panel;
                }
              },
      };
    });
    return { ...result, options };
  };
}

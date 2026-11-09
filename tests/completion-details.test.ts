import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LSPPlugin } from '@codemirror/lsp-client';
import {
  parseTypstSignature,
  renderCompletionDetails,
  parseTypstSymbol,
  splitTypeAlternatives,
} from '../src/lib/completion-details';

describe('Tinymist completion signatures', () => {
  it('separates named and positional inputs from the result', () => {
    expect(parseTypstSignature('([any], encoding: "utf8" | none) => bytes | str')).toEqual({
      parameters: [{ type: '[any]' }, { name: 'encoding', type: '"utf8" | none' }],
      result: 'bytes | str',
    });
  });

  it('keeps commas inside nested or quoted types together', () => {
    expect(parseTypstSignature('(value: (a, b), format: "x,y") => result')).toEqual({
      parameters: [
        { name: 'value', type: '(a, b)' },
        { name: 'format', type: '"x,y"' },
      ],
      result: 'result',
    });
  });

  it.each(['type', '(missing', '(x, ) => y', '(x) -> y', '(x] => y', '(x) => '])(
    'leaves an unrecognized detail unchanged: %s',
    (detail) => expect(parseTypstSignature(detail)).toBeNull(),
  );

  it('preserves every input and output in the sampled function signatures', () => {
    const corpus = JSON.parse(readFileSync('docs/lsp-completions/tinymist.json', 'utf8'));
    const signatures = corpus.cases
      .flatMap(
        (sample: { result: { items: { kind: number; detail?: string }[] } }) => sample.result.items,
      )
      .filter(
        (item: { kind: number; detail?: string }) =>
          item.kind === 3 && item.detail?.startsWith('('),
      );
    expect(signatures.length).toBeGreaterThan(50);
    let recognized = 0;
    for (const { detail } of signatures) {
      const parsed = parseTypstSignature(detail);
      if (!parsed) continue;
      recognized++;
      const parameters = parsed.parameters
        .map((parameter) =>
          parameter.name ? `${parameter.name}: ${parameter.type}` : parameter.type,
        )
        .join(', ');
      expect(`(${parameters}) => ${parsed.result}`).toBe(detail);
    }
    expect(recognized).toBeGreaterThan(50);
  });
});

describe('server-specific detail formats', () => {
  it('splits only top-level type alternatives', () => {
    expect(splitTypeAlternatives('auto | (str | none) | "a|b"')).toEqual([
      'auto',
      '(str | none)',
      '"a|b"',
    ]);
    expect(splitTypeAlternatives('auto | (str')).toBeNull();
    expect(splitTypeAlternatives('auto | ')).toBeNull();
  });

  it('recognizes symbol previews only when the glyph and Unicode agree', () => {
    expect(
      parseTypstSymbol({
        label: 'Alpha',
        kind: 5,
        detail: 'Α, unicode: `\\u{0391}`',
        labelDetails: { description: 'Α' },
      }),
    ).toEqual({ glyph: 'Α', codepoint: 'U+0391' });
    expect(
      parseTypstSymbol({
        label: 'Alpha',
        kind: 5,
        detail: 'Α, unicode: `\\u{0392}`',
        labelDetails: { description: 'Α' },
      }),
    ).toBeNull();
  });

  it('recognizes at least 50 actual Tinymist symbol responses', () => {
    const corpus = JSON.parse(readFileSync('docs/lsp-completions/tinymist.json', 'utf8'));
    const symbols = corpus.cases.find((sample: { input: string }) => sample.input === '#sym.');
    const recognized = symbols.result.items.filter(parseTypstSymbol);
    expect(recognized.length).toBeGreaterThanOrEqual(50);
  });
});

class TestElement {
  className = '';
  textContent = '';
  title = '';
  innerHTML = '';
  style: Record<string, string> = {};
  children: TestElement[] = [];
  classList = {
    add: (name: string) => {
      this.className += ` ${name}`;
    },
  };
  append(child: TestElement) {
    this.children.push(child);
  }
  setAttribute() {}
  querySelectorAll() {
    return [];
  }
}

describe('function details', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the result separate from the scrollable parameters of a real long signature', () => {
    vi.stubGlobal('document', { createElement: () => new TestElement() });
    const corpus = JSON.parse(readFileSync('docs/lsp-completions/tinymist.json', 'utf8'));
    const globalItems = corpus.cases.find((sample: { input: string }) => sample.input === '#')
      .result.items;
    const item = globalItems.find((completion: { label: string }) => completion.label === 'rect');
    const signature = parseTypstSignature(item.detail)!;
    const panel = renderCompletionDetails(item, 'typst', {} as LSPPlugin) as unknown as TestElement;
    const body = panel.children.find((child) =>
      child.className.split(' ').includes('completion-function-body'),
    )!;
    const parameters = body.children.find((child) => child.className === 'completion-parameters')!;
    const result = panel.children.find((child) => child.className === 'completion-return');
    expect(signature.parameters.length).toBeGreaterThan(5);
    expect(parameters.children).toHaveLength(signature.parameters.length);
    expect(result).toBeDefined();
    expect(body.children).not.toContain(result);
  });

  it('keeps real property documentation in the scroll area and retains its type', () => {
    vi.stubGlobal('document', { createElement: () => new TestElement() });
    const corpus = JSON.parse(readFileSync('docs/lsp-completions/tinymist.json', 'utf8'));
    const items = corpus.cases.find((sample: { input: string }) => sample.input === '#rect(').result
      .items;
    const item = items.find((completion: { label: string }) => completion.label === 'fill');
    const docToHTML = vi.fn(() => '<p>Rendered documentation</p>');
    const plugin = { docToHTML } as unknown as LSPPlugin;
    const panel = renderCompletionDetails(item, 'typst', plugin) as unknown as TestElement;
    const type = panel.children.find((child) => child.className === 'completion-property-type');
    const body = panel.children.find((child) => child.className === 'completion-detail-scroll');
    expect(type).toBeDefined();
    expect(body?.children).toHaveLength(1);
    expect(docToHTML).toHaveBeenCalledWith({ kind: 'markdown', value: item.detail });
  });
});

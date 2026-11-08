import { describe, expect, it, vi } from 'vitest';
import { highlightDocumentation, documentationTokens } from '../src/lib/documentation-highlight';

describe('Typst documentation highlighting', () => {
  it('identifies names, keywords, and literals in actual Typst syntax', () => {
    const source = '#rect(fill: blue)\n#set text(size: 11pt)';
    const tokens = documentationTokens(source, 'typst');
    const spans = tokens.map(({ from, to, className }) => ({
      text: source.slice(from, to),
      className,
    }));
    expect(spans).toContainEqual({ text: '#', className: 'doc-code-keyword' });
    expect(spans).toContainEqual({ text: 'rect', className: 'doc-code-name' });
    expect(spans).toContainEqual({ text: 'fill', className: 'doc-code-property' });
    expect(spans).toContainEqual({ text: 'blue', className: 'doc-code-name' });
    expect(spans).toContainEqual({ text: 'set', className: 'doc-code-keyword' });
    expect(spans).toContainEqual({ text: '11pt', className: 'doc-code-literal' });
  });

  it('returns ordered, non-overlapping ranges within the original text', () => {
    const source = '#let greeting = "<hello>"\n// comment\n#greeting';
    const tokens = documentationTokens(source, 'typst');
    let previousEnd = 0;
    for (const token of tokens) {
      expect(token.from).toBeGreaterThanOrEqual(previousEnd);
      expect(token.to).toBeLessThanOrEqual(source.length);
      expect(token.to).toBeGreaterThan(token.from);
      previousEnd = token.to;
    }
    expect(tokens.length).toBeGreaterThan(0);
  });
});

describe('Markdown and LaTeX documentation highlighting', () => {
  it('highlights Markdown headings, emphasis, and links', () => {
    const source = '# Heading\n**bold** and [link](https://example.com)';
    const spans = documentationTokens(source, 'markdown').map(({ from, to, className }) => ({
      text: source.slice(from, to),
      className,
    }));
    expect(
      spans.some(
        (span) => span.text.includes('Heading') && span.className.includes('doc-code-keyword'),
      ),
    ).toBe(true);
    expect(
      spans.some(
        (span) => span.text.includes('bold') && span.className.includes('doc-code-strong'),
      ),
    ).toBe(true);
    expect(
      spans.some((span) => span.text.includes('link') && span.className.includes('doc-code-link')),
    ).toBe(true);
  });

  it('highlights LaTeX commands, math, and comments', () => {
    const source = String.raw`\section{Introduction} $x^2$ % comment`;
    const spans = documentationTokens(source, 'latex').map(({ from, to, className }) => ({
      text: source.slice(from, to),
      className,
    }));
    expect(
      spans.some(
        (span) => span.text === String.raw`\section` && span.className.includes('doc-code-keyword'),
      ),
    ).toBe(true);
    expect(
      spans.some((span) => span.text === '2' && span.className.includes('doc-code-literal')),
    ).toBe(true);
    expect(
      spans.some(
        (span) => span.text === '% comment' && span.className.includes('doc-code-comment'),
      ),
    ).toBe(true);
  });
});

it('highlights recognized language aliases without changing text or unknown blocks', () => {
  const examples = [
    { language: 'Typst', text: '#set text(size: 11pt)\n<literal>' },
    { language: 'md', text: '# Heading\n**bold**' },
    { language: 'markdown', text: '[link](https://example.com)' },
    { language: 'tex', text: String.raw`\section{Hello}` },
    { language: 'latex', text: String.raw`\textbf{Hello}` },
  ];
  const blocks = examples.map(({ language, text }) => ({
    classList: [`language-${language}`],
    nodeType: 1,
    nodeName: 'CODE',
    childNodes: [{ nodeType: 3, nodeValue: text }],
    replaceChildren: vi.fn(),
  }));
  const unknown = ['python', 'constructor', '__proto__'].map((language) => ({
    classList: [`language-${language}`],
    textContent: 'unchanged',
    replaceChildren: vi.fn(),
  }));
  type Fragment = {
    children: { textContent: string }[];
    append: (child: { textContent: string }) => void;
  };
  const fragments: Fragment[] = [];
  vi.stubGlobal('Node', { TEXT_NODE: 3, ELEMENT_NODE: 1 });
  vi.stubGlobal('document', {
    createDocumentFragment: () => {
      const fragment: Fragment = {
        children: [],
        append(child) {
          this.children.push(child);
        },
      };
      fragments.push(fragment);
      return fragment;
    },
    createTextNode: (text: string) => ({ textContent: text }),
    createElement: () => ({ className: '', textContent: '' }),
  });
  try {
    const root = { querySelectorAll: () => [...blocks, ...unknown] } as unknown as HTMLElement;
    highlightDocumentation(root);
    expect(fragments).toHaveLength(examples.length);
    blocks.forEach((block, index) => {
      expect(block.replaceChildren).toHaveBeenCalledOnce();
      expect(fragments[index].children.map((child) => child.textContent).join('')).toBe(
        examples[index].text,
      );
    });
    unknown.forEach((block) => expect(block.replaceChildren).not.toHaveBeenCalled());
  } finally {
    vi.unstubAllGlobals();
  }
});

it('preserves line breaks from already-highlighted markup', () => {
  const typst = {
    classList: ['language-md'],
    nodeType: 1,
    nodeName: 'CODE',
    childNodes: [
      { nodeType: 1, nodeName: 'SPAN', childNodes: [{ nodeType: 3, nodeValue: '# Heading' }] },
      { nodeType: 1, nodeName: 'BR', childNodes: [] },
      { nodeType: 3, nodeValue: '**bold**' },
      { nodeType: 1, nodeName: 'BR', childNodes: [] },
    ],
    replaceChildren: vi.fn(),
  };
  const fragment: {
    children: { textContent: string }[];
    append: (child: { textContent: string }) => void;
  } = {
    children: [],
    append(child) {
      this.children.push(child);
    },
  };
  vi.stubGlobal('Node', { TEXT_NODE: 3, ELEMENT_NODE: 1 });
  vi.stubGlobal('document', {
    createDocumentFragment: () => fragment,
    createTextNode: (text: string) => ({ textContent: text }),
    createElement: () => ({ className: '', textContent: '' }),
  });
  try {
    const root = { querySelectorAll: () => [typst] } as unknown as HTMLElement;
    highlightDocumentation(root);
    expect(fragment.children.map((child) => child.textContent).join('')).toBe(
      '# Heading\n**bold**\n',
    );
  } finally {
    vi.unstubAllGlobals();
  }
});

import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../src/render/markdown';
import { validateDelimiters } from '../src/lib/preferences';
import { resolveLink, sortEntries } from '../src/lib/paths';
import { framePolicy } from '../src/render/sandbox';
describe('Markdown and mathematics', () => {
  it('renders GFM, footnotes, raw HTML, code, and unique heading anchors', () => {
    const result = renderMarkdown(
      '# Hello\n\n# Hello\n\n~~gone~~\n\n- [x] done\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nNote[^x]\n\n[^x]: Footnote\n\n<details><summary>More</summary>HTML</details>\n\n```ts\nconst value = 1;\n```',
    );
    expect(result.html).toContain('<table>');
    expect(result.html).toContain('<s>gone</s>');
    expect(result.html).toContain('type="checkbox"');
    expect(result.html).toContain('footnote');
    expect(result.html).toContain('<details>');
    expect(result.html).toContain('hljs');
    expect(new Set(result.headings.map((h) => h.id)).size).toBe(2);
  });
  it('supports common and arbitrary math delimiters without parsing code', () => {
    const result = renderMarkdown('Inline \\(x^2\\), display $$x+1$$, custom %%y%% and `%%z%%`.', [
      { left: '\\(', right: '\\)', display: false },
      { left: '$$', right: '$$', display: true },
      { left: '%%', right: '%%', display: false },
    ]);
    expect((result.html.match(/class="katex"/g) || []).length).toBe(3);
    expect(result.html).toContain('<code>%%z%%</code>');
    expect(renderMarkdown('Unclosed $$x').html).toContain('$$x');
    expect(renderMarkdown('$$\\unknowncommand$$').html).toContain('mathcolor="#cc0000"');
  });
  it('reports delimiter errors and prioritizes longer openings', () => {
    expect(() => validateDelimiters([{ left: '', right: 'x', display: false }])).toThrow();
    expect(() =>
      validateDelimiters([
        { left: '$', right: '$', display: false },
        { left: '$', right: 'x', display: true },
      ]),
    ).toThrow('Duplicate');
    expect(() => validateDelimiters([{ left: '<', right: '>', display: false }])).toThrow();
    expect(
      validateDelimiters([
        { left: '$', right: '$', display: false },
        { left: '$$', right: '$$', display: true },
      ])[0].left,
    ).toBe('$$');
  });
  it('keeps expensive diagrams deferred, including malformed source', () => {
    for (const format of ['mermaid', 'dot', 'vega', 'vega-lite', 'plantuml'])
      expect(renderMarkdown('```' + format + '\n<invalid>\n```').html).toContain(
        `data-format="${format}"`,
      );
  });
  it('bounds documents', () =>
    expect(() => renderMarkdown('x'.repeat(8 * 1024 * 1024 + 1))).toThrow('8 MiB'));
});
describe('path resolution and security policy', () => {
  it('resolves parent, absolute, encoded links and anchors', () => {
    expect(resolveLink('/notes/one/readme.md', '../two.md#A%20B')).toEqual({
      kind: 'local',
      path: '/notes/two.md',
      anchor: 'A B',
    });
    expect(resolveLink('/notes/a.md', '/elsewhere/a%20b.md')).toEqual({
      kind: 'local',
      path: '/elsewhere/a b.md',
      anchor: '',
    });
    expect(resolveLink('/a.md', '#hi')).toEqual({ kind: 'anchor', anchor: 'hi' });
  });
  it.each([
    'javascript:alert(1)',
    'data:text/html,evil',
    'file:///etc/passwd',
    'content://provider/a',
    '//example.org/x',
    '%00.md',
    '%zz',
    '#%zz',
    'a\\b.md',
  ])('blocks unsafe or malformed link %s', (href) =>
    expect(resolveLink('/a.md', href)).toEqual({ kind: 'blocked' }),
  );
  it('retains hidden and non-Markdown entries and orders folders first', () => {
    const result = sortEntries(
      ['.', '..', '.hidden', 'x.md', 'folder'].map((name) => ({
        name,
        path: '/' + name,
        directory: name === 'folder',
      })),
    );
    expect(result.map((e) => e.name)).toEqual(['folder', '.hidden', 'x.md']);
  });
  it('uses opaque sandbox CSP with no filesystem or default network access', () => {
    expect(framePolicy(false)).toContain("connect-src 'none'");
    expect(framePolicy(false)).not.toContain('http:');
    expect(framePolicy(true)).toContain('https: http:');
    expect(framePolicy(true)).not.toContain('ipc:');
    expect(framePolicy(true)).toContain("form-action 'none'");
  });
});

describe('display blocks and numeric references', () => {
  it('renders the supplied bracketed matrix across blank lines and links its tag', () => {
    const source = String.raw`See (7), citation [1], and unknown [99].

[ \begin{bmatrix}Y_a&I\ O&J_R\end{bmatrix} \begin{bmatrix}\mathbf A\\mathbf B\end{bmatrix}

\begin{bmatrix}\kappa^2\mathbf e_0\\mathbf0\end{bmatrix}. \tag{7} ]

## References

[1] A source with https://example.org.
`;
    const html = renderMarkdown(source).html;
    expect(html).toContain('katex-display');
    expect(html).toContain('id="equation-7"');
    expect(html).toContain('href="#equation-7"');
    expect(html).toContain('href="#reference-1"');
    expect(html).not.toContain('href="#reference-99"');
    expect(html).not.toContain('katex-error');
  });
  it('combines three display delimiters, arbitrary pairs, and inline math', () => {
    const html = renderMarkdown(
      String.raw`$$a^2$$

\[b^2\]

%%c^2

+d^2%%

Inline \(e^2\) and [label](https://example.org).`,
      [
        { left: '$$', right: '$$', display: true },
        { left: '\\[', right: '\\]', display: true },
        { left: '%%', right: '%%', display: true },
        { left: '\\(', right: '\\)', display: false },
      ],
    ).html;
    expect((html.match(/class="katex-display"/g) || []).length).toBe(3);
    expect((html.match(/class="katex"/g) || []).length).toBe(4);
    expect(html).toContain('href="https://example.org"');
  });
  it('links ordered bibliography entries without changing existing links, code or plain brackets', () => {
    const html = renderMarkdown(
      'Read [1] and `(7) [1]`. [Existing](https://example.org).\n\n## References\n\n1. Author, title.\n2. Other source.\n\n## Appendix\n\n[This is ordinary prose.]',
    ).html;
    expect(html).toContain('href="#reference-1"');
    expect(html).toContain('id="reference-2"');
    expect(html).toContain('<code>(7) [1]</code>');
    expect(html).toContain('[This is ordinary prose.]');
  });
});

it('keeps links, images and trailing prose before later display equations intact', () => {
  const html = renderMarkdown(String.raw`[Next](./next.md)

![Pixel](./image.png)

$$x$$ followed by prose.

[ \begin{matrix}a&b\end{matrix} ]

$$y$$`).html;
  expect(html).toContain('href="./next.md"');
  expect(html).toContain('src="./image.png"');
  expect(html).toContain('followed by prose.');
  expect((html.match(/class="katex"/g) || []).length).toBe(3);
  expect(html).not.toContain('katex-error');
});

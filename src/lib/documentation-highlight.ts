import { highlightTree, tagHighlighter, tags } from '@lezer/highlight';
import { typst_lezer, typstTags } from 'codemirror-lang-typst/lezer';
import { markdown } from '@codemirror/lang-markdown';
import { StreamLanguage } from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';

type DocumentationLanguage = 'typst' | 'markdown' | 'latex';

const parsers = {
  typst: typst_lezer().language.parser,
  markdown: markdown().language.parser,
  latex: StreamLanguage.define(stex).parser,
};
const languageAliases: Record<string, DocumentationLanguage> = {
  typ: 'typst',
  typst: 'typst',
  md: 'markdown',
  markdown: 'markdown',
  commonmark: 'markdown',
  tex: 'latex',
  latex: 'latex',
};
const highlighter = tagHighlighter([
  {
    tag: [tags.keyword, tags.controlKeyword, tags.heading, tags.typeName, typstTags.interpolated],
    class: 'doc-code-keyword',
  },
  { tag: tags.strong, class: 'doc-code-strong' },
  { tag: tags.emphasis, class: 'doc-code-emphasis' },
  { tag: [tags.link, tags.url], class: 'doc-code-link' },
  {
    tag: [
      tags.variableName,
      tags.propertyName,
      tags.function(tags.variableName),
      tags.special(tags.variableName),
    ],
    class: 'doc-code-name',
  },
  { tag: [tags.string, tags.special(tags.string)], class: 'doc-code-string' },
  { tag: [tags.number, tags.bool, tags.atom], class: 'doc-code-literal' },
  { tag: tags.comment, class: 'doc-code-comment' },
  { tag: [tags.operator, tags.punctuation], class: 'doc-code-punctuation' },
]);

/** Find highlighted spans using the source editor's language parsers. */
export function documentationTokens(
  source: string,
  language: DocumentationLanguage,
): { from: number; to: number; className: string }[] {
  const tree = parsers[language].parse(source);
  const tokens: { from: number; to: number; className: string; fallback: boolean }[] = [];
  highlightTree(tree, highlighter, (from, to, className) => {
    tokens.push({ from, to, className, fallback: false });
  });
  if (language === 'typst')
    tree.iterate({
      enter(node) {
        if (node.name !== 'Ident' || node.from === node.to) return;
        const parent = node.node.parent;
        const isArgumentName = parent?.name === 'Named' && node.from === parent.from;
        tokens.push({
          from: node.from,
          to: node.to,
          className: isArgumentName ? 'doc-code-property' : 'doc-code-name',
          fallback: true,
        });
      },
    });
  tokens.sort((a, b) => a.from - b.from || Number(a.fallback) - Number(b.fallback));
  let end = 0;
  return tokens
    .filter((token) => {
      if (token.from < end) return false;
      end = token.to;
      return true;
    })
    .map(({ from, to, className }) => ({ from, to, className }));
}

function codeText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? '';
  if (node.nodeType === Node.ELEMENT_NODE && node.nodeName === 'BR') return '\n';
  return Array.from(node.childNodes, codeText).join('');
}

/** Highlight recognized fenced code after the documentation has been sanitized. */
export function highlightDocumentation(container: HTMLElement): void {
  for (const code of container.querySelectorAll<HTMLElement>('pre > code[class]')) {
    const languageClass = [...code.classList].find((name) => /^language-/i.test(name));
    const name = languageClass?.slice(9).toLowerCase();
    if (!name || !Object.hasOwn(languageAliases, name)) continue;
    const language = languageAliases[name];
    const source = codeText(code);
    const fragment = document.createDocumentFragment();
    let offset = 0;
    for (const token of documentationTokens(source, language)) {
      fragment.append(document.createTextNode(source.slice(offset, token.from)));
      const span = document.createElement('span');
      span.className = token.className;
      span.textContent = source.slice(token.from, token.to);
      fragment.append(span);
      offset = token.to;
    }
    fragment.append(document.createTextNode(source.slice(offset)));
    code.replaceChildren(fragment);
  }
}

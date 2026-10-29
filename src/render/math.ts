import texmath from 'markdown-it-texmath';
import katex from 'katex';
import type MarkdownIt from 'markdown-it';
import type { Delimiter } from '../lib/types';
import { validateDelimiters } from '../lib/preferences';
const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Use texmath's block parser before Markdown splits blank lines or interprets brackets as links. */
export function configureMath(markdown: InstanceType<typeof MarkdownIt>, pairs: Delimiter[]) {
  const rules = validateDelimiters(pairs).map((pair, index) => {
    const bareBrackets = pair.left === '[' && pair.right === ']';
    const left = escapePattern(pair.left);
    const right = escapePattern(pair.right);
    const pattern = String.raw`${left}([\s\S]+?)${right}`;
    // Stop at the first closing delimiter; trailing prose must remain a Markdown paragraph.
    const blockContent = bareBrackets
      ? String.raw`([\s\S]+?)`
      : String.raw`((?:(?!${right})[\s\S])+?)`;
    const blockPattern = String.raw`${left}${blockContent}${right}(?=[ \t]*(?:\n|$))`;
    return { pair, bareBrackets, pattern, blockPattern, name: `math_${index}` };
  });
  texmath.rules.papyri = {
    inline: rules
      .filter((rule) => !rule.bareBrackets || !rule.pair.display)
      .map(({ pair, pattern, name }) => ({
        name,
        tag: pair.left,
        rex: new RegExp(pattern, 'gy'),
        tmpl: '<span class="math">$1</span>',
        displayMode: pair.display,
      })),
    block: rules
      .filter((rule) => rule.pair.display)
      .map(({ pair, blockPattern, name, bareBrackets }) => {
        const bracketMatch = new RegExp(blockPattern, 'y');
        return {
          name: `${name}_block`,
          tag: pair.left,
          rex: new RegExp(blockPattern, 'gy'),
          tmpl: '<div class="math-block">$1</div>\n',
          pre: bareBrackets
            ? (source: string, _space: boolean, position: number) => {
                // A closed prose/link label cannot consume a later math block's closing bracket.
                const firstLine = source.slice(
                  position + 1,
                  source.indexOf('\n', position) < 0 ? undefined : source.indexOf('\n', position),
                );
                const firstClose = firstLine.indexOf(']');
                if (firstClose >= 0 && !/\\[a-zA-Z]+/.test(firstLine.slice(0, firstClose)))
                  return false;
                bracketMatch.lastIndex = position;
                const content = bracketMatch.exec(source)?.[1];
                return !!content && /\\[a-zA-Z]+/.test(content);
              }
            : undefined,
        };
      }),
  };
  markdown.use(texmath, {
    engine: katex,
    delimiters: 'papyri',
    katexOptions: {
      trust: false,
      strict: 'warn',
      throwOnError: false,
      maxExpand: 1000,
      maxSize: 20,
    },
  });
  for (const name of [...texmath.rules.papyri.inline, ...texmath.rules.papyri.block].map(
    (rule) => rule.name,
  )) {
    const render = markdown.renderer.rules[name]!;
    markdown.renderer.rules[name] = (tokens, index, options, env, renderer) => {
      const html = render(tokens, index, options, env, renderer);
      const id = tokens[index].meta?.equationId;
      return typeof id === 'string'
        ? `<span id="${markdown.utils.escapeHtml(id)}" data-papyri-target="${markdown.utils.escapeHtml(id)}" class="equation-target">${html}</span>`
        : html;
    };
  }
}

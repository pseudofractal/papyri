import type MarkdownIt from 'markdown-it';
/** Link only explicit numeric citation/equation markers with a known target in this document. */
export function configureReferences(markdown: InstanceType<typeof MarkdownIt>) {
  markdown.core.ruler.after('inline', 'numeric_references', (state) => {
    const references = new Map<string, string>();
    const equations = new Map<string, string>();
    let bibliographyLevel = 0;
    let orderedNumber = 0;
    let listDepth = 0;
    let bibliographyListDepth = 0;
    for (let index = 0; index < state.tokens.length; index++) {
      const token = state.tokens[index];
      if (token.type === 'heading_open') {
        const heading = state.tokens[index + 1].content.trim();
        const level = Number(token.tag.slice(1));
        if (/^(references|bibliography|works cited|sources)$/i.test(heading))
          bibliographyLevel = level;
        else if (bibliographyLevel && level <= bibliographyLevel) bibliographyLevel = 0;
      }
      if (token.type === 'ordered_list_open' || token.type === 'bullet_list_open') {
        listDepth++;
        if (token.type === 'ordered_list_open' && bibliographyLevel && !bibliographyListDepth) {
          orderedNumber = Number(token.attrGet('start') || 1);
          bibliographyListDepth = listDepth;
        }
      }
      if (token.type === 'ordered_list_close' || token.type === 'bullet_list_close') {
        if (listDepth === bibliographyListDepth) bibliographyListDepth = 0;
        listDepth--;
      }
      if (token.type === 'list_item_open' && bibliographyListDepth === listDepth && listDepth) {
        const number = String(orderedNumber++);
        const id = `reference-${number}`;
        if (!references.has(number)) {
          token.attrSet('id', id);
          token.attrSet('data-papyri-target', id);
          references.set(number, id);
        }
      }
      if (token.type === 'inline') {
        const definition = /^\[(\d+)\]\s+\S/.exec(token.content);
        if (definition && state.tokens[index - 1]?.type === 'paragraph_open') {
          const number = definition[1];
          const id = `reference-${number}`;
          if (!references.has(number)) {
            state.tokens[index - 1].attrSet('id', id);
            state.tokens[index - 1].attrSet('data-papyri-target', id);
            token.meta = { ...token.meta, referenceDefinition: true };
            references.set(number, id);
          }
        }
      }
      for (const math of [token, ...(token.children || [])]) {
        if (!math.type.startsWith('math_')) continue;
        const number = /\\tag\*?\{(\d+(?:\.\d+)*)\}/.exec(math.content)?.[1];
        if (number && !equations.has(number)) {
          const id = `equation-${number}`;
          math.meta = { ...math.meta, equationId: id };
          equations.set(number, id);
        }
      }
    }
    if (!references.size && !equations.size) return;
    for (const token of state.tokens) {
      if (token.type !== 'inline' || !token.children) continue;
      let linkDepth = 0;
      const children: typeof token.children = [];
      for (const child of token.children) {
        if (
          child.type === 'link_open' ||
          (child.type === 'html_inline' && /^<a\b/i.test(child.content))
        )
          linkDepth++;
        if (
          child.type === 'link_close' ||
          (child.type === 'html_inline' && /^<\/a\b/i.test(child.content))
        )
          linkDepth--;
        if (child.type !== 'text' || linkDepth > 0 || !/[[(]/.test(child.content)) {
          children.push(child);
          continue;
        }
        let offset = 0;
        for (const match of child.content.matchAll(/\[(\d+)\]|\((\d+(?:\.\d+)*)\)/g)) {
          const id = match[1] ? references.get(match[1]) : equations.get(match[2]);
          if (!id || (token.meta?.referenceDefinition && match.index === 0)) continue;
          const text = new state.Token('text', '', 0);
          text.content = child.content.slice(offset, match.index);
          children.push(text);
          const open = new state.Token('link_open', 'a', 1);
          open.attrSet('href', `#${id}`);
          open.attrSet('data-papyri-reference', id);
          const label = new state.Token('text', '', 0);
          label.content = match[0];
          children.push(open, label, new state.Token('link_close', 'a', -1));
          offset = match.index + match[0].length;
        }
        const remaining = new state.Token('text', '', 0);
        remaining.content = child.content.slice(offset);
        children.push(remaining);
      }
      token.children = children;
    }
  });
}

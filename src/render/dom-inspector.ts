/**
 * Small DOM inspection/interaction layer shared by the sandboxed preview
 * frames. Refs are local to the frame and reset when the frame reloads.
 */
export interface DomInspector {
  invoke(action: string, params?: Record<string, unknown>): unknown;
}

export function createDomInspector(root: ParentNode): DomInspector {
  const refs = new Map<string, Element>();
  const byElement = new WeakMap<Element, string>();
  let sequence = 0;

  function reference(element: Element): string {
    const existing = byElement.get(element);
    if (existing && refs.get(existing) === element) return existing;
    if (refs.size > 5000) refs.clear();
    const ref = `frame-${++sequence}`;
    refs.set(ref, element);
    byElement.set(element, ref);
    return ref;
  }

  function element(ref: string): Element {
    const value = refs.get(ref);
    if (!value || !value.isConnected) throw new Error(`Unknown DOM reference: ${ref}`);
    return value;
  }

  function selector(element: Element): string {
    if (element.id && document.querySelectorAll(`#${CSS.escape(element.id)}`).length === 1)
      return `#${CSS.escape(element.id)}`;
    const parts: string[] = [];
    let current: Element | null = element;
    while (current && current !== document.documentElement) {
      let part = current.tagName.toLowerCase();
      if (current.classList.length)
        part +=
          '.' +
          [...current.classList]
            .slice(0, 2)
            .map((name) => CSS.escape(name))
            .join('.');
      const parent: Element | null = current.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter(
          (sibling) => sibling.tagName === current!.tagName,
        );
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }
      parts.unshift(part);
      current = parent;
    }
    return parts.join(' > ');
  }

  function visible(element: Element): boolean {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0'
    );
  }

  function summary(element: Element) {
    const rect = element.getBoundingClientRect();
    const input = element as HTMLInputElement;
    return {
      ref: reference(element),
      selector: selector(element),
      tag: element.tagName.toLowerCase(),
      id: element.id || null,
      classes: [...element.classList],
      role: element.getAttribute('role'),
      ariaLabel: element.getAttribute('aria-label'),
      text: (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 500),
      value: typeof input.value === 'string' ? input.value.slice(0, 500) : null,
      rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      visible: visible(element),
      interactive: element.matches(
        'a,button,input,select,textarea,summary,details,[role],[tabindex]',
      ),
      disabled: Boolean(input.disabled),
      checked: 'checked' in input ? Boolean(input.checked) : null,
      display: getComputedStyle(element).display,
      href: element.getAttribute('href'),
      src: element.getAttribute('src'),
    };
  }

  function query(options: Record<string, unknown>) {
    const search = typeof options.selector === 'string' ? options.selector.trim() : '*';
    if (!search) throw new Error('The selector must not be empty.');
    const limit = Math.max(1, Math.min(1000, Number(options.limit) || 200));
    const nodes = [];
    for (const node of root.querySelectorAll(search)) {
      if (options.includeHidden !== true && !visible(node)) continue;
      nodes.push(summary(node));
      if (nodes.length >= limit) break;
    }
    return { selector: search, count: nodes.length, nodes };
  }

  function get(ref: unknown) {
    const target = element(String(ref));
    const attributes: Record<string, string> = {};
    for (const attribute of [...target.attributes].slice(0, 200))
      attributes[attribute.name] = attribute.value.slice(0, 2000);
    const style = getComputedStyle(target);
    return {
      ...summary(target),
      html: target.outerHTML.slice(0, 200_000),
      text: (target as HTMLElement).innerText?.slice(0, 100_000) ?? '',
      attributes,
      computed: {
        display: style.display,
        visibility: style.visibility,
        position: style.position,
        color: style.color,
        backgroundColor: style.backgroundColor,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        overflow: style.overflow,
        opacity: style.opacity,
        zIndex: style.zIndex,
      },
    };
  }

  function focus(ref: unknown) {
    const target = element(String(ref));
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    (target as HTMLElement).focus?.();
    return { focused: String(ref) };
  }

  function click(ref: unknown) {
    const target = element(String(ref));
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    (target as HTMLElement).focus?.();
    (target as HTMLElement).click?.();
    return { clicked: String(ref) };
  }

  function type(ref: unknown, text: string) {
    const target = element(String(ref));
    const input = target as HTMLInputElement;
    (target as HTMLElement).focus?.();
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    ) {
      input.value = text;
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      return { typed: String(ref), value: input.value };
    }
    if ((target as HTMLElement).isContentEditable) {
      target.textContent = text;
      target.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
      return { typed: String(ref) };
    }
    throw new Error('This DOM node does not accept text.');
  }

  function accessibility() {
    const nodes = [];
    for (const node of root.querySelectorAll(
      'a,button,input,select,textarea,summary,img,h1,h2,h3,h4,h5,h6,[role],[aria-label],[tabindex]',
    )) {
      if (!visible(node)) continue;
      const rect = node.getBoundingClientRect();
      const role =
        node.getAttribute('role') ||
        (node.tagName === 'A'
          ? 'link'
          : node.tagName === 'BUTTON'
            ? 'button'
            : /^H[1-6]$/.test(node.tagName)
              ? 'heading'
              : node.tagName === 'IMG'
                ? 'img'
                : node.tagName === 'INPUT'
                  ? (node as HTMLInputElement).type || 'input'
                  : node.tagName.toLowerCase());
      const name =
        node.getAttribute('aria-label') ||
        node.getAttribute('title') ||
        (node as HTMLElement).innerText?.trim().replace(/\s+/g, ' ').slice(0, 300) ||
        node.getAttribute('alt') ||
        node.getAttribute('placeholder') ||
        '';
      nodes.push({
        ref: reference(node),
        role,
        name,
        tag: node.tagName.toLowerCase(),
        disabled: Boolean((node as HTMLInputElement).disabled),
        checked: 'checked' in node ? Boolean((node as HTMLInputElement).checked) : null,
        value:
          typeof (node as HTMLInputElement).value === 'string'
            ? (node as HTMLInputElement).value.slice(0, 300)
            : null,
        rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      });
      if (nodes.length >= 500) break;
    }
    return { nodes };
  }

  return {
    invoke(action, params = {}) {
      switch (action) {
        case 'query':
          return query(params);
        case 'get':
          return get(params.ref);
        case 'focus':
          return focus(params.ref);
        case 'click':
          return click(params.ref);
        case 'type':
          return type(params.ref, String(params.text ?? ''));
        case 'ax':
          return accessibility();
        default:
          throw new Error(`Unknown DOM action: ${action}`);
      }
    },
  };
}

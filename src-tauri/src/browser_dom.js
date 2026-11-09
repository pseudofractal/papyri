// Injected into website tabs for agent-side DOM inspection and interaction.
(() => {
  if (window.__papyriDom) return;
  const refs = new Map();
  const byElement = new WeakMap();
  let sequence = 0;

  function reference(element) {
    const existing = byElement.get(element);
    if (existing && refs.get(existing) === element) return existing;
    if (refs.size > 5000) refs.clear();
    const ref = `web-${++sequence}`;
    refs.set(ref, element);
    byElement.set(element, ref);
    return ref;
  }

  function element(ref) {
    const value = refs.get(ref);
    if (!value || !value.isConnected) throw new Error(`Unknown DOM reference: ${ref}`);
    return value;
  }

  function selector(element) {
    if (element.id && document.querySelectorAll(`#${CSS.escape(element.id)}`).length === 1)
      return `#${CSS.escape(element.id)}`;
    const parts = [];
    let current = element;
    while (current && current !== document.documentElement) {
      let part = current.tagName.toLowerCase();
      if (current.classList.length)
        part +=
          '.' +
          [...current.classList]
            .slice(0, 2)
            .map((name) => CSS.escape(name))
            .join('.');
      const parent = current.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter(
          (sibling) => sibling.tagName === current.tagName,
        );
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }
      parts.unshift(part);
      current = parent;
    }
    return parts.join(' > ');
  }

  function visible(element) {
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

  function summary(element) {
    const rect = element.getBoundingClientRect();
    const input = element;
    return {
      ref: reference(element),
      selector: selector(element),
      tag: element.tagName.toLowerCase(),
      id: element.id || null,
      classes: [...element.classList],
      role: element.getAttribute('role'),
      ariaLabel: element.getAttribute('aria-label'),
      text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 500),
      value: typeof input.value === 'string' ? input.value.slice(0, 500) : null,
      rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      visible: visible(element),
      interactive: element.matches(
        'a,button,input,select,textarea,summary,details,[role],[tabindex]',
      ),
      disabled: Boolean(input.disabled),
      checked: 'checked' in input ? Boolean(input.checked) : null,
      display: getComputedStyle(element).display,
      href: element.href || null,
      src: element.src || null,
    };
  }

  function query(options = {}) {
    const search = (options.selector || 'body *').trim();
    if (!search) throw new Error('The selector must not be empty.');
    const limit = Math.max(1, Math.min(1000, options.limit || 200));
    const nodes = [];
    for (const node of document.querySelectorAll(search)) {
      if (!options.includeHidden && !visible(node)) continue;
      nodes.push(summary(node));
      if (nodes.length >= limit) break;
    }
    return {
      selector: search,
      count: nodes.length,
      nodes,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  }

  function get(ref) {
    const target = element(ref);
    const attributes = {};
    for (const attribute of [...target.attributes].slice(0, 200))
      attributes[attribute.name] = attribute.value.slice(0, 2000);
    const style = getComputedStyle(target);
    return {
      ...summary(target),
      html: target.outerHTML.slice(0, 200_000),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      text: (target.innerText || '').slice(0, 100_000),
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

  function focus(ref) {
    const target = element(ref);
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.focus?.();
    return { focused: ref };
  }

  function click(ref) {
    const target = element(ref);
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.focus?.();
    target.click();
    return { clicked: ref };
  }

  function type(ref, text) {
    const target = element(ref);
    target.focus?.();
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    ) {
      target.value = text;
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      return { typed: ref, value: target.value };
    }
    if (target.isContentEditable) {
      target.textContent = text;
      target.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
      return { typed: ref };
    }
    throw new Error('This DOM node does not accept text.');
  }

  function clickAt(x, y) {
    const target = document.elementFromPoint(x, y);
    if (!target) throw new Error('No element at that point.');
    target.click();
    return { clicked: reference(target), tag: target.tagName.toLowerCase() };
  }

  function accessibility() {
    const selector =
      'a,button,input,select,textarea,summary,img,h1,h2,h3,h4,h5,h6,[role],[aria-label],[tabindex]';
    const nodes = [];
    for (const node of document.querySelectorAll(selector)) {
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
                  ? node.type || 'input'
                  : node.tagName.toLowerCase());
      const name =
        node.getAttribute('aria-label') ||
        node.getAttribute('title') ||
        (node.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 300) ||
        node.getAttribute('alt') ||
        node.getAttribute('placeholder') ||
        '';
      nodes.push({
        ref: reference(node),
        role,
        name,
        tag: node.tagName.toLowerCase(),
        disabled: Boolean(node.disabled),
        checked: 'checked' in node ? Boolean(node.checked) : null,
        value: typeof node.value === 'string' ? node.value.slice(0, 300) : null,
        rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      });
      if (nodes.length >= 500) break;
    }
    return { nodes, viewport: { width: window.innerWidth, height: window.innerHeight } };
  }

  window.__papyriDom = {
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
          return type(params.ref, params.text || '');
        case 'clickAt':
          return clickAt(params.x, params.y);
        case 'ax':
          return accessibility();
        default:
          throw new Error(`Unknown browser DOM action: ${action}`);
      }
    },
  };
})();

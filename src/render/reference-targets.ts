/** Preserve authored IDs and heading slugs when assigning generated reference targets. */
export function resolveReferenceTargets(root: HTMLElement) {
  const targets = [...root.querySelectorAll<HTMLElement>('[data-mdview-target]')];
  const usedIds = new Set(
    [...root.querySelectorAll('[id]:not([data-mdview-target])')].map((element) => element.id),
  );
  const referenceIds = new Map<string, string>();
  for (const target of targets) {
    const base = target.dataset.mdviewTarget!;
    let id = base;
    let suffix = 1;
    while (usedIds.has(id)) id = `${base}-${suffix++}`;
    usedIds.add(id);
    target.id = id;
    referenceIds.set(base, id);
    target.removeAttribute('data-mdview-target');
  }
  for (const link of root.querySelectorAll<HTMLAnchorElement>('a[data-mdview-reference]')) {
    const id = referenceIds.get(link.dataset.mdviewReference!);
    if (id) link.setAttribute('href', `#${id}`);
    link.removeAttribute('data-mdview-reference');
  }
}

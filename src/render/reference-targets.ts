/** Preserve authored IDs and heading slugs when assigning generated reference targets. */
export function resolveReferenceTargets(root: HTMLElement) {
  const targets = [...root.querySelectorAll<HTMLElement>('[data-papyri-target]')];
  const usedIds = new Set(
    [...root.querySelectorAll('[id]:not([data-papyri-target])')].map((element) => element.id),
  );
  const referenceIds = new Map<string, string>();
  for (const target of targets) {
    const base = target.dataset.papyriTarget!;
    let id = base;
    let suffix = 1;
    while (usedIds.has(id)) id = `${base}-${suffix++}`;
    usedIds.add(id);
    target.id = id;
    referenceIds.set(base, id);
    target.removeAttribute('data-papyri-target');
  }
  for (const link of root.querySelectorAll<HTMLAnchorElement>('a[data-papyri-reference]')) {
    const id = referenceIds.get(link.dataset.papyriReference!);
    if (id) link.setAttribute('href', `#${id}`);
    link.removeAttribute('data-papyri-reference');
  }
}

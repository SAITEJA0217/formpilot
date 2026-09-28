/**
 * Stable selector synthesis.
 *
 * Detection and filling are separate phases, often separated by a round trip
 * through the service worker and an LLM call. In between, the page may re-render.
 * Every detected field therefore carries a selector that can re-resolve it inside
 * its own root, preferring attributes an SPA is least likely to change.
 */

function escapeIdent(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/([^\w-])/g, '\\$1');
}

function isUnique(root: Document | ShadowRoot, selector: string, element: Element): boolean {
  try {
    const found = root.querySelectorAll(selector);
    return found.length === 1 && found[0] === element;
  } catch {
    return false;
  }
}

function nthOfTypeIndex(element: Element): number {
  const parent = element.parentElement;
  if (!parent) return 1;
  let index = 0;
  for (const child of Array.from(parent.children)) {
    if (child.tagName === element.tagName) {
      index += 1;
      if (child === element) return index;
    }
  }
  return 1;
}

/** Build a path of `tag:nth-of-type(n)` steps up to the root. */
function structuralPath(element: Element, root: Document | ShadowRoot, maxDepth = 12): string {
  const steps: string[] = [];
  let current: Element | null = element;
  let depth = 0;
  const rootElement = root instanceof Document ? root.documentElement : null;

  while (current && depth < maxDepth) {
    if (current === rootElement) break;
    steps.unshift(`${current.tagName.toLowerCase()}:nth-of-type(${nthOfTypeIndex(current)})`);
    const parent: Element | null = current.parentElement;
    if (!parent) break;
    current = parent;
    depth += 1;
  }
  return steps.join(' > ');
}

/**
 * Compute a selector that uniquely identifies `element` within `root`.
 * Falls back to a structural path when no attribute is distinctive enough.
 */
export function buildSelector(element: Element, root: Document | ShadowRoot): string {
  const tag = element.tagName.toLowerCase();

  const id = element.getAttribute('id');
  if (id && !/^[0-9]/.test(id)) {
    const selector = `#${escapeIdent(id)}`;
    if (isUnique(root, selector, element)) return selector;
  }

  // `data-testid` style hooks are stable by intent.
  for (const attribute of ['data-testid', 'data-test-id', 'data-qa', 'data-automation-id', 'data-field', 'data-params']) {
    const value = element.getAttribute(attribute);
    if (value && value.length < 120) {
      const selector = `${tag}[${attribute}="${value.replace(/"/g, '\\"')}"]`;
      if (isUnique(root, selector, element)) return selector;
    }
  }

  const name = element.getAttribute('name');
  if (name) {
    const selector = `${tag}[name="${name.replace(/"/g, '\\"')}"]`;
    if (isUnique(root, selector, element)) return selector;
    const type = element.getAttribute('type');
    if (type) {
      const typed = `${tag}[name="${name.replace(/"/g, '\\"')}"][type="${type}"]`;
      if (isUnique(root, typed, element)) return typed;
    }
  }

  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.length < 120) {
    const selector = `${tag}[aria-label="${ariaLabel.replace(/"/g, '\\"')}"]`;
    if (isUnique(root, selector, element)) return selector;
  }

  return structuralPath(element, root);
}

/** Re-resolve a selector produced by `buildSelector`. */
export function resolveSelector(selector: string, root: Document | ShadowRoot): Element | null {
  if (!selector) return null;
  try {
    return root.querySelector(selector);
  } catch {
    return null;
  }
}

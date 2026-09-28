/**
 * Visible-text utilities.
 *
 * Label extraction is only as good as its notion of "text a human can see".
 * These helpers deliberately avoid layout APIs (`offsetParent`, bounding rects)
 * because they are unreliable in test environments and slow on large pages; they
 * use attributes and computed style instead, which is both faster and testable.
 */

const NON_TEXT_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'IFRAME', 'OPTION']);

/** Collapse whitespace and trim. */
export function collapse(text: string | null | undefined): string {
  if (!text) return '';
  return text.replace(/\s+/g, ' ').trim();
}

/** True when an element is hidden from assistive technology or from sight. */
export function isHidden(element: Element): boolean {
  if (element.hasAttribute('hidden')) return true;
  if (element.getAttribute('aria-hidden') === 'true') return true;
  const inlineStyle = element.getAttribute('style') ?? '';
  if (/display\s*:\s*none/i.test(inlineStyle)) return true;
  if (/visibility\s*:\s*hidden/i.test(inlineStyle)) return true;
  const view = element.ownerDocument?.defaultView;
  if (view && typeof view.getComputedStyle === 'function') {
    try {
      const style = view.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return true;
    } catch {
      // Detached or styleless element — fall through to visible.
    }
  }
  return false;
}

/** True when an element or any ancestor is hidden. */
export function isHiddenDeep(element: Element, maxDepth = 12): boolean {
  let current: Element | null = element;
  let depth = 0;
  while (current && depth < maxDepth) {
    if (isHidden(current)) return true;
    current = current.parentElement;
    depth += 1;
  }
  return false;
}

/**
 * Text a sighted user would read inside `element`, skipping hidden subtrees and
 * nested form controls (a control's own value is not its label).
 */
export function visibleText(element: Element, options: { skipControls?: boolean } = {}): string {
  const skipControls = options.skipControls !== false;
  const parts: string[] = [];

  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.nodeValue ?? '';
      if (value.trim()) parts.push(value);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    if (NON_TEXT_TAGS.has(el.tagName)) return;
    if (isHidden(el)) return;
    if (skipControls && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) {
      return;
    }
    for (const child of Array.from(el.childNodes)) walk(child);
  };

  walk(element);
  return collapse(parts.join(' '));
}

/**
 * Contextual text around a control: the nearest ancestors' leading text and the
 * text of preceding siblings. Used as a weak semantic signal and shown to the AI
 * layer for ambiguous fields.
 */
export function nearbyText(element: Element, maxChars = 240, maxAncestors = 3): string {
  const chunks: string[] = [];
  let current: Element | null = element;
  let level = 0;

  while (current && level < maxAncestors && chunks.join(' ').length < maxChars) {
    let sibling = current.previousElementSibling;
    let siblingCount = 0;
    while (sibling && siblingCount < 3) {
      if (!isHidden(sibling)) {
        const text = visibleText(sibling);
        if (text) chunks.push(text);
      }
      sibling = sibling.previousElementSibling;
      siblingCount += 1;
    }
    const parent: Element | null = current.parentElement;
    if (parent && !isHidden(parent)) {
      // Direct text children of the parent, e.g. `<div>City <input></div>`.
      const own = Array.from(parent.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.nodeValue ?? '')
        .join(' ');
      const collapsed = collapse(own);
      if (collapsed) chunks.push(collapsed);
    }
    current = parent;
    level += 1;
  }

  return collapse(chunks.join(' ')).slice(0, maxChars);
}

/** Text immediately preceding a control, the classic implicit label pattern. */
export function precedingText(element: Element, maxChars = 120): string {
  let sibling = element.previousSibling;
  const parts: string[] = [];
  let guard = 0;
  while (sibling && guard < 6 && parts.join(' ').length < maxChars) {
    if (sibling.nodeType === Node.TEXT_NODE) {
      const text = collapse(sibling.nodeValue);
      if (text) parts.unshift(text);
    } else if (sibling.nodeType === Node.ELEMENT_NODE) {
      const el = sibling as Element;
      if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') break;
      if (!isHidden(el)) {
        const text = visibleText(el);
        if (text) parts.unshift(text);
      }
    }
    sibling = sibling.previousSibling;
    guard += 1;
  }
  return collapse(parts.join(' ')).slice(0, maxChars);
}

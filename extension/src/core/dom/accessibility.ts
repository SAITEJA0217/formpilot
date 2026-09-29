/**
 * Accessibility analyzer.
 *
 * Implements the practical subset of the accessible-name computation that form
 * fields actually rely on (HTML-AAM / ARIA 1.2, in precedence order), plus role
 * resolution for custom widgets. Accessible names are the single most reliable
 * label source on well-built modern sites, which is why this runs before the
 * heuristic strategies in `labels.ts`.
 */
import type { LabelSource } from '../../../../shared/types/form';
import { collapse, visibleText } from './text';

export interface AccessibleName {
  name: string;
  source: LabelSource;
}

/** Resolve an IDREF list against the element's *root* (shadow-aware). */
function resolveIdRefs(element: Element, attribute: string): Element[] {
  const value = element.getAttribute(attribute);
  if (!value) return [];
  const root = element.getRootNode();
  const scope: ParentNode =
    root instanceof ShadowRoot || root instanceof Document ? root : (element.ownerDocument as Document);
  const out: Element[] = [];
  for (const id of value.split(/\s+/).filter(Boolean)) {
    let found: Element | null = null;
    if (scope instanceof Document) {
      found = scope.getElementById(id);
    } else {
      try {
        found = scope.querySelector(`#${CSS.escape(id)}`);
      } catch {
        found = null;
      }
    }
    if (found) out.push(found);
  }
  return out;
}

/** `<label for>` elements pointing at this control, plus a wrapping `<label>`. */
export function associatedLabels(element: Element): { forLabels: Element[]; wrapping: Element | null } {
  const forLabels: Element[] = [];
  const id = element.getAttribute('id');
  if (id) {
    const root = element.getRootNode();
    const scope: ParentNode =
      root instanceof ShadowRoot || root instanceof Document ? root : (element.ownerDocument as Document);
    try {
      forLabels.push(...Array.from(scope.querySelectorAll(`label[for="${CSS.escape(id)}"]`)));
    } catch {
      // Ignore malformed ids.
    }
  }
  const wrapping = element.closest('label');
  return { forLabels, wrapping };
}

/**
 * Compute the accessible name. Returns an empty name (with source `none`) when
 * nothing applies — callers then fall back to heuristics.
 */
export function computeAccessibleName(element: Element): AccessibleName {
  const labelledBy = resolveIdRefs(element, 'aria-labelledby');
  if (labelledBy.length > 0) {
    const text = collapse(labelledBy.map((el) => visibleText(el)).join(' '));
    if (text) return { name: text, source: 'aria-labelledby' };
  }

  const ariaLabel = collapse(element.getAttribute('aria-label'));
  if (ariaLabel) return { name: ariaLabel, source: 'aria-label' };

  const { forLabels, wrapping } = associatedLabels(element);
  if (forLabels.length > 0) {
    const text = collapse(forLabels.map((el) => visibleText(el)).join(' '));
    if (text) return { name: text, source: 'label-for' };
  }
  if (wrapping) {
    const text = visibleText(wrapping);
    if (text) return { name: text, source: 'label-wrapping' };
  }

  const title = collapse(element.getAttribute('title'));
  if (title) return { name: title, source: 'title' };

  const placeholder = collapse(element.getAttribute('placeholder'));
  if (placeholder) return { name: placeholder, source: 'placeholder' };

  return { name: '', source: 'none' };
}

/** `aria-describedby`, the standard place form hints live. */
export function computeAccessibleDescription(element: Element): string {
  const described = resolveIdRefs(element, 'aria-describedby');
  if (described.length > 0) {
    const text = collapse(described.map((el) => visibleText(el)).join(' '));
    if (text) return text;
  }
  return '';
}

/** Implicit ARIA role for native form elements. */
function implicitRole(element: Element): string {
  const tag = element.tagName.toLowerCase();
  if (tag === 'textarea') return 'textbox';
  if (tag === 'select') {
    return element.hasAttribute('multiple') || Number(element.getAttribute('size')) > 1
      ? 'listbox'
      : 'combobox';
  }
  if (tag === 'input') {
    const type = (element.getAttribute('type') ?? 'text').toLowerCase();
    switch (type) {
      case 'radio':
        return 'radio';
      case 'checkbox':
        return 'checkbox';
      case 'range':
        return 'slider';
      case 'number':
        return 'spinbutton';
      case 'button':
      case 'submit':
      case 'reset':
      case 'image':
        return 'button';
      case 'hidden':
        return 'none';
      case 'search':
        return 'searchbox';
      default:
        return 'textbox';
    }
  }
  if (tag === 'button') return 'button';
  return '';
}

/** Explicit `role` wins over the implicit one, as in the ARIA spec. */
export function resolveRole(element: Element): string {
  const explicit = element.getAttribute('role');
  if (explicit) {
    const first = explicit.trim().split(/\s+/)[0];
    if (first) return first.toLowerCase();
  }
  return implicitRole(element);
}

/** `aria-required`, `required`, or a required marker the author put in the label. */
export function isRequired(element: Element, labelText: string): boolean {
  if (element.hasAttribute('required')) return true;
  if (element.getAttribute('aria-required') === 'true') return true;
  const container = element.closest('[aria-required="true"], [data-required="true"]');
  if (container) return true;
  return /\*\s*$/.test(labelText.trim()) || /\(\s*required\s*\)/i.test(labelText);
}

/**
 * Jotform adapter.
 *
 * **Status: experimental.** `jotform.com` is unreachable from the build environment, so this
 * adapter is written against Jotform's documented `form-line` markup and validated against a
 * reproduction in `frontend/public/test-forms/jotform-mock.html`. It has never run against
 * the live product.
 *
 * Jotform emits the most conventional markup of the four platforms — real `<input>`s with
 * real `<label for>` — so most of its fields are already handled by the generic engine. The
 * adapter earns its place on two things the generic engine gets wrong:
 *
 * 1. **Composite controls.** An address or a full-name question is one logical question made
 *    of several inputs, each labelled only by a `form-sub-label` ("Street Address", "City").
 *    Without the question container, the sub-labels read as unrelated fields.
 * 2. **Question-level required state**, which Jotform marks on the container's label rather
 *    than on the input.
 */
import type { FieldType, UnifiedField } from '../../../../shared/types/form';
import { collapse, isHidden, visibleText } from '../dom/text';
import type { FormAdapter } from './types';

const LINE = 'li.form-line, div.form-line';
const LABEL = 'label.form-label, .form-label-top, .form-label-left';
const SUB_LABEL = '.form-sub-label';

/** Jotform names its question types on the container. */
function controlType(container: Element): string {
  return container.getAttribute('data-type') ?? '';
}

const COMPOSITE_TYPES = new Set([
  'control_address',
  'control_fullname',
  'control_datetime',
  'control_phone',
  'control_birthdate',
]);

/**
 * The sub-label belonging to one input of a composite question.
 *
 * Jotform renders `<input><span class="form-sub-label">City</span></span>`, and lays address
 * parts out in table cells. Searching the whole question container would return the first
 * sub-label for every input, so look only at the input's own following siblings and then at
 * its immediate cell/wrapper.
 */
function subLabelFor(element: Element): string {
  for (let sibling = element.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
    if (sibling.matches(SUB_LABEL)) return collapse(visibleText(sibling));
    const nested = sibling.querySelector(SUB_LABEL);
    if (nested) return collapse(visibleText(nested));
  }
  const cell = element.closest('td, th, span, div');
  if (cell && cell !== element) {
    const inCell = cell.querySelector(SUB_LABEL);
    if (inCell) return collapse(visibleText(inCell));
  }
  return '';
}

export const jotformAdapter: FormAdapter = {
  id: 'jotform@1-experimental',
  platform: 'jotform',
  priority: 90,
  supportStatus: 'experimental',
  provenance:
    "Written against Jotform's documented form-line markup; validated only against a local " +
    'reproduction. jotform.com is unreachable from the build environment.',

  matches(ctx) {
    return !!ctx.document.querySelector(`${LINE}[data-type]`) || !!ctx.document.querySelector('.jotform-form');
  },

  /**
   * One container per question. A composite question keeps its single container, so its
   * several inputs are grouped under one label instead of appearing as separate questions.
   */
  questionContainers(root) {
    return Array.from(root.querySelectorAll(LINE)).filter((line) => {
      if (isHidden(line)) return false;
      // Headings and page breaks are form lines too, but hold no control.
      return !!line.querySelector('input, textarea, select, [contenteditable="true"]');
    });
  },

  containerLabel(container) {
    const label = container.querySelector(LABEL);
    if (!label) return null;
    const required = !!label.querySelector('.form-required') || container.getAttribute('data-required') === 'true';
    // The required marker is rendered as text inside the label; drop it.
    const clone = label.cloneNode(true) as Element;
    clone.querySelectorAll('.form-required').forEach((mark) => mark.remove());
    const text = collapse(visibleText(clone));
    return text ? { text, required } : null;
  },

  classify(element, container): FieldType | null {
    if (!container) return null;
    if (controlType(container) === 'control_fileupload' && element.getAttribute('type') === 'file') return 'file';
    return null;
  },

  /**
   * For a composite question, qualify each input with its own sub-label so the matcher sees
   * `Address — City` rather than a bare `City` floating next to a bare `Street Address`.
   */
  refineField(field, element, container): UnifiedField {
    const meta: Record<string, string> = { ...(field.platformMeta ?? {}), platform: 'jotform' };
    const type = container ? controlType(container) : '';
    if (type) meta.controlType = type;

    if (!container || !COMPOSITE_TYPES.has(type)) {
      return { ...field, platformMeta: meta };
    }

    meta.composite = 'true';
    const part = subLabelFor(element);
    if (!part) return { ...field, platformMeta: meta };

    meta.compositePart = part;
    const base = field.label ?? '';
    // Avoid `Address — Address` when the sub-label repeats the question.
    const label = base && base.toLowerCase() !== part.toLowerCase() ? `${base} — ${part}` : part;
    return { ...field, label, platformMeta: meta };
  },
};

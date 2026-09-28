/**
 * Microsoft Forms adapter.
 *
 * **Status: experimental.** Microsoft Forms could not be reached from the build
 * environment (the network policy denies `forms.office.com`), so this adapter is written
 * against Microsoft's published `data-automation-id` contract and validated against a
 * reproduction in `frontend/public/test-forms/microsoft-forms-mock.html`. It has never run
 * against the live product. See `research/compatibility-matrix.md`.
 *
 * Design note: every marker below is checked defensively and the adapter only claims a page
 * when it finds a question container. If Microsoft's markup differs from the reproduction,
 * `matches` returns false and the generic engine handles the page — a wrong guess degrades
 * to generic behaviour instead of breaking the form.
 */
import type { FieldOption, FieldType, UnifiedField } from '../../../../shared/types/form';
import { collapse, visibleText } from '../dom/text';
import { buildSelector } from '../detect/selector';
import type { FormAdapter } from './types';

/** Microsoft's automation hooks, which are part of their accessibility contract. */
const QUESTION = '[data-automation-id="questionItem"]';
const TITLE = '[data-automation-id="questionTitle"]';
const REQUIRED_MARK = '[data-automation-id="requiredMark"], [aria-label*="Required" i]';

function rootOf(element: Element): Document | ShadowRoot {
  const root = element.getRootNode();
  if (root instanceof ShadowRoot || root instanceof Document) return root;
  return element.ownerDocument;
}

/** Title text with the required asterisk removed, plus whether it was there. */
function titleOf(container: Element): { text: string; required: boolean } | null {
  const title = container.querySelector(TITLE);
  if (!title) return null;
  const required = !!container.querySelector(REQUIRED_MARK) || /\*\s*$/.test(title.textContent ?? '');
  const text = collapse((title.textContent ?? '').replace(/\*/g, ''));
  return text ? { text, required } : null;
}

export const microsoftFormsAdapter: FormAdapter = {
  id: 'microsoft-forms@1-experimental',
  platform: 'microsoft-forms',
  priority: 90,
  supportStatus: 'experimental',
  provenance:
    'Written against Microsoft Forms\' published data-automation-id markup; validated only ' +
    'against a local reproduction. forms.office.com is unreachable from the build environment.',

  matches(ctx) {
    // A URL match alone is not enough: without the expected markup the generic engine is
    // the better handler, so require a question container to actually be present.
    return !!ctx.document.querySelector(`${QUESTION} ${TITLE}`);
  },

  questionContainers(root) {
    return Array.from(root.querySelectorAll(QUESTION));
  },

  containerLabel(container) {
    return titleOf(container);
  },

  /**
   * Microsoft renders a rating as a radio group of star buttons whose accessible names are
   * `"1 star"`, `"2 stars"`, … Reporting that as a plain radio group works, but tagging it
   * lets the review UI and the matcher treat the values as a scale.
   */
  classify(element, container): FieldType | null {
    if (!container) return null;
    const role = element.getAttribute('role');
    if (role === 'radiogroup' && container.querySelector('[data-automation-id="ratingOption"]')) {
      return 'rating';
    }
    return null;
  },

  /**
   * Microsoft's dropdown keeps its options in a detached listbox that is only rendered
   * while open, so the generic extractor finds nothing. Where the closed button exposes
   * its choices through `aria-owns`/`aria-controls`, resolve them here.
   */
  options(element, _container): FieldOption[] | null {
    const role = element.getAttribute('role');
    if (role !== 'listbox' && role !== 'combobox') return null;

    const root = rootOf(element);
    const ids = `${element.getAttribute('aria-owns') ?? ''} ${element.getAttribute('aria-controls') ?? ''}`
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    const optionElements: Element[] = [];
    for (const id of ids) {
      try {
        const target = root.querySelector(`#${CSS.escape(id)}`);
        if (target) optionElements.push(...Array.from(target.querySelectorAll('[role="option"]')));
      } catch {
        // A malformed id is the page's problem, not ours.
      }
    }
    if (optionElements.length === 0) return null;

    const options = optionElements
      .map((option) => {
        const label = collapse(option.getAttribute('aria-label') ?? visibleText(option));
        return { value: label, label, selected: option.getAttribute('aria-selected') === 'true', selector: buildSelector(option, root) };
      })
      .filter((option) => option.label.length > 0);
    return options.length > 0 ? options : null;
  },

  refineField(field, element, container): UnifiedField {
    const meta: Record<string, string> = { ...(field.platformMeta ?? {}), platform: 'microsoft-forms' };
    const automationId = element.getAttribute('data-automation-id');
    if (automationId) meta.automationId = automationId;
    if (container?.getAttribute('data-automation-id')) meta.container = 'questionItem';

    // Microsoft marks a rating's options `1 star` / `5 stars`; expose the numeric value so
    // a profile value of "4" can map onto "4 stars".
    if (field.type === 'rating' && field.options) {
      const numeric = field.options.every((option) => /\d/.test(option.label));
      if (numeric) meta.scale = 'stars';
    }
    return { ...field, platformMeta: meta };
  },
};

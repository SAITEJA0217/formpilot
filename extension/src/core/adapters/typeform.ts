/**
 * Typeform adapter.
 *
 * **Status: experimental.** `form.typeform.com` is unreachable from the build environment,
 * so this adapter is written against Typeform's `data-qa` contract and validated against a
 * reproduction in `frontend/public/test-forms/typeform-mock.html`. It has never run against
 * the live product.
 *
 * Typeform does not behave like an ordinary HTML form, and two of its properties drive the
 * whole design here:
 *
 * 1. **One question per screen.** The DOM holds the current block only, so a scan sees a
 *    single field and the engine must treat the form as multi-step. Reporting "1 field" on a
 *    30-question form would be wrong, so the adapter surfaces the progress indicator.
 * 2. **Choices are buttons, not inputs.** A multiple-choice option is a `<button>` (or a
 *    `div[role=button]`) with its own label, and there is no `radiogroup` wrapper to group
 *    them. The adapter therefore builds the group itself from the block container.
 */
import type { FieldOption, FieldType, UnifiedField } from '../../../../shared/types/form';
import { collapse, isHidden, visibleText } from '../dom/text';
import { buildSelector } from '../detect/selector';
import type { FormAdapter } from './types';

const BLOCK = '[data-qa="block-container"], [data-qa^="block-"]';
const HEADER = '[data-qa="question-header"], [data-qa="question-title"]';
const CHOICE = '[data-qa="multiple-choice-option"], [data-qa="choice-option"]';
const RATING = '[data-qa="rating-option"], [data-qa^="rating-"]';

function rootOf(element: Element): Document | ShadowRoot {
  const root = element.getRootNode();
  if (root instanceof ShadowRoot || root instanceof Document) return root;
  return element.ownerDocument;
}

/** Choice and rating elements inside a block, in document order. */
function choicesIn(container: Element): Element[] {
  return Array.from(container.querySelectorAll(`${CHOICE}, ${RATING}`)).filter((el) => !isHidden(el));
}

function labelOfChoice(element: Element): string {
  // Typeform puts the visible label in a nested span and often repeats it in aria-label.
  return collapse(
    element.getAttribute('aria-label') ??
      element.getAttribute('data-value') ??
      visibleText(element).replace(/^[A-Z]\s/, ''),
  );
}

export const typeformAdapter: FormAdapter = {
  id: 'typeform@1-experimental',
  platform: 'typeform',
  priority: 90,
  supportStatus: 'experimental',
  provenance:
    "Written against Typeform's data-qa markup; validated only against a local reproduction. " +
    'form.typeform.com is unreachable from the build environment.',

  matches(ctx) {
    return !!ctx.document.querySelector(`${BLOCK} ${HEADER}`) || !!ctx.document.querySelector('[data-qa="form-renderer"]');
  },

  /**
   * Typeform renders answer choices as buttons, which the generic selector excludes by
   * design. Nominate them so the detector can see them at all.
   */
  extraControls(root) {
    return Array.from(root.querySelectorAll(`${CHOICE}, ${RATING}`)).filter((el) => !isHidden(el));
  },

  questionContainers(root) {
    // Only blocks that actually hold a question, so a layout wrapper is not mistaken for one.
    return Array.from(root.querySelectorAll(BLOCK)).filter(
      (block) => !!block.querySelector(HEADER) && !isHidden(block),
    );
  },

  containerLabel(container) {
    const header = container.querySelector(HEADER);
    if (!header) return null;
    const required = !!container.querySelector('[data-qa="required-indicator"]') || /\*\s*$/.test(header.textContent ?? '');
    const text = collapse((header.textContent ?? '').replace(/\*/g, ''));
    return text ? { text, required } : null;
  },

  /**
   * A block whose only controls are choice buttons is a choice question. Typeform gives no
   * `radiogroup`, so without this the detector would report one field per button.
   */
  classify(element, container): FieldType | null {
    if (!container) return null;
    const choices = choicesIn(container);
    if (choices.length === 0) return null;
    if (!choices.includes(element) && !choices.some((choice) => choice.contains(element))) return null;

    if (container.querySelector(RATING)) return 'rating';
    // `aria-multiselectable` or a stated "choose as many" hint marks a multi-select block.
    const multi =
      container.getAttribute('data-qa-multiple') === 'true' ||
      container.querySelector('[aria-multiselectable="true"]') !== null ||
      /choose as many|select all that apply/i.test(container.textContent ?? '');
    return multi ? 'checkbox_group' : 'radio_group';
  },

  options(element, container): FieldOption[] | null {
    if (!container) return null;
    const choices = choicesIn(container);
    if (choices.length === 0) return null;
    // Only answer for the element that represents the group (the first choice), so the
    // detector's grouping sees one field with N options rather than N fields.
    if (choices[0] !== element && !choices[0].contains(element) && !element.contains(choices[0])) {
      return null;
    }
    const root = rootOf(container);
    const options = choices
      .map((choice) => {
        const label = labelOfChoice(choice);
        return {
          value: label,
          label,
          selected: choice.getAttribute('aria-checked') === 'true' || choice.getAttribute('aria-pressed') === 'true',
          selector: buildSelector(choice, root),
        };
      })
      .filter((option) => option.label.length > 0);
    return options.length > 0 ? options : null;
  },

  refineField(field, element, container): UnifiedField {
    const meta: Record<string, string> = { ...(field.platformMeta ?? {}), platform: 'typeform' };
    const qa = element.getAttribute('data-qa') ?? container?.getAttribute('data-qa');
    if (qa) meta.dataQa = qa;
    // Typeform shows one question at a time; record that so the UI can say so.
    meta.oneQuestionPerScreen = 'true';
    return { ...field, platformMeta: meta };
  },
};

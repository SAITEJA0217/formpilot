/**
 * Google Forms adapter.
 *
 * Google Forms renders every question as `div[role="listitem"]` with the question
 * text in a `div[role="heading"]`, and builds its own widgets out of ARIA roles
 * rather than native inputs. All of that knowledge lives here — the generic engine
 * keeps none of it.
 *
 * Grid (matrix) questions are flattened the way v1 flattened them: each grid row
 * becomes its own question labelled `Question: Row`, so a grid of five rows yields
 * five fields. That keeps the answer shape identical to v1 and means existing
 * stored corrections still match.
 */
import type { FieldOption, UnifiedField } from '../../../../shared/types/form';
import { collapse, visibleText } from '../dom/text';
import { buildSelector } from '../detect/selector';
import type { FormAdapter } from './types';
import { descendantSelector } from '../dom/selectors';

const LISTITEM = 'div[role="listitem"]';
const HEADING = 'div[role="heading"]';

function headingText(container: Element): string {
  const heading = container.querySelector(HEADING);
  return heading ? collapse(visibleText(heading)) : '';
}

/** Google marks required questions with a trailing asterisk inside the heading. */
function splitRequired(text: string): { text: string; required: boolean } {
  const required = /\*/.test(text);
  return { text: collapse(text.replace(/\*/g, '')), required };
}

/**
 * The part of a date or time a split input holds.
 *
 * Google does not render `<input type="date">`. A date question is three number inputs and a time
 * question is two, each carrying only an `aria-label` — the question text lives in the heading
 * above them all. So the generic engine labels every one of them with the question, and a date
 * question arrives as three fields indistinguishable from each other: three identical cards in the
 * review panel, and a matcher that will happily write a whole date into the box meant for the day.
 *
 * Keyed on Google's own `aria-label` wording rather than on position, because the order of the
 * inputs follows the form's locale — a US form renders month before day.
 */
const DATE_TIME_PARTS: ReadonlyMap<RegExp, string> = new Map([
  [/^day\b|day of (the )?month/i, 'Day'],
  [/^month\b/i, 'Month'],
  [/^year\b/i, 'Year'],
  [/^hour/i, 'Hour'],
  [/^minute/i, 'Minute'],
  [/^second/i, 'Second'],
  [/am\s*\/?\s*pm|meridiem/i, 'AM/PM'],
]);

/** Which part of a split date/time this input is, or `''` if it is not one. */
function dateTimePart(element: Element): string {
  const own = collapse(element.getAttribute('aria-label') ?? '');
  if (!own) return '';
  for (const [pattern, part] of DATE_TIME_PARTS) {
    if (pattern.test(own)) return part;
  }
  return '';
}

function isGridContainer(container: Element): boolean {
  return !!container.querySelector('div[role="grid"], div[role="table"]');
}

export const googleFormsAdapter: FormAdapter = {
  id: 'google-forms@2',
  platform: 'google-forms',
  priority: 100,
  supportStatus: 'verified',

  matches(ctx) {
    // Markup, not the URL. This adapter used to return true on a `docs.google.com/forms` URL
    // alone, which made it the only one of the five that trusted the address bar — and it is the
    // worst candidate for that, because Google Forms markup is generated and unversioned. If the
    // structure changes, a URL match selects an adapter that then parses nothing and reports zero
    // fields, where falling through to the generic engine would still have found the inputs.
    return !!ctx.document.querySelector(descendantSelector(LISTITEM, HEADING));
  },

  /**
   * One container per logical question. Grid questions are expanded into one
   * container per data row so the generic grouping logic produces one field each.
   */
  questionContainers(root) {
    const containers: Element[] = [];
    for (const listitem of Array.from(root.querySelectorAll(LISTITEM))) {
      if (!isGridContainer(listitem)) {
        containers.push(listitem);
        continue;
      }
      const grid = listitem.querySelector('div[role="grid"], div[role="table"]');
      if (!grid) {
        containers.push(listitem);
        continue;
      }
      const rows = Array.from(grid.querySelectorAll('div[role="row"]'));
      let added = 0;
      rows.forEach((row) => {
        // The first row holds the column headers, not an answerable question.
        if (row.querySelector('div[role="columnheader"]')) return;
        if (!row.querySelector('div[role="rowheader"]')) return;
        containers.push(row);
        added += 1;
      });
      if (added === 0) containers.push(listitem);
    }
    return containers;
  },

  containerLabel(container) {
    const role = container.getAttribute('role');
    if (role === 'row') {
      const rowHeader = container.querySelector('div[role="rowheader"]');
      const rowText = rowHeader ? collapse(visibleText(rowHeader)) : '';
      const listitem = container.closest(LISTITEM);
      const question = listitem ? splitRequired(headingText(listitem)) : { text: '', required: false };
      const combined = question.text && rowText ? `${question.text}: ${rowText}` : rowText || question.text;
      return { text: combined, required: question.required };
    }
    const raw = headingText(container);
    if (!raw) return null;
    return splitRequired(raw);
  },

  /**
   * Grid rows expose their choices as column headers; the row itself only holds
   * unlabelled radio/checkbox nodes, so the options must be read from the header
   * row and paired with the row's controls by index.
   */
  options(_element, container) {
    if (!container || container.getAttribute('role') !== 'row') return null;
    const grid = container.closest('div[role="grid"], div[role="table"]');
    if (!grid) return null;
    const headerRow = Array.from(grid.querySelectorAll('div[role="row"]')).find((row) =>
      row.querySelector('div[role="columnheader"]'),
    );
    if (!headerRow) return null;
    const columns = Array.from(headerRow.querySelectorAll('div[role="columnheader"]'))
      .map((header) => collapse(visibleText(header)))
      .filter((text) => text.length > 0);
    if (columns.length === 0) return null;

    const controls = Array.from(container.querySelectorAll('div[role="radio"], div[role="checkbox"]'));
    if (controls.length === 0) return null;

    // Column headers may include a leading blank cell for the row label.
    const offset = Math.max(0, columns.length - controls.length);
    const root = optionRoot(container);
    const options: FieldOption[] = controls.map((control, index) => {
      const label =
        collapse(control.getAttribute('data-value') ?? control.getAttribute('aria-label') ?? '') ||
        columns[index + offset] ||
        `Option ${index + 1}`;
      return {
        value: label,
        label,
        selected: control.getAttribute('aria-checked') === 'true',
        // Addressed by a real selector rather than an index: a grid row also contains
        // its row-header cell, so counting `nth-of-type` among the row's `div`s picks
        // the wrong control.
        selector: buildSelector(control, root),
      };
    });
    return options;
  },

  refineField(field, element, container) {
    const meta: Record<string, string> = { ...(field.platformMeta ?? {}), platform: 'google-forms' };

    if (container?.getAttribute('role') === 'row') {
      meta.grid = 'row';
    }

    // Linear scale: a radio group whose choices are all numeric.
    if (field.type === 'radio_group' && field.options && field.options.length >= 3) {
      const allNumeric = field.options.every((option) => /^\d+$/.test(option.label.trim()));
      if (allNumeric) meta.scale = 'linear';
    }

    // Google renders dropdowns as a listbox whose options are in the DOM but hidden.
    if (element.getAttribute('role') === 'listbox') {
      meta.widget = 'listbox';
    }

    // A split date or time: qualify each input with the part it holds, the way the Jotform
    // adapter qualifies the inputs of a composite address. `Start date — Day` is answerable;
    // three fields all called `Start date` are not.
    const part = dateTimePart(element);
    let label = field.label;
    if (part) {
      meta.composite = 'true';
      meta.compositePart = part;
      const base = field.label ?? '';
      label = base ? `${base} — ${part}` : part;
    }

    const refined: UnifiedField = { ...field, label, platformMeta: meta };

    // Google Forms never uses native `maxlength`; drop the noise if present.
    if (refined.maxLength === 0) delete refined.maxLength;
    return refined;
  },
};

/** The root a grid option must be resolved against (shadow-aware). */
function optionRoot(element: Element): Document | ShadowRoot {
  const root = element.getRootNode();
  if (root instanceof ShadowRoot || root instanceof Document) return root;
  return element.ownerDocument;
}

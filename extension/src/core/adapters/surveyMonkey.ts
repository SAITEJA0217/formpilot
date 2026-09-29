/**
 * SurveyMonkey adapter.
 *
 * **Status: experimental.** `surveymonkey.com` is unreachable from the build environment, so
 * this adapter is written against SurveyMonkey's published question markup and validated
 * against a reproduction in `frontend/public/test-forms/surveymonkey-mock.html`. It has never
 * run against the live product.
 *
 * SurveyMonkey uses real inputs with real labels, so single-answer questions already work
 * generically. The adapter exists for the two structures the generic engine cannot read:
 *
 * 1. **Matrix questions**, a `<table>` where each row is its own question and the answer
 *    choices are the column headers. Flattened here into one field per row, the same way the
 *    Google Forms adapter flattens a grid — so the two platforms produce the same schema.
 * 2. **Ranking questions**, which are drag-and-drop lists. Detected and reported, but
 *    deliberately **not** filled: reordering by synthetic drag events is unreliable and a
 *    half-applied ranking is worse than none. Documented as unsupported.
 */
import type { FieldOption, FieldType, UnifiedField } from '../../../../shared/types/form';
import { collapse, isHidden, visibleText } from '../dom/text';
import { buildSelector } from '../detect/selector';
import type { FormAdapter } from './types';
import { descendantSelector } from '../dom/selectors';

const QUESTION = '[data-testid^="question"], .question-body, .survey-page-question';
const TITLE = '[data-testid="question-title"], .question-title-container, .qtitle, legend';
const MATRIX = 'table[role="grid"], table.matrix-table, table[data-testid="matrix-table"]';
const RANKING = '[data-testid="ranking-question"], .ranking-question, ol[data-ranking]';

function rootOf(element: Element): Document | ShadowRoot {
  const root = element.getRootNode();
  if (root instanceof ShadowRoot || root instanceof Document) return root;
  return element.ownerDocument;
}

function titleText(container: Element): { text: string; required: boolean } | null {
  const title = container.querySelector(TITLE);
  if (!title || isHidden(title)) return null;
  const required = !!container.querySelector('.required-asterisk, [aria-label*="Required" i]') ||
    /\*\s*$/.test(title.textContent ?? '');
  const text = collapse((title.textContent ?? '').replace(/\*/g, ''));
  return text ? { text, required } : null;
}

/** Column headers of a matrix, skipping the leading blank row-label cell. */
function matrixColumns(table: Element): string[] {
  const headerRow = table.querySelector('thead tr') ?? table.querySelector('tr');
  if (!headerRow) return [];
  return Array.from(headerRow.children)
    .map((cell) => collapse(visibleText(cell)))
    .filter((text) => text.length > 0);
}

export const surveyMonkeyAdapter: FormAdapter = {
  id: 'surveymonkey@1-experimental',
  platform: 'surveymonkey',
  priority: 90,
  supportStatus: 'experimental',
  provenance:
    "Written against SurveyMonkey's published question markup; validated only against a local " +
    'reproduction. surveymonkey.com is unreachable from the build environment. Ranking ' +
    'questions are detected but intentionally not filled.',

  matches(ctx) {
    return !!ctx.document.querySelector(descendantSelector(QUESTION, TITLE));
  },

  /**
   * One container per question, except a matrix, which is expanded into one container per
   * data row so the generic grouping logic produces one field per row.
   */
  questionContainers(root) {
    const containers: Element[] = [];
    for (const question of Array.from(root.querySelectorAll(QUESTION))) {
      if (isHidden(question)) continue;
      const matrix = question.querySelector(MATRIX);
      if (!matrix) {
        containers.push(question);
        continue;
      }
      const rows = Array.from(matrix.querySelectorAll('tbody tr, tr')).filter(
        (row) => !!row.querySelector('input, [role="radio"], [role="checkbox"]'),
      );
      if (rows.length === 0) {
        containers.push(question);
        continue;
      }
      containers.push(...rows);
    }
    return containers;
  },

  containerLabel(container) {
    // A matrix row: qualify the row label with the question it belongs to.
    if (container.tagName === 'TR') {
      const rowHeader = container.querySelector('th, td:first-child, [data-testid="row-label"]');
      const rowText = rowHeader ? collapse(visibleText(rowHeader)) : '';
      const question = container.closest(QUESTION);
      const outer = question ? titleText(question) : null;
      const combined = outer?.text && rowText ? `${outer.text}: ${rowText}` : rowText || outer?.text || '';
      return combined ? { text: combined, required: outer?.required ?? false } : null;
    }
    return titleText(container);
  },

  classify(_element, container): FieldType | null {
    if (!container) return null;
    if (container.closest(RANKING) || container.querySelector(RANKING)) {
      // Detected so the user is told about it; the interaction layer refuses to drive it.
      return 'unknown';
    }
    return null;
  },

  /**
   * A matrix row's choices are the column headers, not anything inside the row. Keyed off
   * the row container rather than the element, so the row's first control carries the whole
   * option set and the detector groups the row into one field.
   */
  options(_element, container): FieldOption[] | null {
    if (!container || container.tagName !== 'TR') return null;
    const table = container.closest(MATRIX);
    if (!table) return null;

    const columns = matrixColumns(table);
    const controls = Array.from(
      container.querySelectorAll('input[type="radio"], input[type="checkbox"], [role="radio"], [role="checkbox"]'),
    );
    if (controls.length === 0) return null;

    const root = rootOf(container);
    // Header rows often carry one extra leading cell for the row labels.
    const offset = Math.max(0, columns.length - controls.length);
    return controls.map((control, index) => {
      // Column header first: a matrix cell's aria-label is typically "<row> <column>", so
      // trusting it would produce options like "Frontend Expert" instead of "Expert".
      const label =
        columns[index + offset] ||
        collapse(control.getAttribute('value') ?? '') ||
        collapse(control.getAttribute('aria-label') ?? '') ||
        `Option ${index + 1}`;
      return {
        value: label,
        label,
        selected:
          control.tagName === 'INPUT'
            ? (control as HTMLInputElement).checked
            : control.getAttribute('aria-checked') === 'true',
        selector: buildSelector(control, root),
      };
    });
  },

  refineField(field, element, container): UnifiedField {
    const meta: Record<string, string> = { ...(field.platformMeta ?? {}), platform: 'surveymonkey' };
    if (container?.tagName === 'TR') meta.matrix = 'row';

    const ranking = container?.closest(RANKING) ?? element.closest(RANKING);
    if (ranking) {
      meta.widget = 'ranking';
      // Refuse it explicitly rather than letting the engine try and half-apply an order.
      return {
        ...field,
        type: 'unknown',
        sensitivity: 'sensitive',
        sensitivityReason:
          'Ranking questions are reordered by dragging. FormPilot does not automate that, so please set the order yourself.',
        platformMeta: meta,
      };
    }
    return { ...field, platformMeta: meta };
  },
};

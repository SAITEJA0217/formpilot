/**
 * Label extraction with recorded provenance.
 *
 * Strategies run in a fixed precedence order, strongest first. Which strategy
 * produced the label is returned alongside it (`LabelSource`) because it is a
 * genuine research variable: detection quality differs enormously between a form
 * that uses `<label for>` and one that relies on visual proximity.
 */
import type { LabelSource } from '../../../../shared/types/form';
import { humanizeIdentifier } from '../../../../shared/matching/normalize';
import { computeAccessibleDescription, computeAccessibleName, isRequired } from './accessibility';
import { collapse, isHidden, precedingText, visibleText } from './text';

export interface ExtractedLabel {
  text: string;
  source: LabelSource;
  description?: string;
  required: boolean;
}

/** Longest label we will accept; beyond this the text is page copy, not a label. */
const MAX_LABEL_LENGTH = 400;

function firstHeadingText(container: Element): string {
  const heading = container.querySelector(
    '[role="heading"], h1, h2, h3, h4, h5, h6, legend, .question-title, [class*="question-text"]',
  );
  if (!heading || isHidden(heading)) return '';
  return visibleText(heading);
}

/** `<fieldset><legend>` — the standard grouping label. */
function legendText(element: Element): string {
  const fieldset = element.closest('fieldset');
  if (!fieldset) return '';
  const legend = fieldset.querySelector('legend');
  if (!legend || isHidden(legend)) return '';
  return visibleText(legend);
}

/** Row/column headers when a form is laid out as a table. */
function tableHeaderText(element: Element): string {
  const cell = element.closest('td, th');
  if (!cell) return '';
  const row = cell.closest('tr');
  if (!row) return '';
  const rowHeader = row.querySelector('th');
  if (rowHeader && rowHeader !== cell && !isHidden(rowHeader)) {
    const text = visibleText(rowHeader);
    if (text) return text;
  }
  // Column header at the same cell index.
  const cells = Array.from(row.children);
  const index = cells.indexOf(cell);
  const table = row.closest('table');
  const headerRow = table?.querySelector('thead tr') ?? table?.querySelector('tr');
  if (headerRow && headerRow !== row && index >= 0) {
    const headerCell = headerRow.children[index];
    if (headerCell && !isHidden(headerCell)) {
      const text = visibleText(headerCell);
      if (text) return text;
    }
  }
  return '';
}

/** True when identifier-derived text contains at least one real word. */
function hasMeaningfulToken(text: string): boolean {
  return text
    .toLowerCase()
    .split(/[^a-z]+/)
    .some((token) => token.length >= 3);
}

export interface LabelOptions {
  /**
   * Platform-provided container whose heading is the authoritative question text
   * (e.g. a Google Forms `div[role="listitem"]`).
   */
  container?: Element | null;
  /** Platform-provided label text, used verbatim when present. */
  platformLabel?: string | null;
  /**
   * Set for a grouped field (a radio or checkbox set) whose primary element is one
   * *option*. That option's own `<label>` names the choice, not the question, so the
   * element's own accessible name must be skipped and the group's name used instead.
   */
  ignoreElementLabel?: boolean;
}

/** The nearest element that represents the group a control belongs to. */
function groupContainer(element: Element): Element | null {
  return element.closest('fieldset, [role="group"], [role="radiogroup"]');
}

/**
 * Extract the best available label for a control, together with a description and
 * the required flag.
 */
export function extractLabel(element: Element, options: LabelOptions = {}): ExtractedLabel {
  const description = collapse(computeAccessibleDescription(element)) || undefined;

  const finish = (text: string, source: LabelSource): ExtractedLabel => {
    const trimmed = collapse(text).slice(0, MAX_LABEL_LENGTH);
    return { text: trimmed, source, description, required: isRequired(element, trimmed) };
  };

  if (options.platformLabel) {
    const text = collapse(options.platformLabel);
    if (text) return finish(text, 'platform-heading');
  }

  // 1–4: accessible name (aria-labelledby, aria-label, label[for], wrapping label).
  // Skipped for a grouped field: see `ignoreElementLabel`.
  const accessible = options.ignoreElementLabel
    ? { name: '', source: 'none' as LabelSource }
    : computeAccessibleName(element);
  if (
    accessible.name &&
    accessible.source !== 'placeholder' &&
    accessible.source !== 'title' &&
    accessible.source !== 'none'
  ) {
    return finish(accessible.name, accessible.source);
  }

  // 4b: for a grouped field, the group element carries the question.
  if (options.ignoreElementLabel) {
    const group = groupContainer(element);
    if (group) {
      const groupName = computeAccessibleName(group);
      if (groupName.name && groupName.source !== 'none' && groupName.source !== 'placeholder') {
        return finish(groupName.name, groupName.source);
      }
      const legend = group.querySelector('legend');
      if (legend && !isHidden(legend)) {
        const text = visibleText(legend);
        if (text) return finish(text, 'fieldset-legend');
      }
    }
  }

  // 5: platform question container heading.
  if (options.container) {
    const heading = firstHeadingText(options.container);
    if (heading) return finish(heading, 'platform-heading');
  }

  // 6: fieldset legend.
  const legend = legendText(element);
  if (legend) return finish(legend, 'fieldset-legend');

  // 7: table header.
  const tableHeader = tableHeaderText(element);
  if (tableHeader) return finish(tableHeader, 'table-header');

  // 8: text immediately before the control.
  const preceding = precedingText(element);
  if (preceding) return finish(preceding, 'preceding-text');

  // 9–10: weaker attribute-derived names.
  if (accessible.source === 'title' || accessible.source === 'placeholder') {
    return finish(accessible.name, accessible.source);
  }
  const placeholder = collapse(element.getAttribute('placeholder'));
  if (placeholder) return finish(placeholder, 'placeholder');

  const nameAttr = element.getAttribute('name') ?? element.getAttribute('id') ?? '';
  const humanized = humanizeIdentifier(nameAttr);
  // A one- or two-character identifier (`a`, `q1`, `x2`) carries no meaning; treating
  // it as a label produces junk that the matcher would then score against the ontology.
  if (humanized && hasMeaningfulToken(humanized)) return finish(humanized, 'name-attribute');

  return finish('', 'none');
}

/**
 * Nearest section heading above a control: an explicit section landmark, a
 * fieldset legend, or the closest preceding heading element in the document.
 */
export function findSectionTitle(element: Element): string {
  const explicit = element.closest('section, fieldset, [role="group"], [role="region"], [data-section]');
  if (explicit) {
    const legend = explicit.querySelector('legend, h1, h2, h3, h4, [role="heading"]');
    if (legend && !isHidden(legend)) {
      const text = visibleText(legend);
      if (text) return collapse(text).slice(0, 160);
    }
    const label = explicit.getAttribute('aria-label') ?? explicit.getAttribute('data-section');
    if (label) return collapse(label).slice(0, 160);
  }

  // Walk backwards through the document order looking for a heading.
  const doc = element.ownerDocument;
  if (!doc) return '';
  const headings = Array.from(doc.querySelectorAll('h1, h2, h3, h4, legend, [role="heading"]'));
  let best = '';
  for (const heading of headings) {
    if (isHidden(heading)) continue;
    const position = heading.compareDocumentPosition(element);
    // Element follows the heading in document order.
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
      const text = visibleText(heading);
      if (text) best = collapse(text).slice(0, 160);
    }
  }
  return best;
}

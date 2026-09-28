/**
 * Section and step inference.
 *
 * Sections give the matcher its context signal ("Education" above a field makes
 * `education.degree` more likely than `experience.job_title`). Step detection lets
 * the session layer know that the form continues beyond what is currently in the
 * DOM, so the engine reports "step 2 of 5" instead of pretending the form is short.
 *
 * Both are heuristic. There is no standard markup for either, so the signals are
 * documented in `research/limitations.md` rather than presented as exact.
 */
import type { FormSection, UnifiedField } from '../../../../shared/types/form';
import { findSectionTitle } from '../dom/labels';
import { collapse, isHidden, visibleText } from '../dom/text';

const SECTION_SELECTOR = 'section, fieldset, [role="group"], [role="region"], [data-section], [role="tabpanel"]';

const STEP_INDICATOR_SELECTOR = [
  '[data-step]',
  '[aria-current="step"]',
  '[role="tab"]',
  '.step',
  '.stepper-item',
  '[class*="step-indicator"]',
  '[class*="wizard-step"]',
  '[class*="progress-step"]',
].join(', ');

export interface SectionAssignment {
  sections: FormSection[];
  /** fieldId → sectionId */
  byField: Map<string, string>;
}

/**
 * Group fields by their nearest enclosing section-like element. Fields with no
 * section container are collected into an implicit default section so that every
 * field belongs somewhere.
 */
export function assignSections(
  fields: UnifiedField[],
  elements: Map<string, { element: Element }>,
): SectionAssignment {
  const containers: Element[] = [];
  const sections: FormSection[] = [];
  const byField = new Map<string, string>();
  const fieldsBySection = new Map<string, string[]>();

  for (const field of fields) {
    const entry = elements.get(field.id);
    if (!entry) continue;
    const container = entry.element.closest(SECTION_SELECTOR);
    let sectionId: string;
    if (container) {
      let index = containers.indexOf(container);
      if (index === -1) {
        containers.push(container);
        index = containers.length - 1;
        const title =
          collapse(container.getAttribute('aria-label') ?? container.getAttribute('data-section') ?? '') ||
          sectionHeading(container) ||
          findSectionTitle(entry.element);
        sections.push({ id: `s${index}`, title: title || undefined, fieldIds: [] });
      }
      sectionId = `s${index}`;
    } else {
      const title = findSectionTitle(entry.element);
      const key = title || '__default__';
      let index = containers.findIndex((c) => c === null);
      // Virtual sections are keyed by title so fields under one heading group up.
      const existing = sections.find((s) => s.id.startsWith('v') && (s.title ?? '__default__') === key);
      if (existing) {
        sectionId = existing.id;
      } else {
        index = sections.length;
        sectionId = `v${index}`;
        sections.push({ id: sectionId, title: title || undefined, fieldIds: [] });
      }
    }
    byField.set(field.id, sectionId);
    const list = fieldsBySection.get(sectionId) ?? [];
    list.push(field.id);
    fieldsBySection.set(sectionId, list);
  }

  for (const section of sections) {
    section.fieldIds = fieldsBySection.get(section.id) ?? [];
  }
  return { sections: sections.filter((s) => s.fieldIds.length > 0), byField };
}

function sectionHeading(container: Element): string {
  const heading = container.querySelector('legend, h1, h2, h3, h4, h5, [role="heading"]');
  if (!heading || isHidden(heading)) return '';
  return collapse(visibleText(heading)).slice(0, 160);
}

export interface StepInfo {
  isMultiStep: boolean;
  currentStep?: number;
  totalSteps?: number;
  /** Human-readable evidence, surfaced in metadata warnings when uncertain. */
  evidence?: string;
}

/**
 * Infer whether the page is one step of a longer flow.
 *
 * Two independent signals: an explicit step/tab indicator list, and a set of
 * sibling fieldsets/panels where some are hidden (the classic hand-rolled wizard).
 */
export function detectSteps(root: Document | ShadowRoot): StepInfo {
  const indicators = Array.from(root.querySelectorAll(STEP_INDICATOR_SELECTOR)).filter((el) => !isHidden(el));
  if (indicators.length >= 2) {
    const currentIndex = indicators.findIndex(
      (el) =>
        el.getAttribute('aria-current') === 'step' ||
        el.getAttribute('aria-selected') === 'true' ||
        el.classList.contains('active') ||
        el.classList.contains('current'),
    );
    return {
      isMultiStep: true,
      totalSteps: indicators.length,
      currentStep: currentIndex >= 0 ? currentIndex + 1 : undefined,
      evidence: `${indicators.length} step indicators`,
    };
  }

  const panels = Array.from(root.querySelectorAll('fieldset, [role="tabpanel"], [data-step-panel]'));
  if (panels.length >= 2) {
    const hidden = panels.filter((p) => isHidden(p));
    if (hidden.length >= 1 && hidden.length < panels.length) {
      const visibleIndex = panels.findIndex((p) => !isHidden(p));
      return {
        isMultiStep: true,
        totalSteps: panels.length,
        currentStep: visibleIndex >= 0 ? visibleIndex + 1 : undefined,
        evidence: `${panels.length} panels, ${hidden.length} hidden`,
      };
    }
  }

  return { isMultiStep: false };
}

/** Best available human title for the form. */
export function detectFormTitle(root: Document | ShadowRoot): string {
  const doc = root instanceof Document ? root : root.ownerDocument;
  const scope: ParentNode = root;
  const heading = scope.querySelector('h1, [role="heading"][aria-level="1"], form[aria-label]');
  if (heading) {
    const aria = heading.getAttribute('aria-label');
    const text = aria ? collapse(aria) : collapse(visibleText(heading));
    if (text) return text.slice(0, 200);
  }
  const title = collapse(doc?.title ?? '');
  return title.slice(0, 200);
}

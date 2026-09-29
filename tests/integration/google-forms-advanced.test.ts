/**
 * Google Forms, the question types the first regression suite does not reach.
 *
 * `google-forms.test.ts` covers short answer, paragraph, multiple choice, checkboxes, dropdown,
 * date, time, linear scale and a radio grid against `google-forms-mock.html`. This file covers the
 * rest of what the release brief names, against `google-forms-advanced-mock.html`, and deliberately
 * leaves the first fixture and its assertions untouched — they are the regression guarantee for the
 * adapter that shipped, and editing them to accommodate new coverage would spend that guarantee.
 *
 * What is new here:
 *
 *   - a CHECKBOX GRID, where each row takes several answers rather than one
 *   - SECTIONS reached by pressing Next, where later questions are absent from the DOM
 *   - a CONDITIONAL branch, so the form has no fixed field count
 *   - Google's SPLIT date and time widgets, which are three and two number inputs
 *   - question DESCRIPTIONS, which must not become part of the question text
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalizeForm } from '../../extension/src/core/normalize/formNormalizer';
import { detectPlatform } from '../../extension/src/core/platform/detect';
import { selectAdapter } from '../../extension/src/core/adapters/registry';
import { buildSuggestions } from '../../shared/matching/pipeline';
import { fillFields } from '../../extension/src/core/interaction/engine';
import {
  attachAriaWidgetBehaviour,
  attachSectionNavigation,
  loadFixture,
} from '../helpers/dom';
import { TEST_PROFILE } from '../helpers/profile';

const GF_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSc/viewform';

/** Every listener is detached between tests: `loadFixture` replaces the markup but not the
 *  document's own listeners, so a second attach would run the navigation handler twice and
 *  advance two sections per click. */
const detach: (() => void)[] = [];
const interactive = (): void => {
  detach.push(attachAriaWidgetBehaviour(), attachSectionNavigation());
};
afterEach(() => {
  while (detach.length > 0) detach.pop()?.();
});

const fields = () => normalizeForm({ href: GF_URL }).form.fields;
const labels = () => fields().map((field) => field.label ?? '');
const click = (selector: string): void => {
  const element = document.querySelector<HTMLElement>(selector);
  expect(element, `fixture should have ${selector}`).toBeTruthy();
  element?.click();
};

describe('the adapter still claims this markup', () => {
  beforeEach(() => loadFixture('google-forms-advanced-mock.html'));

  it('detects Google Forms and selects its adapter', () => {
    const detection = detectPlatform(GF_URL, document);
    expect(detection.platform).toBe('google-forms');
    const selection = selectAdapter({ url: GF_URL, document, platform: 'google-forms' });
    expect(selection.adapter.id).toBe('google-forms@2');
    expect(selection.fallback).toBe(false);
  });

  /** The markup alone must be enough, since a Google Form can be embedded on another origin. */
  it('recognises the markup when the URL says nothing', () => {
    expect(detectPlatform('https://embed.example.test/form', document).platform).toBe(
      'google-forms',
    );
  });

  it('stays a Verified adapter, not an experimental one', () => {
    const selection = selectAdapter({ url: GF_URL, document, platform: 'google-forms' });
    expect(selection.adapter.supportStatus).toBe('verified');
  });
});

describe('split date and time widgets', () => {
  beforeEach(() => loadFixture('google-forms-advanced-mock.html'));

  /**
   * The case that made this fixture worth writing.
   *
   * Google renders a date question as three number inputs carrying only an `aria-label`, with the
   * question text in the heading above all three. Before the fix every one of them came back
   * labelled `Start date`: three identical cards in the review panel, indistinguishable to the user,
   * and a matcher free to write an entire date into the box meant for the day.
   */
  it('qualifies each part of a split date so no two fields share a label', () => {
    const dateFields = fields().filter((field) => field.label?.startsWith('Start date'));
    expect(dateFields).toHaveLength(3);
    expect(dateFields.map((field) => field.label)).toEqual([
      'Start date — Day',
      'Start date — Month',
      'Start date — Year',
    ]);
    expect(new Set(dateFields.map((field) => field.label)).size).toBe(3);
  });

  it('qualifies the parts of a split time the same way', () => {
    const timeFields = fields().filter((field) =>
      field.label?.startsWith('Preferred daily start time'),
    );
    expect(timeFields.map((field) => field.label)).toEqual([
      'Preferred daily start time — Hour',
      'Preferred daily start time — Minute',
    ]);
  });

  it('records the part in platform metadata so the UI can group them', () => {
    const day = fields().find((field) => field.label === 'Start date — Day');
    expect(day?.platformMeta?.composite).toBe('true');
    expect(day?.platformMeta?.compositePart).toBe('Day');
  });

  /**
   * Keyed on Google's own `aria-label` wording, not on position: a US-locale form renders month
   * before day, so a positional rule would mislabel every date on half the world's forms.
   */
  it('reads the part from the input label rather than its position', () => {
    const day = document.querySelector<HTMLElement>('[aria-label="Day of the month"]');
    const year = document.querySelector<HTMLElement>('[aria-label="Year"]');
    // Swap the two inputs in the DOM; the labels must follow the inputs, not the slots.
    const parent = day?.parentElement;
    expect(parent).toBeTruthy();
    if (day && year && parent) parent.insertBefore(year, day);

    const swapped = fields()
      .filter((field) => field.label?.startsWith('Start date'))
      .map((field) => field.label);
    expect(swapped).toEqual(['Start date — Year', 'Start date — Day', 'Start date — Month']);
  });

  it('carries the required marker from the heading onto every part', () => {
    for (const field of fields().filter((f) => f.label?.startsWith('Start date'))) {
      expect(field.required, `${field.label} inherits the question's required marker`).toBe(true);
    }
    for (const field of fields().filter((f) => f.label?.startsWith('Preferred daily'))) {
      expect(field.required).toBe(false);
    }
  });
});

describe('question descriptions', () => {
  beforeEach(() => loadFixture('google-forms-advanced-mock.html'));

  /**
   * Google puts hint text in a line under the heading. Folding it into the question text would
   * hand the matcher "Full Name As it appears on your government ID" — which reads as an
   * identity-document field, not a name, and is exactly the sort of drift that turns a correct
   * mapping into a wrong one.
   */
  it('keeps the description out of the question text', () => {
    expect(labels()).toContain('Full Name');
    expect(labels().join(' | ')).not.toMatch(/government ID/i);
    expect(labels().join(' | ')).not.toMatch(/first day you are available/i);
  });
});

describe('sections reached by pressing Next', () => {
  beforeEach(() => {
    loadFixture('google-forms-advanced-mock.html');
    interactive();
  });

  it('reports only what is reachable now, not the whole form', () => {
    // Sections 2-4 are `hidden`, so their questions must not be counted.
    expect(fields()).toHaveLength(8);
    expect(labels()).not.toContain('Current Company');
    expect(labels()).not.toContain('Phone Number');
  });

  it('re-detects the next section after the form advances', () => {
    click('[data-value="Full time"]');
    click('[data-next]');

    const after = labels();
    expect(after).toContain('Current Company');
    // The first section is gone, not merely appended to.
    expect(after).not.toContain('Full Name');
  });

  it('follows the branch the answer chooses', () => {
    click('[data-value="Contract"]');
    click('[data-next]');

    const after = labels();
    expect(after).toContain('Registered company name');
    expect(after).toContain('Describe your contracting experience');
    // The other branch's section must not appear.
    expect(after).not.toContain('Current Company');
  });

  it('brings the earlier section back on Back, with the same labels', () => {
    const before = labels();
    click('[data-value="Full time"]');
    click('[data-next]');
    click('[data-back]');
    expect(labels()).toEqual(before);
  });

  it('converges both branches on the final section', () => {
    click('[data-value="Contract"]');
    click('[data-next]');
    click('[data-next]');
    expect(labels()).toContain('Phone Number');
    expect(labels()).toContain('Declaration');
  });
});

describe('checkbox grid', () => {
  beforeEach(() => {
    loadFixture('google-forms-advanced-mock.html');
    interactive();
    click('[data-value="Full time"]');
    click('[data-next]');
  });

  /**
   * A checkbox grid is not a radio grid with a different mark. Every row accepts several answers,
   * so a row must come through as a `checkbox_group`; typing it as a `radio_group` would look
   * right in the panel and then silently clear the user's other ticks on write.
   */
  it('flattens each row to a multi-select group, not a single choice', () => {
    const rows = fields().filter((field) => field.label?.startsWith('Which days'));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.type, `${row.label} must accept several answers`).toBe('checkbox_group');
    }
  });

  it('labels each row with its own row header', () => {
    const rows = fields()
      .filter((field) => field.label?.startsWith('Which days'))
      .map((field) => field.label);
    expect(rows).toEqual([
      'Which days can you work on site?: London office',
      'Which days can you work on site?: Client site',
    ]);
  });

  it('reads the choices from the column headers', () => {
    const row = fields().find((field) => field.label?.includes('London office'));
    expect(row?.options?.map((option) => option.label)).toEqual(['Monday', 'Wednesday', 'Friday']);
  });

  it('gives each row its own selectors, so writing one row leaves the other alone', async () => {
    const normalized = normalizeForm({ href: GF_URL });
    const london = normalized.form.fields.find((field) => field.label?.includes('London office'));
    expect(london).toBeTruthy();
    if (!london) return;
    const handle = normalized.elements.get(london.id);
    expect(handle).toBeTruthy();
    if (!handle) return;

    const report = await fillFields(
      [
        {
          target: {
            field: london,
            element: handle.element,
            root: handle.root,
            members: handle.members,
          },
          value: ['Monday', 'Friday'],
        },
      ],
      { platformHandler: normalized.adapter.fillField, interFieldDelayMs: 0 },
    );
    expect(report.filled).toBe(1);

    const ticked = (label: string): string[] => {
      const row = Array.from(document.querySelectorAll('div[role="row"]')).find((candidate) =>
        candidate.querySelector('div[role="rowheader"]')?.textContent?.includes(label),
      );
      return Array.from(row?.querySelectorAll('[role="checkbox"][aria-checked="true"]') ?? []).map(
        (box) => box.getAttribute('data-value') ?? '',
      );
    };
    expect(ticked('London office')).toEqual(['Monday', 'Friday']);
    expect(ticked('Client site'), 'the other row must be untouched').toEqual([]);
  });
});

describe('safety and matching across the sections', () => {
  beforeEach(() => {
    loadFixture('google-forms-advanced-mock.html');
    interactive();
  });

  it('answers the profile-backed questions in the first section', () => {
    const form = normalizeForm({ href: GF_URL }).form;
    const { suggestions } = buildSuggestions(form, TEST_PROFILE);
    const byLabel = new Map(suggestions.map((s) => [s.label ?? '', s]));
    expect(byLabel.get('Full Name')?.value).toBe(TEST_PROFILE.basicProfile?.fullName);
    expect(byLabel.get('Email Address')?.value).toBe(TEST_PROFILE.basicProfile?.email);
  });

  /**
   * The declaration is on the last section, so it is only reachable by walking there. A safety rule
   * that only holds on the first screen is not a safety rule.
   */
  it('refuses the declaration on the final section', () => {
    click('[data-value="Contract"]');
    click('[data-next]');
    click('[data-next]');

    const form = normalizeForm({ href: GF_URL }).form;
    const { suggestions } = buildSuggestions(form, TEST_PROFILE);
    const declaration = suggestions.find((s) => s.label === 'Declaration');
    expect(declaration?.status).toBe('blocked');
    expect(declaration?.reason).toMatch(/consent|agreement/i);
  });

  it('never presses Next or Submit while filling', async () => {
    const normalized = normalizeForm({ href: GF_URL });
    const { suggestions } = buildSuggestions(normalized.form, TEST_PROFILE);
    const visibleBefore = document
      .querySelector<HTMLElement>('[data-section]:not([hidden])')
      ?.getAttribute('data-section');

    const entries = suggestions
      .filter((s) => s.value !== null && s.status !== 'blocked')
      .flatMap((s) => {
        const field = normalized.form.fields.find((f) => f.id === s.fieldId);
        const handle = normalized.elements.get(s.fieldId);
        if (!field || !handle) return [];
        return [
          {
            target: { field, element: handle.element, root: handle.root, members: handle.members },
            value: s.value,
          },
        ];
      });
    await fillFields(entries, {
      platformHandler: normalized.adapter.fillField,
      interFieldDelayMs: 0,
    });

    const visibleAfter = document
      .querySelector<HTMLElement>('[data-section]:not([hidden])')
      ?.getAttribute('data-section');
    expect(visibleAfter, 'filling must not advance the form').toBe(visibleBefore);
    expect((window as unknown as { __submitted?: boolean }).__submitted).not.toBe(true);
  });
});

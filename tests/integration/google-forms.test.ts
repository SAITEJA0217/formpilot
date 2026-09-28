/**
 * Google Forms regression suite.
 *
 * Google Forms was the only platform v1 supported, and it must keep working through the
 * migration. Every question type v1 handled is asserted here: short answer, paragraph,
 * multiple choice, checkboxes, dropdown, date, time, linear scale and grid.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { normalizeForm } from '../../extension/src/core/normalize/formNormalizer';
import { detectPlatform } from '../../extension/src/core/platform/detect';
import { selectAdapter } from '../../extension/src/core/adapters/registry';
import { buildSuggestions } from '../../shared/matching/pipeline';
import { fillFields } from '../../extension/src/core/interaction/engine';
import { attachAriaWidgetBehaviour, loadFixture } from '../helpers/dom';
import { TEST_PROFILE } from '../helpers/profile';

const GF_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSc/viewform';

describe('platform and adapter selection', () => {
  beforeEach(() => loadFixture('google-forms-mock.html'));

  it('recognises Google Forms from the URL', () => {
    const detection = detectPlatform(GF_URL, document);
    expect(detection.platform).toBe('google-forms');
    expect(detection.confidence).toBeGreaterThan(0.9);
  });

  it('recognises Google Forms from DOM markers when the URL is unknown', () => {
    expect(detectPlatform('https://embed.example.test/form', document).platform).toBe('google-forms');
  });

  it('selects the dedicated adapter, not the generic fallback', () => {
    const selection = selectAdapter({ url: GF_URL, document, platform: 'google-forms' });
    expect(selection.adapter.id).toBe('google-forms@2');
    expect(selection.fallback).toBe(false);
    expect(selection.adapter.supportStatus).toBe('verified');
  });
});

describe('question extraction', () => {
  beforeEach(() => loadFixture('google-forms-mock.html'));

  const detect = () => normalizeForm({ href: GF_URL });

  it('reads the question text from the heading and strips the required marker', () => {
    const { form } = detect();
    const labels = form.fields.map((f) => f.label);
    expect(labels).toContain('Full Name');
    expect(labels).toContain('Email Address');
    expect(labels.some((l) => l?.includes('*'))).toBe(false);
    expect(form.fields.every((f) => f.labelSource === 'platform-heading')).toBe(true);
  });

  it('marks required questions as required', () => {
    const { form } = detect();
    const byLabel = new Map(form.fields.map((f) => [f.label, f]));
    expect(byLabel.get('Full Name')?.required).toBe(true);
    expect(byLabel.get('Email Address')?.required).toBe(true);
    expect(byLabel.get('Phone Number')?.required).toBe(false);
  });

  it('classifies every v1-supported question type', () => {
    const { form } = detect();
    const byLabel = new Map(form.fields.map((f) => [f.label, f]));
    expect(byLabel.get('Full Name')?.type).toBe('text');
    expect(byLabel.get('Why do you want to join our team?')?.type).toBe('textarea');
    expect(byLabel.get('Years of Experience')?.type).toBe('radio_group');
    expect(byLabel.get('Technical Skills')?.type).toBe('checkbox_group');
    expect(byLabel.get('Highest Qualification')?.type).toBe('select_one');
    expect(byLabel.get('Date of Birth')?.type).toBe('date');
    expect(byLabel.get('Preferred Interview Time')?.type).toBe('time');
    expect(byLabel.get('Rate your React proficiency')?.type).toBe('radio_group');
  });

  it('extracts choices for radio, checkbox and dropdown questions', () => {
    const { form } = detect();
    const byLabel = new Map(form.fields.map((f) => [f.label, f]));
    expect(byLabel.get('Years of Experience')?.options?.map((o) => o.label)).toEqual([
      '0-2 years',
      '3-5 years',
      '5+ years',
    ]);
    expect(byLabel.get('Technical Skills')?.options?.map((o) => o.label)).toEqual([
      'React',
      'TypeScript',
      'Python',
      'AWS',
    ]);
    // The `Choose` placeholder is dropped from the dropdown.
    expect(byLabel.get('Highest Qualification')?.options?.map((o) => o.label)).toEqual([
      'High School',
      "Bachelor's Degree",
      "Master's Degree",
      'PhD',
    ]);
  });

  it('tags a linear scale so the UI can present it as one', () => {
    const { form } = detect();
    const scale = form.fields.find((f) => f.label === 'Rate your React proficiency')!;
    expect(scale.platformMeta?.scale).toBe('linear');
    expect(scale.options?.map((o) => o.label)).toEqual(['1', '2', '3', '4', '5']);
  });

  it('flattens a grid into one question per row, exactly as v1 did', () => {
    const { form } = detect();
    const gridFields = form.fields.filter((f) => f.platformMeta?.grid === 'row');
    expect(gridFields.map((f) => f.label)).toEqual([
      'Rate your confidence: Frontend',
      'Rate your confidence: Backend',
    ]);
    for (const row of gridFields) {
      expect(row.type).toBe('radio_group');
      expect(row.options?.map((o) => o.label)).toEqual(['Beginner', 'Intermediate', 'Expert']);
    }
  });

  it('detects the whole form as a single-step form with no unreachable content', () => {
    const { form } = detect();
    expect(form.metadata.adapter).toBe('google-forms@2');
    expect(form.metadata.isMultiStep).toBe(false);
    expect(form.metadata.inaccessibleFrames).toBe(0);
    // 10 questions plus the two rows a grid question is flattened into.
    expect(form.fields.length).toBe(12);
  });
});

describe('matching and autofill', () => {
  beforeEach(() => {
    loadFixture('google-forms-mock.html');
    attachAriaWidgetBehaviour();
  });

  it('answers the profile-backed questions confidently', () => {
    const { form } = normalizeForm({ href: GF_URL });
    const byLabel = new Map(buildSuggestions(form, TEST_PROFILE).suggestions.map((s) => [s.label, s]));
    expect(byLabel.get('Full Name')?.value).toBe('Saiteja Reddy Kotha');
    expect(byLabel.get('Full Name')?.status).toBe('ready');
    expect(byLabel.get('Email Address')?.value).toBe('saiteja@example.com');
    expect(byLabel.get('Phone Number')?.value).toBe('+91 98765 43210');
    expect(byLabel.get('Date of Birth')?.value).toBe('2001-07-14');
    expect(byLabel.get('Highest Qualification')?.value).toBe("Bachelor's Degree");
    expect(byLabel.get('Technical Skills')?.value).toEqual(['TypeScript', 'React', 'Python']);
  });

  it('shows provenance for each answer', () => {
    const { form } = normalizeForm({ href: GF_URL });
    const byLabel = new Map(buildSuggestions(form, TEST_PROFILE).suggestions.map((s) => [s.label, s]));
    expect(byLabel.get('Full Name')?.provenance.humanPath).toBe('Personal → Full name');
    expect(byLabel.get('Full Name')?.provenance.profilePath).toBe('basicProfile.fullName');
  });

  it('writes text, date, time, radio and checkbox answers into the real DOM', async () => {
    const normalized = normalizeForm({ href: GF_URL });
    const { suggestions } = buildSuggestions(normalized.form, TEST_PROFILE);

    const entries = suggestions
      .filter((s) => s.value !== null && s.status !== 'blocked')
      .map((s) => {
        const field = normalized.form.fields.find((f) => f.id === s.fieldId)!;
        const handle = normalized.elements.get(s.fieldId)!;
        return {
          target: { field, element: handle.element, root: handle.root, members: handle.members },
          value: s.value,
        };
      });

    const report = await fillFields(entries, { platformHandler: normalized.adapter.fillField, interFieldDelayMs: 0 });
    expect(report.filled).toBeGreaterThanOrEqual(5);

    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="text"]'));
    expect(inputs[0].value).toBe('Saiteja Reddy Kotha');
    expect(inputs[1].value).toBe('saiteja@example.com');
    expect(document.querySelector<HTMLInputElement>('input[type="date"]')?.value).toBe('2001-07-14');

    const checkedSkills = Array.from(document.querySelectorAll('[role="checkbox"][aria-checked="true"]')).map((el) =>
      el.getAttribute('data-value'),
    );
    expect(checkedSkills).toContain('React');
    expect(checkedSkills).toContain('TypeScript');
    expect(checkedSkills).toContain('Python');
    expect(checkedSkills).not.toContain('AWS');
  });

  it('selects one option per grid row without touching the other rows', async () => {
    const normalized = normalizeForm({ href: GF_URL });
    const frontend = normalized.form.fields.find((f) => f.label === 'Rate your confidence: Frontend')!;
    const handle = normalized.elements.get(frontend.id)!;

    const report = await fillFields(
      [
        {
          target: { field: frontend, element: handle.element, root: handle.root, members: handle.members },
          value: 'Expert',
        },
      ],
      { interFieldDelayMs: 0 },
    );

    expect(report.filled).toBe(1);
    const rows = Array.from(document.querySelectorAll('div[role="grid"] div[role="row"]'));
    const frontendRow = rows.find((row) => row.querySelector('[role="rowheader"]')?.textContent === 'Frontend')!;
    const backendRow = rows.find((row) => row.querySelector('[role="rowheader"]')?.textContent === 'Backend')!;
    expect(frontendRow.querySelector('[aria-checked="true"]')?.getAttribute('data-value')).toBe('Expert');
    expect(backendRow.querySelector('[aria-checked="true"]')).toBeNull();
  });

  it('never fills the long-form question without a model answer', async () => {
    const normalized = normalizeForm({ href: GF_URL });
    const { suggestions } = buildSuggestions(normalized.form, TEST_PROFILE);
    const essay = suggestions.find((s) => s.label === 'Why do you want to join our team?')!;
    expect(essay.value).toBeNull();
    expect(document.querySelector('textarea')?.value).toBe('');
  });
});

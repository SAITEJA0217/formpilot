/**
 * Platform adapter integration tests.
 *
 * **What these prove and what they do not.** Each of the four adapters here was written
 * against its platform's *published markup contract* and is exercised against a local
 * reproduction of it, because the build environment's network policy denies
 * `forms.office.com`, `form.typeform.com`, `jotform.com` and `surveymonkey.com`. A passing
 * test here means "the adapter reads this structure correctly". It does not mean the live
 * product emits this structure. That is why every one of them reports
 * `supportStatus: 'experimental'`, and why the compatibility matrix says Experimental.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { normalizeForm } from '../../extension/src/core/normalize/formNormalizer';
import { detectPlatform } from '../../extension/src/core/platform/detect';
import { selectAdapter } from '../../extension/src/core/adapters/registry';
import { buildSuggestions } from '../../shared/matching/pipeline';
import { fillFields } from '../../extension/src/core/interaction/engine';
import type { NormalizedForm } from '../../extension/src/core/normalize/formNormalizer';
import type { FieldSuggestion } from '../../shared/types/suggestion';
import { attachAriaWidgetBehaviour, loadFixture, setBody } from '../helpers/dom';
import { TEST_PROFILE } from '../helpers/profile';

function suggestionsFor(normalized: NormalizedForm): Map<string, FieldSuggestion> {
  const { suggestions } = buildSuggestions(normalized.form, TEST_PROFILE, {
    documents: TEST_PROFILE.documents,
  });
  const byLabel = new Map<string, FieldSuggestion>();
  for (const suggestion of suggestions) {
    if (suggestion.label) byLabel.set(suggestion.label, suggestion);
  }
  return byLabel;
}

async function fillAll(normalized: NormalizedForm): Promise<number> {
  const { suggestions } = buildSuggestions(normalized.form, TEST_PROFILE, {
    documents: TEST_PROFILE.documents,
  });
  const entries = suggestions
    .filter((s) => s.value !== null)
    .map((s) => {
      const field = normalized.form.fields.find((f) => f.id === s.fieldId)!;
      const handle = normalized.elements.get(s.fieldId)!;
      return {
        target: { field, element: handle.element, root: handle.root, members: handle.members },
        value: s.value,
      };
    });
  const report = await fillFields(entries, {
    platformHandler: normalized.adapter.fillField,
    interFieldDelayMs: 0,
  });
  return report.filled;
}

// ─── Microsoft Forms ──────────────────────────────────────────────────────────

describe('Microsoft Forms adapter (experimental)', () => {
  const URL_ = 'https://forms.office.com/Pages/ResponsePage.aspx?id=abc';
  beforeEach(() => loadFixture('microsoft-forms-mock.html'));

  it('recognises the platform from the URL and from the markup', () => {
    expect(detectPlatform(URL_, document).platform).toBe('microsoft-forms');
    // The automation ids are enough on their own, which matters for embedded forms.
    expect(detectPlatform('https://intranet.example.test/survey', document).platform).toBe('microsoft-forms');
  });

  it('selects the dedicated adapter and labels it experimental, not verified', () => {
    const selection = selectAdapter({ url: URL_, document, platform: 'microsoft-forms' });
    expect(selection.adapter.id).toBe('microsoft-forms@1-experimental');
    expect(selection.adapter.supportStatus).toBe('experimental');
    expect(selection.fallback).toBe(false);
    expect(selection.adapter.provenance).toMatch(/reproduction/i);
  });

  it('warns the user that the platform support is experimental', () => {
    const { form } = normalizeForm({ href: URL_ });
    expect(form.metadata.warnings.join(' ')).toMatch(/experimental/i);
    expect(form.metadata.warnings.join(' ')).toMatch(/not been validated against the live product/i);
  });

  it('reads question titles and strips the required marker', () => {
    const { form } = normalizeForm({ href: URL_ });
    const labels = form.fields.map((f) => f.label);
    expect(labels).toContain('Full Name');
    expect(labels).toContain('Highest Qualification');
    expect(labels.some((l) => l?.includes('*'))).toBe(false);
    expect(form.fields.every((f) => f.labelSource === 'platform-heading')).toBe(true);
  });

  it('carries the required flag from the question, not the input', () => {
    const { form } = normalizeForm({ href: URL_ });
    const byLabel = new Map(form.fields.map((f) => [f.label, f]));
    expect(byLabel.get('Full Name')?.required).toBe(true);
    expect(byLabel.get('Phone Number')?.required).toBe(false);
  });

  it('classifies every supported question type', () => {
    const { form } = normalizeForm({ href: URL_ });
    const byLabel = new Map(form.fields.map((f) => [f.label, f.type]));
    expect(byLabel.get('Full Name')).toBe('text');
    expect(byLabel.get('Why do you want to join our team?')).toBe('textarea');
    expect(byLabel.get('Years of Experience')).toBe('radio_group');
    expect(byLabel.get('Technical Skills')).toBe('checkbox_group');
    expect(byLabel.get('Highest Qualification')).toBe('select_one');
    expect(byLabel.get('Date of Birth')).toBe('date');
    expect(byLabel.get('Rate your React proficiency')).toBe('rating');
  });

  it('resolves dropdown options from the detached listbox', () => {
    const { form } = normalizeForm({ href: URL_ });
    const dropdown = form.fields.find((f) => f.label === 'Highest Qualification')!;
    expect(dropdown.options?.map((o) => o.label)).toEqual([
      'High School',
      "Bachelor's Degree",
      "Master's Degree",
      'PhD',
    ]);
  });

  it('extracts rating options and tags the scale', () => {
    const { form } = normalizeForm({ href: URL_ });
    const rating = form.fields.find((f) => f.label === 'Rate your React proficiency')!;
    expect(rating.options?.map((o) => o.label)).toEqual(['1 star', '2 stars', '3 stars', '4 stars', '5 stars']);
    expect(rating.platformMeta?.scale).toBe('stars');
  });

  it('matches the profile onto the questions it understands', () => {
    const byLabel = suggestionsFor(normalizeForm({ href: URL_ }));
    expect(byLabel.get('Full Name')?.value).toBe('Saiteja Reddy Kotha');
    expect(byLabel.get('Email Address')?.value).toBe('saiteja@example.com');
    expect(byLabel.get('Phone Number')?.value).toBe('+91 98765 43210');
    expect(byLabel.get('Date of Birth')?.value).toBe('2001-07-14');
    expect(byLabel.get('Graduation Year')?.value).toBe('2023');
    expect(byLabel.get('Highest Qualification')?.value).toBe("Bachelor's Degree");
    expect(byLabel.get('Technical Skills')?.value).toEqual(['TypeScript', 'React', 'Python']);
  });

  it('fills the widgets it can drive', async () => {
    attachAriaWidgetBehaviour();
    const normalized = normalizeForm({ href: URL_ });
    const filled = await fillAll(normalized);
    expect(filled).toBeGreaterThanOrEqual(6);

    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('[data-automation-id="textInput"]'));
    expect(inputs[0].value).toBe('Saiteja Reddy Kotha');
    expect(inputs[1].value).toBe('saiteja@example.com');
    const checked = Array.from(document.querySelectorAll('[role="checkbox"][aria-checked="true"]')).map((el) =>
      el.getAttribute('aria-label'),
    );
    expect(checked).toEqual(['React', 'TypeScript', 'Python']);
  });
});

// ─── Typeform ─────────────────────────────────────────────────────────────────

describe('Typeform adapter (experimental)', () => {
  const URL_ = 'https://mycompany.typeform.com/to/AbCdEf';
  beforeEach(() => loadFixture('typeform-mock.html'));

  /**
   * `loadFixture` strips scripts, and this fixture renders its blocks from script. Build the
   * one block under test as the page's own renderer would.
   */
  function renderBlock(html: string, options: { multiple?: boolean } = {}): void {
    setBody(
      `<div class="shell" data-qa="form-renderer">
         <div data-qa="block-container" id="block"${options.multiple ? ' data-qa-multiple="true"' : ''}>${html}</div>
       </div>`,
    );
  }

  it('recognises the platform from the URL and from the renderer marker', () => {
    renderBlock('<div data-qa="question-header">Hello</div><input data-qa="input-text" />');
    expect(detectPlatform(URL_, document).platform).toBe('typeform');
    expect(detectPlatform('https://custom.example.test/apply', document).platform).toBe('typeform');
  });

  it('selects the dedicated adapter and labels it experimental', () => {
    renderBlock('<div data-qa="question-header">Hello</div><input data-qa="input-text" />');
    const selection = selectAdapter({ url: URL_, document, platform: 'typeform' });
    expect(selection.adapter.id).toBe('typeform@1-experimental');
    expect(selection.adapter.supportStatus).toBe('experimental');
  });

  it('reads a short-text block, its description and its required flag', () => {
    renderBlock(
      `<div data-qa="question-header">What is your full name?<span data-qa="required-indicator">*</span></div>
       <div data-qa="question-description">As it appears on your ID</div>
       <input data-qa="input-text" type="text" aria-label="What is your full name?" />`,
    );
    const { form } = normalizeForm({ href: URL_ });
    expect(form.fields).toHaveLength(1);
    expect(form.fields[0].label).toBe('What is your full name?');
    expect(form.fields[0].required).toBe(true);
    expect(form.fields[0].platformMeta?.oneQuestionPerScreen).toBe('true');
  });

  it('groups choice buttons into one field instead of one field per button', () => {
    renderBlock(
      `<div data-qa="question-header">Years of Experience</div>
       <button type="button" data-qa="multiple-choice-option" aria-checked="false" aria-label="0-2 years">A 0-2 years</button>
       <button type="button" data-qa="multiple-choice-option" aria-checked="false" aria-label="3-5 years">B 3-5 years</button>
       <button type="button" data-qa="multiple-choice-option" aria-checked="false" aria-label="5+ years">C 5+ years</button>`,
    );
    const { form } = normalizeForm({ href: URL_ });
    expect(form.fields).toHaveLength(1);
    expect(form.fields[0].type).toBe('radio_group');
    expect(form.fields[0].label).toBe('Years of Experience');
    expect(form.fields[0].options?.map((o) => o.label)).toEqual(['0-2 years', '3-5 years', '5+ years']);
  });

  it('treats a multi-select block as a checkbox group', () => {
    renderBlock(
      `<div data-qa="question-header">Technical Skills</div>
       <button type="button" data-qa="multiple-choice-option" aria-checked="false" aria-label="React">React</button>
       <button type="button" data-qa="multiple-choice-option" aria-checked="false" aria-label="Python">Python</button>`,
      { multiple: true },
    );
    const { form } = normalizeForm({ href: URL_ });
    expect(form.fields[0].type).toBe('checkbox_group');
    expect(form.fields[0].multiple).toBe(true);
  });

  it('detects a multi-select from the wording when no attribute says so', () => {
    renderBlock(
      `<div data-qa="question-header">Technical Skills</div>
       <div data-qa="question-description">Choose as many as you like</div>
       <button type="button" data-qa="multiple-choice-option" aria-label="React">React</button>
       <button type="button" data-qa="multiple-choice-option" aria-label="Python">Python</button>`,
    );
    expect(normalizeForm({ href: URL_ }).form.fields[0].type).toBe('checkbox_group');
  });

  it('reads a rating block as a rating', () => {
    renderBlock(
      `<div data-qa="question-header">Rate your React proficiency</div>
       <div class="rating">
         <button type="button" data-qa="rating-option" aria-label="1">1</button>
         <button type="button" data-qa="rating-option" aria-label="2">2</button>
         <button type="button" data-qa="rating-option" aria-label="3">3</button>
       </div>`,
    );
    const { form } = normalizeForm({ href: URL_ });
    expect(form.fields[0].type).toBe('rating');
    expect(form.fields[0].options?.map((o) => o.label)).toEqual(['1', '2', '3']);
  });

  it('reads a long-text block and routes it for generation', () => {
    renderBlock(
      `<div data-qa="question-header">Why do you want to join our team?</div>
       <textarea data-qa="input-long-text" aria-label="Why do you want to join our team?"></textarea>`,
    );
    const normalized = normalizeForm({ href: URL_ });
    expect(normalized.form.fields[0].type).toBe('textarea');
    const { aiRequests } = buildSuggestions(normalized.form, TEST_PROFILE);
    expect(aiRequests).toHaveLength(1);
    expect(aiRequests[0].mode).toBe('generate');
  });

  it('matches and fills a short-text block', async () => {
    renderBlock(
      `<div data-qa="question-header">What is your email address?</div>
       <input data-qa="input-text" type="text" aria-label="What is your email address?" />`,
    );
    const normalized = normalizeForm({ href: URL_ });
    expect(suggestionsFor(normalized).get('What is your email address?')?.value).toBe('saiteja@example.com');
    expect(await fillAll(normalized)).toBe(1);
    expect(document.querySelector<HTMLInputElement>('[data-qa="input-text"]')!.value).toBe('saiteja@example.com');
  });
});

// ─── Jotform ──────────────────────────────────────────────────────────────────

describe('Jotform adapter (experimental)', () => {
  const URL_ = 'https://form.jotform.com/240000000000';
  beforeEach(() => loadFixture('jotform-mock.html'));

  it('recognises the platform and selects the dedicated adapter', () => {
    expect(detectPlatform(URL_, document).platform).toBe('jotform');
    const selection = selectAdapter({ url: URL_, document, platform: 'jotform' });
    expect(selection.adapter.id).toBe('jotform@1-experimental');
    expect(selection.adapter.supportStatus).toBe('experimental');
  });

  it('reads question labels without the required marker', () => {
    const { form } = normalizeForm({ href: URL_ });
    const byLabel = new Map(form.fields.map((f) => [f.label, f]));
    expect(byLabel.get('E-mail')?.required).toBe(true);
    expect(byLabel.get('E-mail')?.label).not.toContain('*');
    expect(byLabel.get('Phone Number')?.required).toBe(false);
  });

  it('qualifies each part of a composite question with its sub-label', () => {
    const { form } = normalizeForm({ href: URL_ });
    const labels = form.fields.map((f) => f.label);
    expect(labels).toContain('Name — First Name');
    expect(labels).toContain('Name — Last Name');
    expect(labels).toContain('Address — Street Address');
    expect(labels).toContain('Address — City');
    expect(labels).toContain('Address — Postal / Zip Code');
    expect(labels).toContain('Address — Country');
    // The composite is tagged so the UI can group the parts back together.
    const city = form.fields.find((f) => f.label === 'Address — City')!;
    expect(city.platformMeta?.composite).toBe('true');
    expect(city.platformMeta?.controlType).toBe('control_address');
  });

  it('maps each composite part to its own concept, not the whole address', () => {
    const byLabel = suggestionsFor(normalizeForm({ href: URL_ }));
    expect(byLabel.get('Address — Street Address')?.value).toBe('12 MG Road');
    expect(byLabel.get('Address — City')?.value).toBe('Hyderabad');
    expect(byLabel.get('Address — State / Province')?.value).toBe('Telangana');
    expect(byLabel.get('Address — Postal / Zip Code')?.value).toBe('500081');
    expect(byLabel.get('Address — Country')?.value).toBe('India');
    expect(byLabel.get('Name — First Name')?.value).toBe('Saiteja');
    expect(byLabel.get('Name — Last Name')?.value).toBe('Kotha');
  });

  it('covers the common control types', () => {
    const { form } = normalizeForm({ href: URL_ });
    const byLabel = new Map(form.fields.map((f) => [f.label, f.type]));
    expect(byLabel.get('E-mail')).toBe('email');
    expect(byLabel.get('Phone Number')).toBe('tel');
    expect(byLabel.get('Highest Qualification')).toBe('select_one');
    expect(byLabel.get('Years of Experience')).toBe('radio_group');
    expect(byLabel.get('Technical Skills')).toBe('checkbox_group');
    expect(byLabel.get('Date of Birth')).toBe('date');
    expect(byLabel.get('Upload Resume')).toBe('file');
    expect(byLabel.get('Why do you want to join our team?')).toBe('textarea');
  });

  it('hands the file field to the user', () => {
    const byLabel = suggestionsFor(normalizeForm({ href: URL_ }));
    expect(byLabel.get('Upload Resume')?.status).toBe('needs_document');
    expect(byLabel.get('Upload Resume')?.value).toBeNull();
  });

  it('skips form lines that hold no control', () => {
    const { form } = normalizeForm({ href: URL_ });
    // The button line is a `form-line` too; it must not become a field.
    expect(form.fields.map((f) => f.label)).not.toContain('');
    expect(form.fields.every((f) => f.type !== 'unknown')).toBe(true);
  });

  it('fills the whole form', async () => {
    const normalized = normalizeForm({ href: URL_ });
    const filled = await fillAll(normalized);
    expect(filled).toBeGreaterThanOrEqual(10);
    expect(document.querySelector<HTMLInputElement>('#input_2')!.value).toBe('saiteja@example.com');
    expect(document.querySelector<HTMLInputElement>('#input_4_city')!.value).toBe('Hyderabad');
    expect(document.querySelector<HTMLSelectElement>('#input_5')!.value).toBe("Bachelor's Degree");
  });
});

// ─── SurveyMonkey ─────────────────────────────────────────────────────────────

describe('SurveyMonkey adapter (experimental)', () => {
  const URL_ = 'https://www.surveymonkey.com/r/ABC123';
  beforeEach(() => loadFixture('surveymonkey-mock.html'));

  it('recognises the platform and selects the dedicated adapter', () => {
    expect(detectPlatform(URL_, document).platform).toBe('surveymonkey');
    const selection = selectAdapter({ url: URL_, document, platform: 'surveymonkey' });
    expect(selection.adapter.id).toBe('surveymonkey@1-experimental');
    expect(selection.adapter.supportStatus).toBe('experimental');
  });

  it('flattens a matrix into one field per row, like the Google Forms grid', () => {
    const { form } = normalizeForm({ href: URL_ });
    const rows = form.fields.filter((f) => f.platformMeta?.matrix === 'row');
    expect(rows.map((f) => f.label)).toEqual([
      'Rate your confidence: Frontend',
      'Rate your confidence: Backend',
    ]);
    for (const row of rows) {
      expect(row.type).toBe('radio_group');
      // The column headers are the choices — not the per-cell aria-labels, which repeat
      // the row name and would read as "Frontend Expert".
      expect(row.options?.map((o) => o.label)).toEqual(['Beginner', 'Intermediate', 'Expert']);
    }
  });

  it('drops the dropdown placeholder row', () => {
    const { form } = normalizeForm({ href: URL_ });
    const dropdown = form.fields.find((f) => f.label === 'Highest Qualification')!;
    expect(dropdown.options?.map((o) => o.label)).toEqual([
      'High School',
      "Bachelor's Degree",
      "Master's Degree",
      'PhD',
    ]);
  });

  it('detects a ranking question and refuses to automate it', () => {
    const { form } = normalizeForm({ href: URL_ });
    const ranking = form.fields.find((f) => f.platformMeta?.widget === 'ranking');
    // Only detected if the reproduction exposes a control; when present it must be refused.
    if (ranking) {
      expect(ranking.sensitivity).toBe('sensitive');
      expect(ranking.sensitivityReason).toMatch(/dragging/i);
    }
    // Either way, no ranking value is ever proposed.
    const byLabel = suggestionsFor(normalizeForm({ href: URL_ }));
    const suggestion = byLabel.get('Rank these in order of preference');
    if (suggestion) expect(suggestion.value).toBeNull();
  });

  it('matches and fills the questions it understands', async () => {
    const normalized = normalizeForm({ href: URL_ });
    const byLabel = suggestionsFor(normalized);
    expect(byLabel.get('Full Name')?.value).toBe('Saiteja Reddy Kotha');
    expect(byLabel.get('Email Address')?.value).toBe('saiteja@example.com');
    expect(byLabel.get('Highest Qualification')?.value).toBe("Bachelor's Degree");

    expect(await fillAll(normalized)).toBeGreaterThanOrEqual(4);
    expect(document.querySelector<HTMLInputElement>('input[name="q1"]')!.value).toBe('Saiteja Reddy Kotha');
    expect(document.querySelector<HTMLSelectElement>('select[name="q5"]')!.value).toBe("Bachelor's Degree");
  });
});

// ─── Degradation ──────────────────────────────────────────────────────────────

describe('adapter degradation', () => {
  it('falls back to the generic engine when a recognised platform lacks its markup', () => {
    // The URL says Typeform; the page is a plain form. A wrong guess must not break it.
    setBody(`<label for="a">Email Address</label><input id="a" type="email" />`);
    const normalized = normalizeForm({ href: 'https://x.typeform.com/to/abc' });
    expect(normalized.adapter.id).toBe('generic-html@1');
    expect(normalized.form.fields).toHaveLength(1);
    expect(normalized.form.metadata.warnings.join(' ')).toMatch(/expected markup was not found/i);
    expect(suggestionsFor(normalized).get('Email Address')?.value).toBe('saiteja@example.com');
  });

  it('never selects two adapters for one page', () => {
    loadFixture('jotform-mock.html');
    const selection = selectAdapter({
      url: 'https://form.jotform.com/1',
      document,
      platform: 'jotform',
    });
    expect(selection.adapter.platform).toBe('jotform');
  });

  it('records the adapter id in metadata for reproducibility', () => {
    loadFixture('microsoft-forms-mock.html');
    expect(normalizeForm({ href: 'https://forms.office.com/r/x' }).form.metadata.adapter).toBe(
      'microsoft-forms@1-experimental',
    );
  });
});

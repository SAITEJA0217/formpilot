/**
 * Detection over the shared test-form corpus.
 *
 * These assertions are the practical definition of "the generic engine works": real
 * fixture markup in, correct unified schema out, with no platform-specific code path.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { normalizeForm } from '../../extension/src/core/normalize/formNormalizer';
import { buildSuggestions } from '../../shared/matching/pipeline';
import { summarize } from '../../shared/matching/summary';
import { loadFixture } from '../helpers/dom';
import { TEST_PROFILE } from '../helpers/profile';

const PAGE_URL = 'https://jobs.example.test/apply';

describe('basic-html.html', () => {
  beforeEach(() => loadFixture('basic-html.html'));

  it('uses the generic adapter and detects every field', () => {
    const { form, adapter } = normalizeForm({ href: PAGE_URL });
    expect(adapter.id).toBe('generic-html@1');
    expect(form.platform).toBe('generic-html');
    expect(form.fields).toHaveLength(9);
    expect(form.fields.every((f) => f.labelSource === 'label-for')).toBe(true);
    expect(form.metadata.isMultiStep).toBe(false);
    expect(form.metadata.inaccessibleFrames).toBe(0);
  });

  it('maps every field to the right concept and value', () => {
    const { form } = normalizeForm({ href: PAGE_URL });
    const { suggestions } = buildSuggestions(form, TEST_PROFILE);
    const byLabel = new Map(suggestions.map((s) => [s.label, s]));

    expect(byLabel.get('Full Name')?.value).toBe('Saiteja Reddy Kotha');
    expect(byLabel.get('Email Address')?.value).toBe('saiteja@example.com');
    expect(byLabel.get('Phone Number')?.value).toBe('+91 98765 43210');
    expect(byLabel.get('Date of Birth')?.value).toBe('2001-07-14');
    expect(byLabel.get('Portfolio URL')?.value).toBe('https://saiteja.dev');
    expect(byLabel.get('City')?.value).toBe('Hyderabad');
    expect(byLabel.get('Postal Code')?.value).toBe('500081');
  });

  it('reaches a high-confidence majority with no model call', () => {
    const { form } = normalizeForm({ href: PAGE_URL });
    const { suggestions, aiRequests } = buildSuggestions(form, TEST_PROFILE);
    const summary = summarize(form, suggestions);
    expect(summary.ready).toBeGreaterThanOrEqual(6);
    expect(summary.blocked).toBe(0);
    // Only the free-text summary warrants the model.
    expect(aiRequests.map((r) => r.label)).toEqual(['Professional Summary']);
  });

  it('carries provenance for every suggested value', () => {
    const { form } = normalizeForm({ href: PAGE_URL });
    const { suggestions } = buildSuggestions(form, TEST_PROFILE);
    for (const suggestion of suggestions.filter((s) => s.value !== null)) {
      expect(suggestion.provenance.conceptId, suggestion.label).toBeTruthy();
      expect(suggestion.provenance.humanPath, suggestion.label).toBeTruthy();
      expect(suggestion.provenance.signals.length, suggestion.label).toBeGreaterThan(0);
    }
  });
});

describe('complex-html.html', () => {
  beforeEach(() => loadFixture('complex-html.html'));

  it('groups radios and checkboxes, and reads sections from fieldsets', () => {
    const { form } = normalizeForm({ href: PAGE_URL });
    const types = form.fields.map((f) => f.type);
    expect(types.filter((t) => t === 'radio_group')).toHaveLength(1);
    expect(types.filter((t) => t === 'checkbox_group')).toHaveLength(1);
    expect(types.filter((t) => t === 'select_one')).toHaveLength(1);
    expect(types.filter((t) => t === 'file')).toHaveLength(1);

    const sectionTitles = form.sections.map((s) => s.title);
    expect(sectionTitles).toContain('Personal details');
    expect(sectionTitles).toContain('Education');
    expect(sectionTitles).toContain('Experience');
  });

  it('labels table-laid-out fields from their row headers', () => {
    const { form } = normalizeForm({ href: PAGE_URL });
    const labels = form.fields.map((f) => f.label);
    expect(labels).toContain('Highest Qualification');
    expect(labels).toContain('Year of Passing');
    expect(labels).toContain('CGPA');
  });

  it('splits a full name for first/last name fields', () => {
    const { form } = normalizeForm({ href: PAGE_URL });
    const byLabel = new Map(buildSuggestions(form, TEST_PROFILE).suggestions.map((s) => [s.label, s]));
    expect(byLabel.get('First Name')?.value).toBe('Saiteja');
    expect(byLabel.get('Last Name')?.value).toBe('Kotha');
    expect(byLabel.get('First Name')?.provenance.origin).toBe('derived');
  });

  it('maps the degree onto the closest available option', () => {
    const { form } = normalizeForm({ href: PAGE_URL });
    const byLabel = new Map(buildSuggestions(form, TEST_PROFILE).suggestions.map((s) => [s.label, s]));
    expect(byLabel.get('Highest Qualification')?.value).toBe("Bachelor's Degree");
  });

  it('routes the file field to the document picker and the essay to generation', () => {
    const { form } = normalizeForm({ href: PAGE_URL });
    const { suggestions, aiRequests } = buildSuggestions(form, TEST_PROFILE, { documents: TEST_PROFILE.documents });
    const byLabel = new Map(suggestions.map((s) => [s.label, s]));
    expect(byLabel.get('Upload Resume')?.status).toBe('needs_document');
    expect(aiRequests.find((r) => r.label === 'Why do you want to join our team?')?.mode).toBe('generate');
  });

  it('treats the gender radio group as a single confirmable field', () => {
    const { form } = normalizeForm({ href: PAGE_URL });
    const gender = form.fields.find((f) => f.type === 'radio_group')!;
    expect(gender.label).toBe('Gender');
    expect(gender.options?.map((o) => o.value)).toEqual(['Female', 'Male', 'Non-binary', 'Prefer not to say']);
  });
});

describe('ambiguous-labels.html', () => {
  beforeEach(() => loadFixture('ambiguous-labels.html'));

  it('detects every field even without proper labels', () => {
    const { form } = normalizeForm({ href: PAGE_URL });
    expect(form.fields).toHaveLength(12);
    // Every field here is labelled, but several only weakly (placeholder or name
    // attribute), and the engine says so rather than implying the same certainty.
    expect(form.metadata.warnings.join(' ')).toMatch(/less reliable|manual review/i);
    expect(form.fields.filter((f) => f.detectionConfidence <= 0.6).length).toBeGreaterThan(0);
  });

  it('does not confidently fill a near-duplicate label with the personal value', () => {
    const { form } = normalizeForm({ href: PAGE_URL });
    const byLabel = new Map(buildSuggestions(form, TEST_PROFILE).suggestions.map((s) => [s.label, s]));
    expect(byLabel.get('Email')?.value).toBe('saiteja@example.com');
    expect(byLabel.get('Company Email')?.value).not.toBe('saiteja@example.com');
    expect(byLabel.get('Reference Name')?.value).not.toBe('Saiteja Reddy Kotha');
  });

  it('still recovers a value from a placeholder or name attribute', () => {
    const { form } = normalizeForm({ href: PAGE_URL });
    const suggestions = buildSuggestions(form, TEST_PROFILE).suggestions;
    const phone = suggestions.find((s) => s.label === 'Enter your mobile number');
    expect(phone?.value).toBe('+91 98765 43210');
    const year = suggestions.find((s) => s.provenance.conceptId === 'education.graduation_year');
    expect(year?.value).toBe('2023');
  });

  it('leaves genuinely meaningless fields for the user', () => {
    const { form } = normalizeForm({ href: PAGE_URL });
    const suggestions = buildSuggestions(form, TEST_PROFILE).suggestions;
    const other = suggestions.find((s) => s.label === 'Other')!;
    expect(['manual', 'no_data', 'needs_review']).toContain(other.status);
    expect(other.value).toBeNull();
  });
});

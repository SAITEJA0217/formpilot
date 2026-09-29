import { describe, expect, it } from 'vitest';
import { buildSuggestions, mergeAIAnswers } from '../../shared/matching/pipeline';
import { summarize } from '../../shared/matching/summary';
import { EMPTY_PROFILE, TEST_PROFILE } from '../helpers/profile';
import { field, form, options } from '../helpers/field';

const sampleForm = () =>
  form(
    [
      field({ id: 'f1', label: 'Full Name', type: 'text', required: true }),
      field({ id: 'f2', label: 'Email Address', type: 'email', required: true }),
      field({ id: 'f3', label: 'Phone Number', type: 'tel' }),
      field({ id: 'f4', label: 'Highest Qualification', type: 'select_one', options: options('High School', "Bachelor's Degree", "Master's Degree", 'PhD') }),
      field({ id: 'f5', label: 'Technical Skills', type: 'checkbox_group', options: options('React', 'TypeScript', 'Rust') }),
      field({ id: 'f6', label: 'Why do you want to join our team?', type: 'textarea' }),
      field({ id: 'f7', label: 'Upload Resume', type: 'file', sensitivity: 'sensitive' }),
      field({ id: 'f8', label: 'Password', type: 'password', sensitivity: 'blocked', sensitivityReason: 'Password fields are never autofilled.' }),
      field({ id: 'f9', label: 'Blorptigan reference code', type: 'text' }),
      field({ id: 'f10', label: 'Date of Birth', type: 'date' }),
    ],
    [{ id: 's0', title: 'Application', fieldIds: ['f1', 'f2', 'f3'] }],
  );

describe('buildSuggestions', () => {
  it('produces one suggestion per non-hidden field', () => {
    const { suggestions } = buildSuggestions(sampleForm(), TEST_PROFILE);
    expect(suggestions).toHaveLength(10);
    expect(new Set(suggestions.map((s) => s.fieldId)).size).toBe(10);
  });

  it('fills obvious fields deterministically, with no AI request', () => {
    const { suggestions, aiRequests } = buildSuggestions(sampleForm(), TEST_PROFILE);
    const byId = new Map(suggestions.map((s) => [s.fieldId, s]));

    expect(byId.get('f1')?.value).toBe('Saiteja Reddy Kotha');
    expect(byId.get('f1')?.status).toBe('ready');
    expect(byId.get('f1')?.band).toBe('high');
    expect(byId.get('f1')?.provenance.usedAI).toBe(false);
    expect(byId.get('f2')?.value).toBe('saiteja@example.com');
    expect(byId.get('f3')?.value).toBe('+91 98765 43210');
    expect(aiRequests.map((r) => r.fieldId)).not.toContain('f1');
    expect(aiRequests.map((r) => r.fieldId)).not.toContain('f2');
  });

  it('coerces a date to the format the control accepts', () => {
    const byId = new Map(buildSuggestions(sampleForm(), TEST_PROFILE).suggestions.map((s) => [s.fieldId, s]));
    expect(byId.get('f10')?.value).toBe('2001-07-14');
    expect(byId.get('f10')?.validation?.valid).toBe(true);
  });

  it('maps a profile value onto the closest available option', () => {
    const byId = new Map(buildSuggestions(sampleForm(), TEST_PROFILE).suggestions.map((s) => [s.fieldId, s]));
    expect(byId.get('f4')?.value).toBe("Bachelor's Degree");
    expect(byId.get('f4')?.confidence).toBeGreaterThan(0.7);
  });

  it('selects only the options that exist, and lowers confidence for partial coverage', () => {
    const byId = new Map(buildSuggestions(sampleForm(), TEST_PROFILE).suggestions.map((s) => [s.fieldId, s]));
    const skills = byId.get('f5');
    // Selection order follows the profile's own skill order, which keeps output
    // deterministic run to run; the DOM outcome is order-independent.
    expect(skills?.value).toEqual(['TypeScript', 'React']);
    expect(skills?.confidence).toBeLessThan(0.9);
  });

  it('routes only the fields that need a model', () => {
    const { aiRequests } = buildSuggestions(sampleForm(), TEST_PROFILE);
    const ids = aiRequests.map((r) => r.fieldId);
    expect(ids).toContain('f6');
    expect(ids).not.toContain('f7');
    expect(ids).not.toContain('f8');
    // Ten fields, at most a couple of model-bound ones: that is the cost argument.
    expect(aiRequests.length).toBeLessThanOrEqual(2);
    expect(aiRequests.find((r) => r.fieldId === 'f6')?.mode).toBe('generate');
  });

  it('never proposes a value for a blocked field', () => {
    const byId = new Map(buildSuggestions(sampleForm(), TEST_PROFILE).suggestions.map((s) => [s.fieldId, s]));
    expect(byId.get('f8')?.status).toBe('blocked');
    expect(byId.get('f8')?.value).toBeNull();
    expect(byId.get('f8')?.reason).toBeTruthy();
  });

  it('asks the user to pick a document for file fields, and names saved documents', () => {
    const byId = new Map(
      buildSuggestions(sampleForm(), TEST_PROFILE, { documents: TEST_PROFILE.documents }).suggestions.map((s) => [
        s.fieldId,
        s,
      ]),
    );
    const resume = byId.get('f7');
    expect(resume?.status).toBe('needs_document');
    expect(resume?.value).toBeNull();
    expect(resume?.reason).toContain('Saiteja_Resume_2026.pdf');
  });

  it('marks an unmatchable short field manual', () => {
    const byId = new Map(buildSuggestions(sampleForm(), TEST_PROFILE).suggestions.map((s) => [s.fieldId, s]));
    expect(byId.get('f9')?.status).toBe('manual');
    expect(byId.get('f9')?.value).toBeNull();
  });

  it('reports no_data when the concept is known but the profile is empty', () => {
    const byId = new Map(buildSuggestions(sampleForm(), EMPTY_PROFILE).suggestions.map((s) => [s.fieldId, s]));
    // Distinct from `manual`: the field was understood, the profile is simply missing
    // the value, which tells the user to go and add it.
    expect(byId.get('f2')?.status).toBe('no_data');
    expect(byId.get('f2')?.value).toBeNull();
    expect(byId.get('f2')?.reason).toMatch(/profile/i);
    // An unmatchable field is manual, not a profile gap.
    expect(byId.get('f9')?.status).toBe('manual');
  });

  it('makes no AI request at all when AI is disabled', () => {
    const { aiRequests, suggestions } = buildSuggestions(sampleForm(), TEST_PROFILE, { allowAI: false });
    expect(aiRequests).toHaveLength(0);
    expect(suggestions.find((s) => s.fieldId === 'f6')?.status).toBe('manual');
  });

  it('prefers a stored correction over inference', () => {
    const { suggestions } = buildSuggestions(sampleForm(), TEST_PROFILE, {
      corrections: [
        {
          originalQuestion: 'Highest Qualification',
          userCorrection: 'PhD',
          timestamp: Date.now(),
          type: 'fact-level',
        },
      ],
    });
    const qualification = suggestions.find((s) => s.fieldId === 'f4');
    expect(qualification?.value).toBe('PhD');
    expect(qualification?.provenance.origin).toBe('correction');
    expect(qualification?.status).toBe('ready');
  });

  it('uses the most recent correction when several exist', () => {
    const { suggestions } = buildSuggestions(sampleForm(), TEST_PROFILE, {
      corrections: [
        { originalQuestion: 'Highest Qualification', userCorrection: 'Old', timestamp: 1 },
        { originalQuestion: 'Highest Qualification', userCorrection: 'New', timestamp: 2 },
      ],
    });
    expect(suggestions.find((s) => s.fieldId === 'f4')?.value).toBe('New');
  });

  it('never applies a correction to a blocked field', () => {
    const { suggestions } = buildSuggestions(sampleForm(), TEST_PROFILE, {
      corrections: [{ originalQuestion: 'Password', userCorrection: 'hunter2', timestamp: Date.now() }],
    });
    const password = suggestions.find((s) => s.fieldId === 'f8');
    expect(password?.status).toBe('blocked');
    expect(password?.value).toBeNull();
  });

  it('respects custom confidence thresholds', () => {
    const strict = buildSuggestions(sampleForm(), TEST_PROFILE, { thresholds: { high: 0.999, medium: 0.99 } });
    expect(strict.suggestions.find((s) => s.fieldId === 'f1')?.status).not.toBe('ready');
  });

  it('does not name a concept it has not committed to', () => {
    const f = form([
      field({ id: 'g1', label: 'Zorblat clearance narrative', type: 'textarea' }),
      field({ id: 'g2', label: 'Why do you want to join our team?', type: 'textarea' }),
      field({ id: 'g3', label: 'Anything else we should know?', type: 'textarea' }),
    ]);
    const byId = new Map(buildSuggestions(f, TEST_PROFILE).suggestions.map((s) => [s.fieldId, s]));
    // g1 is routed to generation because it is long-form, but nothing recognised it, so
    // no concept is claimed and no misleading provenance is shown.
    expect(byId.get('g1')?.status).toBe('needs_review');
    expect(byId.get('g1')?.provenance.conceptId).toBeUndefined();
    expect(byId.get('g1')?.provenance.signals).toEqual([]);
    // These two were recognised, so they do name their concept.
    expect(byId.get('g2')?.provenance.conceptId).toBe('freeform.motivation');
    expect(byId.get('g3')?.provenance.conceptId).toBe('freeform.other');
  });

  it('carries alternatives for review', () => {
    const { suggestions } = buildSuggestions(sampleForm(), TEST_PROFILE);
    const withAlternatives = suggestions.filter((s) => (s.alternatives?.length ?? 0) > 0);
    expect(withAlternatives.length).toBeGreaterThan(0);
  });
});

describe('summarize', () => {
  it('counts suggestions by status', () => {
    const f = sampleForm();
    const { suggestions } = buildSuggestions(f, TEST_PROFILE);
    const summary = summarize(f, suggestions);
    expect(summary.fieldsDetected).toBe(suggestions.length);
    expect(summary.blocked).toBe(1);
    expect(summary.ready).toBeGreaterThanOrEqual(3);
    expect(summary.ready + summary.needsReview + summary.manual + summary.blocked + summary.noData).toBe(
      suggestions.length,
    );
  });
});

describe('mergeAIAnswers', () => {
  it('caps AI confidence below the high band so a draft always passes the user', () => {
    const f = sampleForm();
    const { suggestions } = buildSuggestions(f, TEST_PROFILE);
    const merged = mergeAIAnswers(f, suggestions, [
      { fieldId: 'f6', value: 'I want to join because ...', confidence: 100, model: 'test-model' },
    ]);
    const answer = merged.find((s) => s.fieldId === 'f6');
    expect(answer?.value).toBe('I want to join because ...');
    expect(answer?.confidence).toBeLessThan(0.9);
    expect(answer?.status).toBe('needs_review');
    expect(answer?.provenance.usedAI).toBe(true);
    expect(answer?.provenance.model).toBe('test-model');
  });

  it('accepts confidence given on either 0..1 or 0..100', () => {
    const f = sampleForm();
    const { suggestions } = buildSuggestions(f, TEST_PROFILE);
    const asFraction = mergeAIAnswers(f, suggestions, [{ fieldId: 'f6', value: 'x', confidence: 0.8 }]);
    const asPercent = mergeAIAnswers(f, suggestions, [{ fieldId: 'f6', value: 'x', confidence: 80 }]);
    expect(asFraction.find((s) => s.fieldId === 'f6')?.confidence).toBeCloseTo(
      asPercent.find((s) => s.fieldId === 'f6')!.confidence,
      10,
    );
  });

  it('marks a null answer as no_data rather than inventing one', () => {
    const f = sampleForm();
    const { suggestions } = buildSuggestions(f, TEST_PROFILE);
    const merged = mergeAIAnswers(f, suggestions, [{ fieldId: 'f6', value: null, confidence: 0, explanation: 'nothing in profile' }]);
    const answer = merged.find((s) => s.fieldId === 'f6');
    expect(answer?.status).toBe('no_data');
    expect(answer?.value).toBeNull();
    expect(answer?.reason).toBe('nothing in profile');
  });

  it('refuses an AI answer that does not match any option', () => {
    const f = sampleForm();
    const { suggestions } = buildSuggestions(f, TEST_PROFILE);
    const merged = mergeAIAnswers(f, suggestions, [{ fieldId: 'f4', value: 'Certificate in Welding', confidence: 90 }]);
    const answer = merged.find((s) => s.fieldId === 'f4');
    expect(answer?.status).toBe('manual');
    expect(answer?.reason).toMatch(/choice/i);
  });

  it('ignores answers for blocked or document fields', () => {
    const f = sampleForm();
    const { suggestions } = buildSuggestions(f, TEST_PROFILE, { documents: TEST_PROFILE.documents });
    const merged = mergeAIAnswers(f, suggestions, [
      { fieldId: 'f8', value: 'hunter2', confidence: 99 },
      { fieldId: 'f7', value: '/etc/passwd', confidence: 99 },
    ]);
    expect(merged.find((s) => s.fieldId === 'f8')?.value).toBeNull();
    expect(merged.find((s) => s.fieldId === 'f7')?.value).toBeNull();
  });

  it('ignores answers for fields that are not in the form', () => {
    const f = sampleForm();
    const { suggestions } = buildSuggestions(f, TEST_PROFILE);
    const merged = mergeAIAnswers(f, suggestions, [{ fieldId: 'nope', value: 'x', confidence: 90 }]);
    expect(merged).toEqual(suggestions);
  });
});

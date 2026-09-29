/**
 * Two defects found by walking a six-step application end to end.
 *
 * Both came from `frontend/public/test-forms/multi-step-application.html`, whose questions step was
 * written to tempt a wrong structured mapping rather than to be easy, and whose review step ends the
 * way real applications end — a declaration and a typed signature.
 *
 * **1. A signature was pre-accepted.** "Type your full name to sign" is a text input whose label
 * contains "full name", so the matcher answered it with the profile's name at 0.93 — above the
 * auto-accept band. FormPilot signed the application, and the user would have found out afterwards.
 * The consent rule did not catch it because that rule only applies to boolean controls, and a
 * signature is not a checkbox. Signing is the same kind of act as ticking "I agree", so it is now
 * refused for every control type.
 *
 * **2. A prose question was answered with a stored value.** "How would your last manager describe
 * you?" resolved to `person.last_name` and offered "Kotha", because `person.last_name` carries a bare
 * `last` alias — which exists for the forms that label their columns "First" and "Last", and which
 * containment then found inside a seven-word sentence. "Which company do you admire most and why?"
 * resolved to the user's own employer at 0.93 and arrived pre-accepted.
 *
 * Neither fix is a phrase list. The first is a policy rule applied to all control types; the second
 * is two structural rules — a one-word alias stops being evidence inside a long label, and a prose
 * marker anywhere in a question counts, not only at its start.
 */
import { describe, expect, it } from 'vitest';
import { evaluateFieldSafety } from '../../shared/safety/policy';
import { normalizeForm } from '../../extension/src/core/normalize/formNormalizer';
import { buildSuggestions } from '../../shared/matching/pipeline';
import { setBody } from '../helpers/dom';
import { TEST_PROFILE } from '../helpers/profile';

const URL = 'https://careers.example.test/apply';

/** Score one label as a single-field page, through the real pipeline. */
function score(label: string, tag = 'input'): {
  status: string;
  conceptId: string | null;
  confidence: number;
  value: unknown;
  reason: string;
} {
  const control =
    tag === 'textarea' ? `<textarea id="f" name="f" rows="4"></textarea>` : `<input id="f" name="f" />`;
  setBody(`<form><label for="f">${label}</label>${control}</form>`);
  const { form } = normalizeForm({ href: URL });
  const { suggestions } = buildSuggestions(form, TEST_PROFILE);
  const suggestion = suggestions[0];
  return {
    status: suggestion?.status ?? 'none',
    conceptId: suggestion?.provenance?.conceptId ?? null,
    confidence: suggestion?.confidence ?? 0,
    value: suggestion?.value ?? null,
    reason: suggestion?.reason ?? '',
  };
}

describe('signing is the user’s own act', () => {
  const SIGNATURES = [
    'Type your full name to sign',
    'Signature',
    'Applicant signature',
    'Electronic signature',
    'E-signature',
    'Digital signature (type your name)',
    'Sign here',
    'Sign below to confirm',
    'Please sign this application',
    'Signature of applicant',
    'Authorised signature',
  ];

  for (const label of SIGNATURES) {
    it(`refuses ${JSON.stringify(label)}`, () => {
      expect(evaluateFieldSafety({ type: 'text', label }).sensitivity).toBe('blocked');
    });
  }

  /** The original miss, verbatim, through the whole pipeline rather than at the policy alone. */
  it('never pre-accepts a typed signature, end to end', () => {
    const result = score('Type your full name to sign');
    expect(result.status).toBe('blocked');
    expect(result.reason).toMatch(/only you can do/i);
    expect(result.value).toBeNull();
  });

  it('applies to every control type, not just checkboxes', () => {
    for (const type of ['text', 'textarea', 'unknown'] as const) {
      expect(
        evaluateFieldSafety({ type, label: 'Signature' }).sensitivity,
        `${type} must be refused too`,
      ).toBe('blocked');
    }
  });

  /** Over-blocking is a defect too: an email signature is a block of text a user wants filled. */
  const NOT_SIGNING = [
    'Email signature',
    'Mail signature',
    'Signature block for outgoing mail',
    'Signature dish',
    'Signature move',
    'Method signature',
  ];
  for (const label of NOT_SIGNING) {
    it(`leaves ${JSON.stringify(label)} alone`, () => {
      expect(evaluateFieldSafety({ type: 'text', label }).sensitivity).not.toBe('blocked');
    });
  }
});

describe('a prose question is not answered from the profile', () => {
  /** The two originals, verbatim. */
  it('does not offer a surname for a question about a manager', () => {
    const result = score('How would your last manager describe you?');
    expect(result.conceptId).not.toBe('person.last_name');
    expect(result.value).not.toBe('Kotha');
    expect(result.confidence).toBeLessThan(0.9);
  });

  it('does not offer the user’s own employer as the company they admire', () => {
    const result = score('Which company do you admire most and why?');
    expect(result.conceptId).not.toBe('experience.company');
    expect(result.status).not.toBe('ready');
  });

  const PROSE = [
    'Where do you see yourself in five years?',
    'Tell us about your first job and what you learned',
    'What would your first employer say about you?',
    'Describe the company culture you work best in',
    'Why do you want to join our company?',
    'Which university experience shaped you most and why?',
  ];
  for (const label of PROSE) {
    it(`does not pre-accept a stored value for ${JSON.stringify(label)}`, () => {
      const result = score(label, 'textarea');
      expect(result.status, 'a prose question must never be pre-accepted').not.toBe('ready');
    });
  }
});

describe('the short labels that must keep working', () => {
  /**
   * The counterweight. The lone-token discount only bites past four label tokens, and a question that
   * carries no prose marker still resolves from the profile — otherwise the fix would have traded a
   * wrong answer for no answer, which is not obviously better.
   */
  const MUST_MATCH: { label: string; concept: string }[] = [
    { label: 'Last', concept: 'person.last_name' },
    { label: 'First', concept: 'person.first_name' },
    { label: 'Email Address', concept: 'person.email' },
    { label: 'Current Company Name', concept: 'experience.company' },
    { label: 'Please enter your email address here', concept: 'person.email' },
    { label: 'Full Name', concept: 'person.full_name' },
    { label: 'What is your job title?', concept: 'experience.job_title' },
    { label: 'What is your current company?', concept: 'experience.company' },
  ];

  for (const { label, concept } of MUST_MATCH) {
    it(`still maps ${JSON.stringify(label)} to ${concept}`, () => {
      expect(score(label).conceptId).toBe(concept);
    });
  }

  it('a question with no prose marker still resolves from the profile', () => {
    const result = score('What is your email address?');
    expect(result.conceptId).toBe('person.email');
    expect(result.value).toBe(TEST_PROFILE.basicProfile?.email);
  });
});

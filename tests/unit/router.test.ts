import { describe, expect, it } from 'vitest';
import { isLongFormField, routeField, UNKNOWN_MATCH_SCORE } from '../../shared/matching/router';
import { matchField } from '../../shared/matching/matcher';
import { resolveConcept } from '../../shared/matching/resolve';
import { EMPTY_PROFILE, TEST_PROFILE } from '../helpers/profile';
import { field } from '../helpers/field';
import type { UnifiedField } from '../../shared/types/form';
import type { ProfileLike } from '../../shared/matching/resolve';

function route(f: UnifiedField, profile: ProfileLike = TEST_PROFILE, allowAI = true) {
  const match = matchField(f);
  const resolved = match.best
    ? resolveConcept(match.best.conceptId, profile)
    : { value: null, confidence: 0, origin: 'none' as const, missing: true };
  return routeField(f, match, resolved, { allowAI });
}

describe('isLongFormField', () => {
  it('treats multi-line controls as long-form', () => {
    expect(isLongFormField(field({ type: 'textarea' }))).toBe(true);
    expect(isLongFormField(field({ type: 'richtext' }))).toBe(true);
  });

  it('treats a generous maxlength as long-form', () => {
    expect(isLongFormField(field({ type: 'text', maxLength: 500 }))).toBe(true);
    expect(isLongFormField(field({ type: 'text', maxLength: 60 }))).toBe(false);
  });

  it('treats interrogative labels as long-form', () => {
    expect(isLongFormField(field({ type: 'text', label: 'Why do you want to join us' }))).toBe(true);
    expect(isLongFormField(field({ type: 'text', label: 'Describe your favourite project' }))).toBe(true);
    expect(isLongFormField(field({ type: 'text', label: 'Is this your first application here?' }))).toBe(true);
  });

  it('does not treat short plain labels as long-form', () => {
    expect(isLongFormField(field({ type: 'text', label: 'Email' }))).toBe(false);
    expect(isLongFormField(field({ type: 'text', label: 'Why' }))).toBe(false);
  });
});

describe('routeField', () => {
  it('uses the deterministic path for a clear label with stored data', () => {
    expect(route(field({ label: 'Email Address', type: 'email' })).route).toBe('deterministic');
    expect(route(field({ label: 'Full Name' })).route).toBe('deterministic');
  });

  it('blocks secrets and consent without consulting a model', () => {
    expect(route(field({ label: 'Password', type: 'password' })).route).toBe('blocked');
    expect(route(field({ label: 'I agree to the Terms and Conditions', type: 'checkbox' })).route).toBe('blocked');
    expect(route(field({ label: 'Anything', sensitivity: 'blocked', sensitivityReason: 'nope' })).route).toBe('blocked');
  });

  it('routes file inputs to the document picker', () => {
    expect(route(field({ label: 'Upload Resume', type: 'file' })).route).toBe('document');
  });

  it('routes long-form questions to generation', () => {
    expect(route(field({ label: 'Why do you want to join our team?', type: 'textarea' })).route).toBe('ai_generate');
    expect(route(field({ label: 'Tell us about yourself', type: 'textarea' })).route).toBe('ai_generate');
  });

  it('routes an unrecognised long-form question to generation too', () => {
    const unknown = field({ label: 'What would you change about our onboarding flow?', type: 'textarea' });
    expect(matchField(unknown).best?.score ?? 0).toBeLessThan(0.9);
    expect(route(unknown).route).toBe('ai_generate');
  });

  it('asks for manual entry when nothing matched and the field is short', () => {
    const decision = route(field({ label: 'Blorptigan reference' }));
    expect(decision.route).toBe('manual');
    expect(decision.reason).toMatch(/manually/i);
  });

  it('asks for manual entry when the concept is understood but the profile is empty', () => {
    const decision = route(field({ label: 'Email Address', type: 'email' }), EMPTY_PROFILE);
    expect(decision.route).toBe('manual');
    expect(decision.reason).toMatch(/no value/i);
  });

  it('does not generate prose into a single-line field', () => {
    const shortBox = field({ label: 'Other', type: 'text' });
    const decision = route(shortBox);
    expect(decision.route).toBe('manual');
    expect(decision.reason).toMatch(/short free-text/i);
    // The same concept in a textarea is fine.
    expect(route(field({ label: 'Anything else we should know?', type: 'textarea' })).route).toBe('ai_generate');
  });

  it('never routes to a model when AI is disabled', () => {
    const longForm = field({ label: 'Why do you want to join our team?', type: 'textarea' });
    expect(route(longForm, TEST_PROFILE, false).route).toBe('manual');
  });

  it('leaves disabled and read-only fields alone', () => {
    expect(route(field({ label: 'Email', type: 'email', disabled: true })).route).toBe('manual');
    expect(route(field({ label: 'Email', type: 'email', readOnly: true })).route).toBe('manual');
  });

  it('documents its unknown-match threshold', () => {
    expect(UNKNOWN_MATCH_SCORE).toBeGreaterThan(0);
    expect(UNKNOWN_MATCH_SCORE).toBeLessThan(0.7);
  });
});

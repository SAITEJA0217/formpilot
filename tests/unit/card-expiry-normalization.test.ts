/**
 * `exp` beside a card token means expiry, not experience.
 *
 * The root cause of one of the four real safety misses the v1 held-out evaluation found. A
 * third-party payment form's `cc-exp-year` input normalized to "cc **experience** year" — because
 * `exp` abbreviates "experience" on an application form — and the matcher mapped it to
 * `experience.years_of_experience` at high enough confidence to be filled.
 *
 * The safety policy now refuses that field for other reasons too, which is why these assertions
 * live here rather than in `tests/safety/`: a mutation test showed that reverting the normalizer
 * fix left the whole safety suite green, because the policy's payment pattern accepts `experience`
 * beside a card token as a second line of defence. The defect these tests guard is the *mapping*,
 * and only a matcher-level assertion can see it.
 */
import { describe, expect, it } from 'vitest';
import { normalizeText } from '../../shared/matching/normalize';
import { matchField } from '../../shared/matching/matcher';
import { UNKNOWN_MATCH_SCORE } from '../../shared/matching/router';
import type { FieldType, UnifiedField } from '../../shared/types/form';

function field(overrides: Partial<Record<'label' | 'name', string>>, type: FieldType = 'text'): UnifiedField {
  return {
    id: 'f1',
    type,
    required: false,
    disabled: false,
    readOnly: false,
    sensitivity: 'normal',
    options: [],
    location: { framePath: [], shadowPath: [] },
    selector: '',
    ...overrides,
  } as unknown as UnifiedField;
}

describe('normalization of `exp`', () => {
  it('reads it as expiry beside a card token', () => {
    for (const input of ['cc-exp-year', 'CC Exp Month', 'card exp', 'credit exp date', 'debit-exp']) {
      expect(normalizeText(input), input).toContain('expiry');
      expect(normalizeText(input), input).not.toContain('experience');
    }
  });

  it('still reads it as experience everywhere else', () => {
    // The expansion earns its place on application forms; the fix is contextual, not a removal.
    for (const input of ['exp', 'Total Exp', 'exp in years', 'work exp']) {
      expect(normalizeText(input), input).toContain('experience');
    }
  });
});

describe('a card-expiry field is never mapped to employment history', () => {
  it('does not map cc-exp-year to years of experience', () => {
    const result = matchField(field({ name: 'cc-exp-year' }), {});
    expect(result.best?.conceptId).not.toBe('experience.years_of_experience');
  });

  it('does not map "CC Exp Year" to years of experience', () => {
    const result = matchField(field({ label: 'CC Exp Year' }), {});
    expect(result.best?.conceptId).not.toBe('experience.years_of_experience');
  });

  it('does not map "Card Expiry Year" to any employment concept', () => {
    const result = matchField(field({ label: 'Card Expiry Year' }), {});
    expect(result.best?.conceptId ?? '').not.toMatch(/^experience\./);
  });

  it('still maps a genuine experience field', () => {
    // The guard must not cost the mapping it was protecting.
    const result = matchField(field({ label: 'Total Years of Experience' }), {});
    expect(result.best?.conceptId).toBe('experience.years_of_experience');
    expect(result.best?.score ?? 0).toBeGreaterThan(UNKNOWN_MATCH_SCORE);
  });

  it('still maps "Total Exp" through the abbreviation', () => {
    const result = matchField(field({ label: 'Total Exp (years)' }), {});
    expect(result.best?.conceptId).toBe('experience.years_of_experience');
  });
});

/**
 * Data minimisation for the model request.
 *
 * The finding these tests pin: the AI path forwarded the profile whole, and the server route
 * serialises whatever it receives into the prompt. Drafting one paragraph therefore sent the
 * provider a phone number, date of birth, gender, full postal address, every saved document
 * and every alternate persona the user keeps.
 *
 * These are privacy assertions, so `tests/safety` would be a reasonable home too. They live
 * here because they test a pure function rather than an end-to-end invariant.
 */
import { describe, expect, it } from 'vitest';
import { redactProfileForAI } from '../../shared/privacy/redact';
import { TEST_PROFILE } from '../helpers/profile';

const profile = TEST_PROFILE as unknown as Record<string, unknown>;

describe('redactProfileForAI', () => {
  it('never sends documents, alternate personas, preferences or the account id', () => {
    for (const modes of [['generate'], ['assist'], ['assist', 'generate']] as const) {
      const { profile: out } = redactProfileForAI(profile, modes);
      for (const key of ['documents', 'profiles', 'activeProfileId', 'preferences', 'userId']) {
        expect(out, `${key} with modes ${modes.join('+')}`).not.toHaveProperty(key);
      }
    }
  });

  it('strips contact and identity details when only prose is being written', () => {
    const { profile: out, report } = redactProfileForAI(profile, ['generate']);
    expect(report.keptForValueLookup).toBe(false);
    expect(out).not.toHaveProperty('address');
    expect(out).not.toHaveProperty('socialLinks');

    const basic = out.basicProfile as Record<string, unknown>;
    for (const key of ['phone', 'dateOfBirth', 'gender', 'address']) {
      expect(basic, key).not.toHaveProperty(key);
    }
  });

  it('keeps what a prose answer is actually grounded in', () => {
    const { profile: out } = redactProfileForAI(profile, ['generate']);
    // Removing these would make the model invent an employer or a degree, which is the
    // failure the grounding rules exist to prevent.
    expect(out).toHaveProperty('experience');
    expect(out).toHaveProperty('education');
    expect(out).toHaveProperty('skills');
    expect((out.basicProfile as Record<string, unknown>).fullName).toBeTruthy();
    expect((out.basicProfile as Record<string, unknown>).email).toBeTruthy();
  });

  it('keeps stored values when a request may return one', () => {
    // `assist` adjudicates an uncertain mapping and answers with a stored value, so it has to
    // be able to see the value it might return.
    const { profile: out, report } = redactProfileForAI(profile, ['assist']);
    expect(report.keptForValueLookup).toBe(true);
    expect(out).toHaveProperty('address');
    expect((out.basicProfile as Record<string, unknown>).phone).toBeTruthy();
  });

  it('treats a mixed batch as value-returning, because one assist needs the values', () => {
    const { report } = redactProfileForAI(profile, ['generate', 'assist']);
    expect(report.keptForValueLookup).toBe(true);
  });

  it('errs toward over-sending for an unrecognised mode rather than answering wrongly', () => {
    // A new mode that silently lost the fields it needed would produce wrong answers, which
    // is worse than sending more than necessary. Opting a new prose-only mode in is deliberate.
    const { report } = redactProfileForAI(profile, ['something-new' as 'assist']);
    expect(report.keptForValueLookup).toBe(true);
  });

  it('does not mutate the caller\'s profile', () => {
    const before = JSON.stringify(profile);
    redactProfileForAI(profile, ['generate']);
    // The extension still needs the full profile for local matching, which resolves most
    // fields without a model at all.
    expect(JSON.stringify(profile)).toBe(before);
  });

  it('reports exactly what it removed', () => {
    // Built here rather than taken from the shared fixture, which carries no alternate
    // personas: asserting that `profiles` was removed from a profile that never had one
    // would pass without testing anything.
    const withPersonas = {
      ...profile,
      profiles: [{ id: 'p2', name: 'Academic', overrides: { basicProfile: { email: 'a@uni.test' } } }],
      activeProfileId: 'p2',
      preferences: { allowAI: true, highConfidence: 0.9 },
    };
    const { profile: out, report } = redactProfileForAI(withPersonas, ['generate']);

    expect(report.removed).toContain('documents');
    expect(report.removed).toContain('profiles');
    expect(report.removed).toContain('activeProfileId');
    expect(report.removed).toContain('preferences');
    expect(report.removedFromBasicProfile).toContain('phone');
    expect(report.removedFromBasicProfile).toContain('dateOfBirth');

    // The alternate persona's email must not survive anywhere in what is sent.
    expect(JSON.stringify(out)).not.toContain('a@uni.test');
  });

  it('is a no-op on a profile that holds nothing sensitive', () => {
    const minimal = { basicProfile: { fullName: 'A B', email: 'a@b.test' } };
    const { profile: out, report } = redactProfileForAI(minimal, ['generate']);
    expect(out).toEqual(minimal);
    expect(report.removed).toEqual([]);
  });
});

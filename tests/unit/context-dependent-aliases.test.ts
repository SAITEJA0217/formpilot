/**
 * Context-dependent aliases, and two ontology defects the matching study found.
 *
 * All four cases here were failures on the first run of `npm run study:matching`. They are
 * pinned as tests so the fixes cannot silently regress, and so the reason for each is
 * recorded next to the assertion rather than only in a results file.
 */
import { describe, expect, it } from 'vitest';
import { matchField } from '../../shared/matching/matcher';
import { DEFAULT_THRESHOLDS } from '../../shared/matching/confidence';
import { UNKNOWN_MATCH_SCORE } from '../../shared/matching/router';
import type { FieldType, UnifiedField } from '../../shared/types/form';
import type { MatchContext } from '../../shared/matching/matcher';

function field(label: string, type: FieldType = 'text'): UnifiedField {
  return {
    id: 'f1',
    type,
    label,
    required: false,
    disabled: false,
    readOnly: false,
    sensitivity: 'normal',
    options: [],
    location: { framePath: [], shadowPath: [] },
    selector: '',
  } as unknown as UnifiedField;
}

const top = (label: string, type?: FieldType, context: MatchContext = {}) => {
  const result = matchField(field(label, type), context);
  return { id: result.best?.conceptId ?? null, score: result.best?.score ?? 0, result };
};

describe('a bare "Company" is mapped but not asserted', () => {
  it('still maps to the applicant employer, because that is usually what it means', () => {
    expect(top('Company').id).toBe('experience.company');
    expect(top('Company Name').id).toBe('experience.company');
  });

  it('stays below the auto-accept band, so a human confirms it', () => {
    // On a job application "Company" is normally the applicant's employer, but on plenty of
    // forms it is the company being applied to, and the label alone cannot settle it.
    for (const label of ['Company', 'Company Name', 'Organisation', 'Firm']) {
      const { score } = top(label);
      expect(score, label).toBeLessThan(DEFAULT_THRESHOLDS.high);
      expect(score, label).toBeGreaterThan(UNKNOWN_MATCH_SCORE);
    }
  });

  it('records the cap in provenance, so the reviewer can see why', () => {
    const { result } = top('Company');
    expect(result.best?.signals.map((s) => s.signal)).toContain('alias.contextDependent');
  });

  it('is fully confident once the label says whose company it is', () => {
    // `Current Company` and `Employer` name the owner, so there is nothing left to resolve.
    for (const label of ['Current Company', 'Current Employer', 'Employer Name']) {
      const { id, score } = top(label);
      expect(id, label).toBe('experience.company');
      expect(score, label).toBeGreaterThanOrEqual(DEFAULT_THRESHOLDS.high);
    }
  });

  it('is fully confident when the surrounding section corroborates it', () => {
    const { id, score } = top('Company', 'text', { sectionTitle: 'Work Experience' });
    expect(id).toBe('experience.company');
    expect(score).toBeGreaterThanOrEqual(DEFAULT_THRESHOLDS.high);
  });

  it('declines "Company Email" rather than offering either wrong answer', () => {
    // Two wrong answers are available: the employer's name (it contains "Company") and the
    // personal email address (it contains "Email"). The ontology carries a negative against
    // each, so nothing clears the commitment floor and the user types their work address.
    const { score } = top('Company Email', 'email');
    expect(score).toBeLessThan(UNKNOWN_MATCH_SCORE);
  });
});

describe('ontology defects the study surfaced', () => {
  it('does not read "Notice Period" as employment duration', () => {
    // `period` is an alias of experience.duration, which made a notice-period field look
    // like a tenure field. The profile holds no notice period at all, so the only correct
    // behaviour is to decline.
    expect(top('Notice Period').score).toBeLessThan(UNKNOWN_MATCH_SCORE);
  });

  it('still reads a genuine duration field as duration', () => {
    const { id, score } = top('Employment Duration');
    expect(id).toBe('experience.duration');
    expect(score).toBeGreaterThan(UNKNOWN_MATCH_SCORE);
  });

  it('does not answer "Reason for leaving" from the motivation prompt', () => {
    // It overlaps "reason for applying" on tokens but asks the opposite question, and
    // generating an answer would put words in the user's mouth about a former employer.
    expect(top('Reason for leaving', 'textarea').score).toBeLessThan(UNKNOWN_MATCH_SCORE);
  });
});

describe('a prose question is never answered with a stored value', () => {
  it('does not write a job title into "Why are you leaving your current role?"', () => {
    // The label contains `current role`, an alias of experience.job_title, and scored 0.93 —
    // high enough to be filled without review. A question asking *why* is never answered by
    // a scalar the profile happens to hold.
    const { score, result } = top('Why are you leaving your current role?', 'textarea');
    expect(score).toBeLessThan(UNKNOWN_MATCH_SCORE);
    expect(result.candidates[0]?.signals.map((s) => s.signal)).toContain('label.proseQuestion');
  });

  it('leaves value questions alone, because the question word is the discriminator', () => {
    // "What is your job title?" wants the value. Only why/describe/explain-shaped labels
    // are treated as wanting prose.
    const { id, score } = top('What is your job title?');
    expect(id).toBe('experience.job_title');
    expect(score).toBeGreaterThan(UNKNOWN_MATCH_SCORE);
  });

  it('does not penalise a generative concept, which is what prose questions are for', () => {
    for (const label of ['Why do you want to join our team?', 'Tell us about yourself']) {
      const { score, result } = top(label, 'textarea');
      expect(score, label).toBeGreaterThan(UNKNOWN_MATCH_SCORE);
      expect(result.best?.signals.map((s) => s.signal), label).not.toContain('label.proseQuestion');
    }
  });

  it('still recognises the motivation question itself', () => {
    const { id, score } = top('Why do you want to join our team?', 'textarea');
    expect(id).toBe('freeform.motivation');
    expect(score).toBeGreaterThan(UNKNOWN_MATCH_SCORE);
  });
});

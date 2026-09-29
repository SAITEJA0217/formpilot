import { describe, expect, it } from 'vitest';
import {
  isOptionField,
  matchOption,
  matchOptions,
  pickEducation,
  pickExperience,
  resolveConcept,
} from '../../shared/matching/resolve';
import { EMPTY_PROFILE, TEST_PROFILE } from '../helpers/profile';
import { field, options } from '../helpers/field';

describe('resolveConcept — direct profile fields', () => {
  it('reads stored values with full confidence and a provenance path', () => {
    const email = resolveConcept('person.email', TEST_PROFILE);
    expect(email.value).toBe('saiteja@example.com');
    expect(email.confidence).toBe(1);
    expect(email.origin).toBe('profile');
    expect(email.profilePath).toBe('basicProfile.email');
    expect(email.humanPath).toBe('Personal → Email');
  });

  it('resolves links and skills', () => {
    expect(resolveConcept('links.github', TEST_PROFILE).value).toBe('https://github.com/saiteja0217');
    expect(resolveConcept('skills.technical', TEST_PROFILE).value).toEqual([
      'TypeScript',
      'React',
      'Node.js',
      'Python',
      'PostgreSQL',
    ]);
    expect(resolveConcept('skills.languages', TEST_PROFILE).value).toEqual(['English', 'Telugu', 'Hindi']);
  });

  it('resolves structured address parts', () => {
    expect(resolveConcept('address.city', TEST_PROFILE).value).toBe('Hyderabad');
    expect(resolveConcept('address.postal_code', TEST_PROFILE).value).toBe('500081');
    expect(resolveConcept('address.full', TEST_PROFILE).value).toContain('MG Road');
  });
});

describe('resolveConcept — derived values', () => {
  it('splits a full name and reduces confidence for the derivation', () => {
    const first = resolveConcept('person.first_name', TEST_PROFILE);
    const middle = resolveConcept('person.middle_name', TEST_PROFILE);
    const last = resolveConcept('person.last_name', TEST_PROFILE);
    expect(first.value).toBe('Saiteja');
    expect(middle.value).toBe('Reddy');
    expect(last.value).toBe('Kotha');
    expect(first.origin).toBe('derived');
    expect(first.confidence).toBeLessThan(1);
  });

  it('handles a single-word name without inventing a surname', () => {
    const single = { basicProfile: { fullName: 'Prince', email: '', phone: '', dateOfBirth: '', gender: '', address: '' } };
    expect(resolveConcept('person.first_name', single).value).toBe('Prince');
    expect(resolveConcept('person.last_name', single).value).toBeNull();
  });

  it('derives years of experience only when the profile states it', () => {
    expect(resolveConcept('experience.years_of_experience', TEST_PROFILE).value).toBe('2');
    const noDuration = { experience: [{ id: 'x', company: 'Acme', position: 'Dev', description: '' }] };
    expect(resolveConcept('experience.years_of_experience', noDuration).value).toBeNull();
  });
});

describe('resolveConcept — selection among repeated entries', () => {
  it('picks the most recent education by graduation year', () => {
    const picked = pickEducation(TEST_PROFILE);
    expect(picked?.entry.degree).toBe('B.Tech');
    expect(resolveConcept('education.degree', TEST_PROFILE).profilePath).toBe('education[0].degree');
  });

  it('picks the current role for experience', () => {
    expect(pickExperience(TEST_PROFILE)?.entry.company).toBe('Nexturn Solutions');
  });

  it('ignores blank entries', () => {
    const sparse = { education: [{ id: 'a', college: '', university: '', degree: '', branch: '', graduationYear: '', cgpa: '' }] };
    expect(pickEducation(sparse)).toBeNull();
  });
});

describe('resolveConcept — missing data and blocked concepts', () => {
  it('reports missing rather than guessing', () => {
    const result = resolveConcept('person.email', EMPTY_PROFILE);
    expect(result.value).toBeNull();
    expect(result.missing).toBe(true);
    expect(result.confidence).toBe(0);
  });

  it('never resolves a blocked concept', () => {
    for (const id of ['auth.password', 'auth.otp', 'payment.card_number', 'consent.agreement']) {
      expect(resolveConcept(id, TEST_PROFILE).value, id).toBeNull();
    }
  });

  it('never resolves a document concept — the user picks the file', () => {
    expect(resolveConcept('documents.resume', TEST_PROFILE).value).toBeNull();
  });

  it('returns nothing for an unknown concept id', () => {
    expect(resolveConcept('nope.nope', TEST_PROFILE).value).toBeNull();
  });
});

describe('matchOption', () => {
  const degrees = options('High School', 'Diploma', "Bachelor's Degree", "Master's Degree", 'PhD');

  it('matches exactly and case-insensitively', () => {
    expect(matchOption('PhD', degrees).option?.label).toBe('PhD');
    expect(matchOption('phd', degrees).option?.label).toBe('PhD');
  });

  it('maps an equivalent qualification through the synonym table', () => {
    const result = matchOption('B.Tech', degrees);
    expect(result.option?.label).toBe("Bachelor's Degree");
    expect(result.confidence).toBeGreaterThan(0.8);
    expect(matchOption('M.Tech', degrees).option?.label).toBe("Master's Degree");
    expect(matchOption('Intermediate', degrees).option?.label).toBe('High School');
  });

  it('declines when nothing is close enough', () => {
    const result = matchOption('Certificate in Welding', degrees);
    expect(result.option).toBeNull();
    expect(result.confidence).toBeLessThan(0.6);
  });

  it('handles empty inputs', () => {
    expect(matchOption('', degrees).option).toBeNull();
    expect(matchOption('PhD', []).option).toBeNull();
  });
});

describe('matchOptions', () => {
  const skills = options('React', 'TypeScript', 'Python', 'AWS');

  it('matches every value it can and reports mean confidence', () => {
    const result = matchOptions(['React', 'Python'], skills);
    expect(result.matched.map((m) => m.label)).toEqual(['React', 'Python']);
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it('reduces confidence when only some values map', () => {
    const partial = matchOptions(['React', 'Rust', 'Haskell'], skills);
    const full = matchOptions(['React'], skills);
    expect(partial.matched).toHaveLength(1);
    expect(partial.confidence).toBeLessThan(full.confidence);
  });

  it('returns nothing when no value maps', () => {
    expect(matchOptions(['Rust'], skills).matched).toEqual([]);
  });

  it('does not select the same option twice', () => {
    expect(matchOptions(['React', 'react'], skills).matched).toHaveLength(1);
  });
});

describe('isOptionField', () => {
  it('identifies controls whose value must come from a list', () => {
    for (const type of ['select_one', 'select_many', 'radio_group', 'checkbox_group', 'rating'] as const) {
      expect(isOptionField(field({ type })), type).toBe(true);
    }
    for (const type of ['text', 'textarea', 'email', 'checkbox', 'file'] as const) {
      expect(isOptionField(field({ type })), type).toBe(false);
    }
  });
});

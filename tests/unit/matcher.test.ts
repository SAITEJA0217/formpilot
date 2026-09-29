import { describe, expect, it } from 'vitest';
import { AMBIGUITY_MARGIN, matchField } from '../../shared/matching/matcher';
import { field, options } from '../helpers/field';

const best = (partial: Parameters<typeof field>[0]) => matchField(field(partial)).best;

describe('matchField — canonical labels', () => {
  const cases: [string, string][] = [
    ['First Name', 'person.first_name'],
    ['Given Name', 'person.first_name'],
    ['Last Name', 'person.last_name'],
    ['Surname', 'person.last_name'],
    ['Full Name', 'person.full_name'],
    ['Name', 'person.full_name'],
    ['Email Address', 'person.email'],
    ['E-mail', 'person.email'],
    ['Mobile Number', 'person.phone'],
    ['Contact No', 'person.phone'],
    ['Date of Birth', 'person.date_of_birth'],
    ['DOB', 'person.date_of_birth'],
    ['City', 'address.city'],
    ['PIN Code', 'address.postal_code'],
    ['Country', 'address.country'],
    ['Highest Qualification', 'education.degree'],
    ['Specialization', 'education.field_of_study'],
    ['Branch', 'education.field_of_study'],
    ['College Name', 'education.institution'],
    ['University', 'education.university'],
    ['Year of Passing', 'education.graduation_year'],
    ['CGPA', 'education.gpa'],
    ['Current Company', 'experience.company'],
    ['Job Title', 'experience.job_title'],
    ['Designation', 'experience.job_title'],
    ['Technical Skills', 'skills.technical'],
    ['LinkedIn Profile', 'links.linkedin'],
    ['GitHub Profile', 'links.github'],
    ['Portfolio URL', 'links.portfolio'],
  ];

  for (const [label, expected] of cases) {
    it(`maps "${label}" to ${expected}`, () => {
      expect(best({ label })?.conceptId).toBe(expected);
    });
  }

  it('tolerates verbose phrasing around a known alias', () => {
    expect(best({ label: 'Please enter your first name' })?.conceptId).toBe('person.first_name');
    expect(best({ label: 'What is your email address?' })?.conceptId).toBe('person.email');
  });

  it('matches on the name attribute when there is no label', () => {
    expect(best({ name: 'graduation_year' })?.conceptId).toBe('education.graduation_year');
    expect(best({ name: 'fname' })?.conceptId).toBe('person.first_name');
  });

  it('matches on a placeholder when nothing better exists', () => {
    expect(best({ placeholder: 'Enter your mobile number' })?.conceptId).toBe('person.phone');
  });
});

describe('matchField — precedence and gates', () => {
  it('lets autocomplete outrank a misleading label', () => {
    const result = matchField(field({ label: 'Contact', autocomplete: 'email', type: 'email' }));
    expect(result.best?.conceptId).toBe('person.email');
    expect(result.best?.signals.some((s) => s.signal === 'autocomplete')).toBe(true);
  });

  it('classifies a password input regardless of its label', () => {
    const result = matchField(field({ label: 'Secret sauce', type: 'password' }));
    expect(result.best?.conceptId).toBe('auth.password');
    expect(result.ambiguous).toBe(false);
  });

  it('applies negative phrases to disambiguate near-duplicates', () => {
    expect(best({ label: 'Company Email' })?.conceptId).not.toBe('person.email');
    expect(best({ label: 'Company Name' })?.conceptId).not.toBe('person.full_name');
    expect(best({ label: 'Reference Name' })?.conceptId).not.toBe('person.full_name');
    expect(best({ label: 'Username' })?.conceptId).not.toBe('person.full_name');
  });

  it('penalises a file concept on a non-file control and vice versa', () => {
    const textResume = matchField(field({ label: 'Resume', type: 'text' })).best;
    const fileResume = matchField(field({ label: 'Resume', type: 'file' })).best;
    expect(fileResume?.conceptId).toBe('documents.resume');
    expect(fileResume!.score).toBeGreaterThan(textResume!.score);
  });

  it('boosts a concept when the control type is its natural type', () => {
    const plain = matchField(field({ label: 'Email', type: 'text' })).best!;
    const typed = matchField(field({ label: 'Email', type: 'email' })).best!;
    expect(typed.score).toBeGreaterThanOrEqual(plain.score);
    expect(typed.signals.some((s) => s.signal === 'type.natural')).toBe(true);
  });

  it('uses section context to break a tie in favour of the right family', () => {
    const withContext = matchField(field({ label: 'Year' }), { sectionTitle: 'Education' });
    expect(withContext.candidates.some((c) => c.conceptId.startsWith('education.'))).toBe(true);
  });
});

describe('matchField — ambiguity and provenance', () => {
  it('reports ambiguity when the top two candidates are close', () => {
    const result = matchField(field({ label: 'Score' }));
    if (result.candidates.length >= 2) {
      const margin = result.candidates[0].score - result.candidates[1].score;
      expect(result.ambiguous).toBe(margin < AMBIGUITY_MARGIN);
    }
  });

  it('returns no candidates when there is no text at all', () => {
    const result = matchField(field({ type: 'text' }));
    expect(result.best).toBeUndefined();
    expect(result.candidates).toEqual([]);
  });

  it('attaches signal provenance to every candidate', () => {
    const result = matchField(field({ label: 'Email Address', type: 'email' }));
    expect(result.best?.signals.length).toBeGreaterThan(0);
    for (const signal of result.best!.signals) {
      expect(signal.signal).toBeTruthy();
      expect(signal.score).toBeGreaterThanOrEqual(0);
      expect(signal.score).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic across repeated runs', () => {
    const one = matchField(field({ id: 'x', label: 'Highest Qualification', type: 'select_one', options: options('Bachelor', 'Master') }));
    const two = matchField(field({ id: 'x', label: 'Highest Qualification', type: 'select_one', options: options('Bachelor', 'Master') }));
    expect(one.candidates.map((c) => c.conceptId)).toEqual(two.candidates.map((c) => c.conceptId));
    expect(one.best?.score).toBe(two.best?.score);
  });

  it('caps scores at 1', () => {
    const result = matchField(field({ label: 'Email', autocomplete: 'email', type: 'email', name: 'email' }));
    expect(result.best!.score).toBeLessThanOrEqual(1);
  });
});

describe('matchField — consent and secrets', () => {
  it('flags consent checkboxes as the blocked consent concept', () => {
    expect(best({ label: 'I agree to the Terms and Conditions', type: 'checkbox' })?.conceptId).toBe('consent.agreement');
    expect(best({ label: 'Subscribe me to marketing emails', type: 'checkbox' })?.conceptId).toBe('consent.agreement');
  });

  it('flags one-time codes and card fields', () => {
    expect(best({ label: 'One-Time Code' })?.conceptId).toBe('auth.otp');
    expect(best({ label: 'Card Number' })?.conceptId).toBe('payment.card_number');
    expect(best({ label: 'CVV' })?.conceptId).toBe('payment.cvv');
    expect(best({ label: 'Aadhaar Number' })?.conceptId).toBe('identity.government_id');
  });
});

describe('matchField — long-form questions', () => {
  it('recognises motivation and self-introduction questions', () => {
    expect(best({ label: 'Why do you want to join our team?', type: 'textarea' })?.conceptId).toBe('freeform.motivation');
    expect(best({ label: 'Tell us about yourself', type: 'textarea' })?.conceptId).toBe('freeform.self_introduction');
    expect(best({ label: 'Describe your previous experience', type: 'textarea' })?.conceptId).toBe(
      'freeform.experience_description',
    );
  });
});

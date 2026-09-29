import { describe, expect, it } from 'vitest';
import {
  humanizeIdentifier,
  normalizeText,
  stripDecorations,
  tokenize,
  tokenSet,
} from '../../shared/matching/normalize';

describe('stripDecorations', () => {
  it('removes required markers and trailing colons', () => {
    expect(stripDecorations('Full Name *').trim()).toBe('Full Name');
    expect(stripDecorations('Email (required)').trim()).toBe('Email');
    expect(stripDecorations('Phone:').trim()).toBe('Phone');
    expect(stripDecorations('City (optional)').trim()).toBe('City');
  });
});

describe('normalizeText', () => {
  it('lowercases, strips punctuation and collapses whitespace', () => {
    expect(normalizeText('  Full   Name!  ')).toBe('full name');
  });

  it('splits identifier casing styles', () => {
    expect(normalizeText('firstName')).toBe('first name');
    expect(normalizeText('first_name')).toBe('first name');
    expect(normalizeText('first-name')).toBe('first name');
    expect(normalizeText('GraduationYear')).toBe('graduation year');
  });

  it('folds diacritics', () => {
    expect(normalizeText('Müller')).toBe('muller');
    expect(normalizeText('José')).toBe('jose');
  });

  it('expands abbreviations to their canonical words', () => {
    expect(normalizeText('fname')).toBe('first name');
    expect(normalizeText('lname')).toBe('last name');
    expect(normalizeText('dob')).toBe('date of birth');
    expect(normalizeText('zip')).toBe('postal code');
    expect(normalizeText('org')).toBe('organization');
    expect(normalizeText('univ')).toBe('university');
    expect(normalizeText('exp')).toBe('experience');
  });

  it('keeps stopwords at level 1 so multi-word patterns still match', () => {
    expect(normalizeText('Date of Birth')).toBe('date of birth');
    expect(normalizeText('Please enter your first name')).toBe('please enter your first name');
  });

  it('expands a trailing "no" to "number" only in a numeric context', () => {
    expect(normalizeText('Contact No')).toBe('contact number');
    expect(normalizeText('Roll No')).toBe('roll number');
    expect(normalizeText('No')).toBe('no');
    expect(normalizeText('Answer no')).toBe('answer no');
  });

  it('leaves "tech" unexpanded so degree abbreviations survive', () => {
    // `tech` means "technical" in "tech skills" but "technology" in "B.Tech";
    // expanding it broke qualification matching, so it is left alone.
    expect(normalizeText('B.Tech')).toBe('b tech');
    expect(normalizeText('M.Tech')).toBe('m tech');
    expect(normalizeText('Tech Skills')).toBe('tech skills');
  });

  it('returns an empty string for empty input', () => {
    expect(normalizeText('')).toBe('');
    expect(normalizeText(null)).toBe('');
    expect(normalizeText(undefined)).toBe('');
    expect(normalizeText('***')).toBe('');
  });
});

describe('tokenize', () => {
  it('drops stopwords at level 2', () => {
    expect(tokenize('Please enter your first name')).toEqual(['first', 'name']);
    expect(tokenize('What is your Email Address?')).toEqual(['what', 'email', 'address']);
  });

  it('makes equivalent labels compare identically', () => {
    expect(tokenize('Your First Name')).toEqual(tokenize('First Name'));
  });

  it('produces a set without duplicates', () => {
    expect(Array.from(tokenSet('name name name'))).toEqual(['name']);
  });
});

describe('humanizeIdentifier', () => {
  it('turns attribute values into readable labels', () => {
    expect(humanizeIdentifier('graduation_year')).toBe('Graduation year');
    expect(humanizeIdentifier('cgpa')).toBe('Cgpa');
    expect(humanizeIdentifier('')).toBe('');
  });
});

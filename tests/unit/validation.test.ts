import { describe, expect, it } from 'vitest';
import {
  isValidEmail,
  isValidPhone,
  isValidUrl,
  normalizeUrl,
  toIsoDate,
  toIsoTime,
  toNumberString,
  toYear,
  validateForField,
} from '../../shared/validation/value';
import { field } from '../helpers/field';

describe('scalar validators', () => {
  it('validates email addresses', () => {
    expect(isValidEmail('a@b.co')).toBe(true);
    expect(isValidEmail('saiteja@example.com')).toBe(true);
    expect(isValidEmail('not-an-email')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false);
  });

  it('validates phone numbers by digit count', () => {
    expect(isValidPhone('+91 98765 43210')).toBe(true);
    expect(isValidPhone('(555) 010-2030')).toBe(true);
    expect(isValidPhone('123')).toBe(false);
  });

  it('normalizes and validates URLs', () => {
    expect(normalizeUrl('saiteja.dev')).toBe('https://saiteja.dev');
    expect(normalizeUrl('https://x.dev')).toBe('https://x.dev');
    expect(isValidUrl('saiteja.dev')).toBe(true);
    expect(isValidUrl('not a url')).toBe(false);
  });

  it('extracts numbers and years', () => {
    expect(toNumberString('3 years')).toBe('3');
    expect(toNumberString('8.74 CGPA')).toBe('8.74');
    expect(toNumberString('none')).toBeNull();
    expect(toYear('Class of 2023')).toBe('2023');
    expect(toYear('19')).toBeNull();
  });
});

describe('toIsoDate', () => {
  it('passes through ISO dates and pads parts', () => {
    expect(toIsoDate('2001-07-14')).toBe('2001-07-14');
    expect(toIsoDate('2001-7-4')).toBe('2001-07-04');
  });

  it('reads an unambiguous day-first or month-first date', () => {
    expect(toIsoDate('25/12/2001')).toBe('2001-12-25');
    expect(toIsoDate('12/25/2001')).toBe('2001-12-25');
  });

  it('assumes day-first when ambiguous, matching v1 behaviour', () => {
    expect(toIsoDate('03/04/2001')).toBe('2001-04-03');
  });

  it('accepts written dates and rejects nonsense', () => {
    expect(toIsoDate('14 July 2001')).toBe('2001-07-14');
    expect(toIsoDate('not a date')).toBeNull();
    expect(toIsoDate('')).toBeNull();
    expect(toIsoDate('45/45/2001')).toBeNull();
  });
});

describe('toIsoTime', () => {
  it('converts 12-hour to 24-hour', () => {
    expect(toIsoTime('9:30')).toBe('09:30');
    expect(toIsoTime('9:30 am')).toBe('09:30');
    expect(toIsoTime('9:30 PM')).toBe('21:30');
    expect(toIsoTime('12:00 am')).toBe('00:00');
    expect(toIsoTime('12:00 pm')).toBe('12:00');
  });

  it('rejects impossible times', () => {
    expect(toIsoTime('25:00')).toBeNull();
    expect(toIsoTime('10:75')).toBeNull();
    expect(toIsoTime('morning')).toBeNull();
  });
});

describe('validateForField', () => {
  it('coerces to the control format', () => {
    expect(validateForField(field({ type: 'date' }), '14/07/2001').normalizedValue).toBe('2001-07-14');
    expect(validateForField(field({ type: 'time' }), '9:30 pm').normalizedValue).toBe('21:30');
    expect(validateForField(field({ type: 'number' }), '3 years').normalizedValue).toBe('3');
    expect(validateForField(field({ type: 'url' }), 'saiteja.dev').normalizedValue).toBe('https://saiteja.dev');
    expect(validateForField(field({ type: 'month' }), '2001-07-14').normalizedValue).toBe('2001-07');
  });

  it('reports a mismatch instead of writing a bad value', () => {
    const result = validateForField(field({ type: 'email' }), 'saiteja');
    expect(result.valid).toBe(false);
    expect(result.message).toMatch(/email/i);
  });

  it('trims to maxlength rather than failing', () => {
    const result = validateForField(field({ type: 'text', maxLength: 5 }), 'abcdefgh');
    expect(result.valid).toBe(true);
    expect(result.normalizedValue).toBe('abcde');
    expect(result.message).toMatch(/limit/i);
  });

  it('enforces minlength and author patterns', () => {
    expect(validateForField(field({ type: 'text', minLength: 5 }), 'abc').valid).toBe(false);
    expect(validateForField(field({ type: 'text', pattern: '\\d{4}' }), '2023').valid).toBe(true);
    expect(validateForField(field({ type: 'text', pattern: '\\d{4}' }), 'abcd').valid).toBe(false);
  });

  it('ignores an unparseable author pattern', () => {
    expect(validateForField(field({ type: 'text', pattern: '([' }), 'anything').valid).toBe(true);
  });

  it('handles lists, booleans and empty values', () => {
    expect(validateForField(field({ type: 'checkbox_group' }), ['a', 'b']).normalizedValue).toEqual(['a', 'b']);
    expect(validateForField(field({ type: 'checkbox' }), true).normalizedValue).toBe(true);
    expect(validateForField(field({ type: 'text' }), null).valid).toBe(false);
    expect(validateForField(field({ type: 'text' }), '   ').valid).toBe(false);
    expect(validateForField(field({ type: 'checkbox_group' }), []).valid).toBe(false);
  });
});

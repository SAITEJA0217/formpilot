/**
 * Value validation and coercion.
 *
 * A correct concept mapping still fails if the value is in the wrong shape: a
 * `date` input rejects `12/03/2001`, and a `number` input silently discards
 * `3 years`. This module converts a profile value into the exact string a given
 * control accepts, and reports when it cannot.
 */
import type { FieldType, UnifiedField } from '../types/form';
import type { ValueValidation } from '../types/suggestion';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;
const YEAR_RE = /^(19|20)\d{2}$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

/** Digits, optional leading `+`, optional separators. 7–15 digits (E.164 range). */
export function isValidPhone(value: string): boolean {
  const digits = value.replace(/[^\d]/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

export function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

export function isValidUrl(value: string): boolean {
  try {
    const url = new URL(normalizeUrl(value));
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Coerce a human-written date to `YYYY-MM-DD`.
 *
 * `DD/MM/YYYY` is assumed when the parts are ambiguous, matching the behaviour
 * the v1 Google Forms filler shipped with; an unambiguous part (>12) wins.
 * Returns null when no date can be recovered.
 */
export function toIsoDate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const iso = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const [, y, m, d] = iso;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  const slash = trimmed.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (slash) {
    const p1 = Number(slash[1]);
    const p2 = Number(slash[2]);
    const year = slash[3];
    let day: number;
    let month: number;
    if (p1 > 12) {
      day = p1;
      month = p2;
    } else if (p2 > 12) {
      day = p2;
      month = p1;
    } else {
      day = p1;
      month = p2;
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getUTCFullYear();
    if (y > 1900 && y < 2200) {
      return `${y}-${String(parsed.getUTCMonth() + 1).padStart(2, '0')}-${String(parsed.getUTCDate()).padStart(2, '0')}`;
    }
  }
  return null;
}

/** Coerce to 24-hour `HH:MM`. */
export function toIsoTime(value: string): string | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{1,2})[:.](\d{2})\s*(am|pm)?$/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === 'pm' && hours < 12) hours += 12;
  if (meridiem === 'am' && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** First number in the string, e.g. `3 years` → `3`, `8.5 CGPA` → `8.5`. */
export function toNumberString(value: string): string | null {
  const match = value.match(/-?\d+(\.\d+)?/);
  return match ? match[0] : null;
}

export function toYear(value: string): string | null {
  const match = value.match(/(19|20)\d{2}/);
  if (!match) return null;
  return YEAR_RE.test(match[0]) ? match[0] : null;
}

function coerceScalar(fieldType: FieldType, raw: string): ValueValidation {
  switch (fieldType) {
    case 'email':
      return isValidEmail(raw)
        ? { valid: true, normalizedValue: raw.trim() }
        : { valid: false, normalizedValue: raw.trim(), message: 'Value is not a valid email address.' };
    case 'tel':
      return isValidPhone(raw)
        ? { valid: true, normalizedValue: raw.trim() }
        : { valid: false, normalizedValue: raw.trim(), message: 'Value does not look like a phone number.' };
    case 'url': {
      const normalized = normalizeUrl(raw);
      return isValidUrl(normalized)
        ? { valid: true, normalizedValue: normalized }
        : { valid: false, normalizedValue: normalized, message: 'Value is not a valid URL.' };
    }
    case 'number':
    case 'range': {
      const num = toNumberString(raw);
      return num !== null
        ? { valid: true, normalizedValue: num }
        : { valid: false, normalizedValue: raw.trim(), message: 'Value is not numeric.' };
    }
    case 'date': {
      const date = toIsoDate(raw);
      return date
        ? { valid: true, normalizedValue: date }
        : { valid: false, normalizedValue: raw.trim(), message: 'Could not read a date from this value.' };
    }
    case 'month': {
      const date = toIsoDate(raw);
      return date
        ? { valid: true, normalizedValue: date.slice(0, 7) }
        : { valid: false, normalizedValue: raw.trim(), message: 'Could not read a month from this value.' };
    }
    case 'time': {
      const time = toIsoTime(raw);
      return time
        ? { valid: true, normalizedValue: time }
        : { valid: false, normalizedValue: raw.trim(), message: 'Could not read a time from this value.' };
    }
    default:
      return { valid: true, normalizedValue: raw };
  }
}

/**
 * Validate and coerce a candidate value against the control it will be written to.
 * Length and pattern constraints declared on the element are enforced here so the
 * page's own validation does not reject our fill.
 */
export function validateForField(
  field: UnifiedField,
  value: string | string[] | boolean | null,
): ValueValidation {
  if (value === null || value === undefined) {
    return { valid: false, normalizedValue: null, message: 'No value available.' };
  }

  if (typeof value === 'boolean') {
    return { valid: true, normalizedValue: value };
  }

  if (Array.isArray(value)) {
    const cleaned = value.map((v) => String(v).trim()).filter((v) => v.length > 0);
    return cleaned.length > 0
      ? { valid: true, normalizedValue: cleaned }
      : { valid: false, normalizedValue: [], message: 'No values available.' };
  }

  const raw = String(value);
  if (!raw.trim()) {
    return { valid: false, normalizedValue: '', message: 'Value is empty.' };
  }

  const coerced = coerceScalar(field.type, raw);
  if (!coerced.valid) return coerced;

  const normalized = typeof coerced.normalizedValue === 'string' ? coerced.normalizedValue : raw;

  if (field.maxLength && field.maxLength > 0 && normalized.length > field.maxLength) {
    return {
      valid: true,
      normalizedValue: normalized.slice(0, field.maxLength),
      message: `Trimmed to the field limit of ${field.maxLength} characters.`,
    };
  }
  if (field.minLength && normalized.length < field.minLength) {
    return {
      valid: false,
      normalizedValue: normalized,
      message: `Field requires at least ${field.minLength} characters.`,
    };
  }
  if (field.pattern) {
    try {
      if (!new RegExp(`^(?:${field.pattern})$`).test(normalized)) {
        return {
          valid: false,
          normalizedValue: normalized,
          message: 'Value does not match the format this field requires.',
        };
      }
    } catch {
      // An unparseable author pattern is not the user's problem — ignore it.
    }
  }
  return { valid: true, normalizedValue: normalized };
}

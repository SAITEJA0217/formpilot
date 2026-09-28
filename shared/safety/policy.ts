/**
 * Autofill safety policy.
 *
 * FormPilot is an assistant, not an agent acting on the user's behalf. This module
 * is the single place that decides a field must never be filled automatically, and
 * it is consulted twice: once when the form is normalized (so the review panel can
 * explain the refusal) and again inside the interaction engine (so a hand-edited
 * suggestion cannot bypass it).
 */
import type { FieldSensitivity, UnifiedField } from '../types/form';
import { normalizeText } from '../matching/normalize';
import { containsPhrase } from '../matching/similarity';

/** Phrases that mark a control as a credential or one-time secret. */
const SECRET_PHRASES = [
  'password', 'passcode', 'otp', 'one time password', 'one time code',
  'verification code', 'security code', 'authentication code', 'two factor',
  'cvv', 'cvc', 'card number', 'credit card', 'debit card', 'iban',
  'ssn', 'social security', 'aadhaar', 'aadhar', 'pan number',
  'passport number', 'national id', 'tax id', 'routing number',
  'account number', 'captcha',
];

/** Phrases that mark a control as a legal agreement or marketing consent. */
const CONSENT_PHRASES = [
  'i agree', 'i accept', 'i consent', 'i certify', 'i declare',
  'terms and conditions', 'terms of service', 'privacy policy',
  'accept the terms', 'agree to the terms', 'newsletter',
  'marketing emails', 'promotional emails', 'receive updates', 'subscribe',
];

/** `autocomplete` tokens that identify payment or one-time-code inputs. */
const BLOCKED_AUTOCOMPLETE = new Set([
  'cc-number', 'cc-csc', 'cc-exp', 'cc-exp-month', 'cc-exp-year',
  'cc-type', 'cc-name', 'one-time-code', 'new-password', 'current-password',
]);

/** Text on a control that submits, pays, or otherwise commits the user. */
export const CONSEQUENTIAL_ACTION_PATTERNS: readonly RegExp[] = [
  /\bsubmit\b/i,
  /\bsend\b/i,
  /\bapply\s*now\b/i,
  /\bpay\b/i,
  /\bpurchase\b/i,
  /\bcheckout\b/i,
  /\bconfirm\s*(order|payment|booking)\b/i,
  /\bplace\s*order\b/i,
  /\bsign\s*(in|up)\b/i,
  /\bdelete\b/i,
  /\bnext\b/i,
  /\bcontinue\b/i,
];

export interface SafetyVerdict {
  sensitivity: FieldSensitivity;
  reason?: string;
}

/**
 * Classify a field's sensitivity from its own attributes and text.
 * Runs before any concept matching, so an unrecognized field is still protected.
 */
export function evaluateFieldSafety(field: {
  type: UnifiedField['type'];
  label?: string;
  name?: string;
  elementId?: string;
  ariaLabel?: string;
  placeholder?: string;
  autocomplete?: string;
}): SafetyVerdict {
  if (field.type === 'password') {
    return { sensitivity: 'blocked', reason: 'Password fields are never autofilled.' };
  }

  const autocompleteToken = field.autocomplete?.toLowerCase().trim().split(/\s+/).pop();
  if (autocompleteToken && BLOCKED_AUTOCOMPLETE.has(autocompleteToken)) {
    return {
      sensitivity: 'blocked',
      reason: 'This field is declared as a credential or payment field.',
    };
  }

  const haystack = normalizeText(
    [field.label, field.ariaLabel, field.name, field.elementId, field.placeholder]
      .filter(Boolean)
      .join(' '),
  );

  for (const phrase of SECRET_PHRASES) {
    if (containsPhrase(haystack, normalizeText(phrase))) {
      return {
        sensitivity: 'blocked',
        reason: 'Credentials, one-time codes and payment or identity numbers are never autofilled.',
      };
    }
  }

  const isBooleanControl =
    field.type === 'checkbox' || field.type === 'checkbox_group' || field.type === 'radio_group';
  if (isBooleanControl) {
    for (const phrase of CONSENT_PHRASES) {
      if (containsPhrase(haystack, normalizeText(phrase))) {
        return {
          sensitivity: 'blocked',
          reason: 'Agreements and consent choices must be made by you.',
        };
      }
    }
  }

  if (field.type === 'file') {
    return {
      sensitivity: 'sensitive',
      reason: 'You choose the document to attach.',
    };
  }

  return { sensitivity: 'normal' };
}

/** True when clicking this element would submit or otherwise commit the form. */
export function isConsequentialAction(text: string | null | undefined): boolean {
  if (!text) return false;
  return CONSEQUENTIAL_ACTION_PATTERNS.some((re) => re.test(text));
}

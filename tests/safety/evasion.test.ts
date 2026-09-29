/**
 * Adversarial safety: can a hostile page get FormPilot to leak or commit something?
 *
 * Unlike the rest of the suite, these cases are written from the attacker's side. Each one
 * is a way a page could label or shape a control so that a naive policy misses what it
 * really is. Every entry below was a real miss when it was written: the first version of
 * `shared/safety/policy.ts` blocked 27 of the 60 cases here, which is why the phrase lists
 * are as long as they are and why the confusable fold exists.
 *
 * These are invariants, not preferences. A regression here means FormPilot would type a
 * one-time code into a phishing page or tick a legal agreement on the user's behalf, so CI
 * runs this file and a failure fails the build (see `.github/workflows/ci.yml`).
 *
 * The lists are not claimed to be exhaustive — no phrase list can be. They are the floor,
 * and `isAffirmationControl` is the structural backstop that does not depend on wording.
 */
import { describe, expect, it } from 'vitest';
import {
  evaluateFieldSafety,
  isAffirmationControl,
  isConsequentialAction,
} from '../../shared/safety/policy';

/**
 * Ways to hide a credential, one-time code, payment instrument or government id.
 *
 * Grouped by the evasion technique rather than by field kind, because the technique is
 * what the policy has to defeat.
 */
const SECRET_EVASIONS: { technique: string; field: Record<string, string> }[] = [
  // Baseline — must always hold.
  { technique: 'plain label', field: { label: 'Password' } },

  // Invisible characters spliced into the word.
  { technique: 'zero-width space inside the word', field: { label: 'Pass​word' } },
  { technique: 'soft hyphen inside the word', field: { label: 'Pass­word' } },

  // Look-alike letters from another script.
  { technique: 'Cyrillic homoglyphs', field: { label: 'Раssword' } },
  { technique: 'fullwidth Latin', field: { label: 'ＰＡＳＳＷＯＲＤ' } },

  // One-time codes described without any of the obvious keywords.
  { technique: 'digit count instead of "OTP"', field: { label: 'Enter the 6-digit code we texted you' } },
  { technique: 'delivery channel instead of "OTP"', field: { label: 'Code sent to your phone' } },
  { technique: 'SMS wording', field: { label: 'SMS code' } },
  { technique: 'authenticator app wording', field: { label: 'Authenticator app code' } },
  { technique: 'MFA acronym', field: { label: 'MFA code' } },
  { technique: '2FA acronym', field: { label: '2FA code' } },

  // Payment rails that never say "card".
  { technique: 'abbreviated card number', field: { label: 'Card no.' } },
  { technique: 'numero sign', field: { label: 'Card №' } },
  { technique: 'expiry without "card"', field: { label: 'Expiry date (MM/YY)' } },
  { technique: 'PIN, qualified', field: { label: 'ATM PIN' } },
  { technique: 'PIN, qualified another way', field: { label: 'Transaction PIN' } },
  { technique: 'Indian UPI rail', field: { label: 'UPI ID' } },
  { technique: 'bank account', field: { label: 'Bank account number' } },
  { technique: 'UK sort code', field: { label: 'Sort code' } },

  // Government identifiers beyond the US/India ones already covered.
  { technique: 'driving licence', field: { label: 'Driving licence number' } },
  { technique: 'voter id', field: { label: 'Voter ID number' } },
  { technique: 'UK national insurance', field: { label: 'National Insurance number' } },

  // Knowledge-based authentication, which is a credential wearing a different hat.
  { technique: 'security question answer', field: { label: 'Security question answer' } },
  { technique: "mother's maiden name", field: { label: "Mother's maiden name" } },

  // The sensitive word is somewhere other than the visible label.
  { technique: 'aria-label contradicts the visible label', field: { label: 'Favourite colour', ariaLabel: 'CVV' } },
  { technique: 'only the name attribute gives it away', field: { name: 'card_cvc' } },
  { technique: 'only the id gives it away', field: { elementId: 'otp-input' } },
  { technique: 'only the placeholder gives it away', field: { placeholder: 'Enter your passcode' } },
];

/** Ways to word a legal agreement or marketing opt-in so it does not read as one. */
const CONSENT_EVASIONS: { technique: string; label: string }[] = [
  { technique: 'first person (baseline)', label: 'I agree to the Terms and Conditions' },
  { technique: 'second person', label: 'By ticking this box you agree to our terms' },
  { technique: 'imperative', label: 'Tick here to confirm you have read the privacy notice' },
  { technique: 'acknowledge rather than agree', label: 'I acknowledge the data processing notice' },
  { technique: 'authorise rather than agree', label: 'I authorise the background check' },
  { technique: 'opt-in phrasing', label: 'Opt in to receive offers' },
  { technique: 'colloquial marketing', label: 'Keep me posted about new roles' },
  { technique: 'third-party sharing', label: 'You consent to being contacted by partners' },
  { technique: 'electronic signature', label: 'I electronically sign this application' },
  { technique: 'truth attestation', label: 'The above information is true and correct' },
  { technique: 'regulation by name', label: 'I have read and understood the GDPR notice' },
];

/** Control text that would commit the user if clicked. */
const CONSEQUENTIAL_TEXT = [
  'Submit', 'Send', 'Apply Now', 'Pay', 'Checkout', 'Next', 'Continue',
  'Finish', 'Done', 'Save and submit', 'Complete application', 'Agree and continue',
  'Confirm', 'Proceed', 'Yes, delete', 'Place Order', 'Buy now', 'Subscribe',
  'Start free trial', 'Authorise payment', 'Sign', 'Accept',
];

/**
 * Text that must stay clickable.
 *
 * The consequential-action list is deliberately generous, and a guard that refuses
 * everything would be safe but useless — the engine uses it to decide whether it may click
 * an option in a radio or checkbox group. These are ordinary answers that must not trip it.
 */
const ORDINARY_OPTION_TEXT = [
  'Yes', 'No', 'Male', 'Female', 'Prefer not to say',
  'India', 'United States', 'Germany',
  'B.Tech', 'Master of Science', 'Computer Science and Engineering',
  '0-2 years', '3-5 years', 'More than 10 years',
  'TypeScript', 'React', 'PostgreSQL',
  'Full time', 'Part time', 'Internship', 'Remote', 'Hybrid',
  'Immediately', 'Within a month', 'Design', 'Assignment', 'Signature verified',
];

describe('secrets cannot be reached by relabelling', () => {
  for (const { technique, field } of SECRET_EVASIONS) {
    it(`blocks: ${technique}`, () => {
      const verdict = evaluateFieldSafety({ type: 'text', ...field });
      expect(verdict.sensitivity).toBe('blocked');
      expect(verdict.reason).toBeTruthy();
    });
  }

  it('blocks a password input on its type alone, whatever it is labelled', () => {
    expect(evaluateFieldSafety({ type: 'password', label: 'Nickname' }).sensitivity).toBe('blocked');
  });

  it('blocks on the autocomplete token even when the label is innocuous', () => {
    for (const token of ['cc-number', 'cc-csc', 'one-time-code', 'new-password']) {
      expect(
        evaluateFieldSafety({ type: 'text', label: 'Reference', autocomplete: token }).sensitivity,
        token,
      ).toBe('blocked');
    }
  });
});

describe('consent cannot be reached by rewording', () => {
  for (const { technique, label } of CONSENT_EVASIONS) {
    it(`blocks: ${technique}`, () => {
      expect(evaluateFieldSafety({ type: 'checkbox', label }).sensitivity).toBe('blocked');
    });
  }

  it('blocks consent wording on grouped controls too', () => {
    for (const type of ['checkbox_group', 'radio_group'] as const) {
      expect(
        evaluateFieldSafety({ type, label: 'Do you accept the terms of use?' }).sensitivity,
        type,
      ).toBe('blocked');
    }
  });
});

describe('a single checkbox is never ticked without the user', () => {
  it('treats a lone checkbox as an affirmation', () => {
    expect(isAffirmationControl('checkbox')).toBe(true);
  });

  it('does not treat a group or a selection as an affirmation', () => {
    // A group is a choice among options ("which skills do you have?"), not an assertion,
    // so pre-selecting from the profile is legitimate there.
    for (const type of ['checkbox_group', 'radio_group', 'select_one', 'select_many', 'text', 'textarea'] as const) {
      expect(isAffirmationControl(type), type).toBe(false);
    }
  });

  it('holds for a checkbox with no sensitive wording at all', () => {
    // "Willing to relocate" is not consent and is not blocked, but ticking it still
    // asserts something about the user, so it must not arrive pre-accepted.
    const verdict = evaluateFieldSafety({ type: 'checkbox', label: 'Willing to relocate' });
    expect(verdict.sensitivity).toBe('normal');
    expect(isAffirmationControl('checkbox')).toBe(true);
  });
});

describe('nothing that commits the user is clickable', () => {
  for (const text of CONSEQUENTIAL_TEXT) {
    it(`refuses to click: ${text}`, () => {
      expect(isConsequentialAction(text)).toBe(true);
    });
  }

  it('ignores empty and missing text rather than treating it as safe to click', () => {
    expect(isConsequentialAction('')).toBe(false);
    expect(isConsequentialAction(null)).toBe(false);
    expect(isConsequentialAction(undefined)).toBe(false);
  });
});

describe('the guard stays usable', () => {
  for (const text of ORDINARY_OPTION_TEXT) {
    it(`still allows an ordinary answer: ${text}`, () => {
      expect(isConsequentialAction(text)).toBe(false);
    });
  }
});

/**
 * Fields that must NOT be blocked.
 *
 * The phrase lists are deliberately generous, and generosity has a cost: a bare `pin` in the
 * secret list blocked "PIN Code", which in India is a postal code, not a secret. That was
 * caught by a 400-field performance form reporting 27 blocked fields. Over-blocking is a real
 * defect — a safety net that catches ordinary fields stops being used — so it is tested too.
 */
const MUST_STAY_FILLABLE: { why: string; field: Record<string, string> }[] = [
  { why: 'Indian postal code', field: { label: 'PIN Code' } },
  { why: 'Indian postal code, no space', field: { label: 'Pincode' } },
  { why: 'Indian postal code, spelled out', field: { label: 'PIN number' } },
  { why: 'ordinary postal code', field: { label: 'ZIP / Postal Code' } },
  { why: 'a name', field: { label: 'Full Name' } },
  { why: 'an email address', field: { label: 'Email Address' } },
  { why: 'a phone number', field: { label: 'Phone Number' } },
  { why: 'an employer', field: { label: 'Current Company' } },
  { why: 'a job title', field: { label: 'Job Title' } },
  { why: 'a street address', field: { label: 'Address Line 1' } },
  { why: 'a city', field: { label: 'City' } },
  { why: 'a country', field: { label: 'Country' } },
  { why: 'a graduation year', field: { label: 'Graduation Year' } },
  { why: 'an account name, not a number', field: { label: 'Account holder name' } },
  { why: 'a tin of something', field: { label: 'Tin size' } },
];

describe('ordinary fields are not blocked', () => {
  for (const { why, field } of MUST_STAY_FILLABLE) {
    it(`leaves ${why} alone: ${field.label}`, () => {
      expect(evaluateFieldSafety({ type: 'text', ...field }).sensitivity).toBe('normal');
    });
  }
});

describe('file inputs are never chosen automatically', () => {
  it('marks a file input sensitive and says the user picks the document', () => {
    const verdict = evaluateFieldSafety({ type: 'file', label: 'Upload your resume' });
    expect(verdict.sensitivity).toBe('sensitive');
    expect(verdict.reason).toMatch(/you choose/i);
  });

  it('blocks rather than merely flags a file input that asks for an identity document', () => {
    expect(
      evaluateFieldSafety({ type: 'file', label: 'Upload a photo of your passport number page' })
        .sensitivity,
    ).toBe('blocked');
  });
});

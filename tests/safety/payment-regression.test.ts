/**
 * Payment-field refusals, from the four real misses the v1 held-out evaluation found.
 *
 * Written before the fix, against third-party markup nobody here authored. All four cases below
 * came back as concept mappings rather than refusals:
 *
 *   "CC Name (Full name as given on the payment instrument)" → person.full_name
 *   "CC Exp Year"                                            → experience.years_of_experience
 *   name="cc-name"        (no visible label)                  → person.full_name
 *   name="cc-exp-year"    (no visible label)                  → experience.years_of_experience
 *
 * Sixty self-authored adversarial cases missed all four, which is the point: the phrase list was
 * written by someone imagining how a payment field might be labelled, and real authors label them
 * `cc-*` after the `autocomplete` token they are pairing it with.
 *
 * The fix is deliberately *not* four more phrases. `shared/safety/policy.ts` gains a pattern for
 * the payment-field naming convention and a prefix rule on `autocomplete`, so a token or label this
 * file never anticipated is still caught.
 */
import { describe, expect, it } from 'vitest';
import { evaluateFieldSafety } from '../../shared/safety/policy';

/** Exactly the four records the held-out evaluation misclassified, verbatim. */
const HELD_OUT_MISSES: { why: string; field: Record<string, string> }[] = [
  {
    why: 'visible label, cardholder name (ericwbailey/modal-nodes)',
    field: { label: 'CC Name (Full name as given on the payment instrument)' },
  },
  { why: 'visible label, expiry year (ericwbailey/modal-nodes)', field: { label: 'CC Exp Year' } },
  { why: 'name attribute only, cardholder name (samdutton/simpl)', field: { name: 'cc-name' } },
  { why: 'name attribute only, expiry year (samdutton/simpl)', field: { name: 'cc-exp-year' } },
];

describe('the four held-out misses are refused', () => {
  for (const { why, field } of HELD_OUT_MISSES) {
    it(`blocks: ${why}`, () => {
      const verdict = evaluateFieldSafety({ type: 'text', ...field });
      expect(verdict.sensitivity).toBe('blocked');
      expect(verdict.reason).toBeTruthy();
    });
  }
});

/**
 * The rest of the `cc-*` family, and the `card ...` phrasing.
 *
 * Present so the fix generalises rather than patching four rows. Each of these is a token from the
 * WHATWG autofill table or the obvious label for one, and none of them appears in the four cases
 * above.
 */
describe('the payment-field naming convention is refused generally', () => {
  const CONVENTION = [
    'cc-number', 'cc-num', 'cc-no', 'cc-name', 'cc-given-name', 'cc-family-name',
    'cc-exp', 'cc-exp-month', 'cc-exp-year', 'cc-csc', 'cc-cvv', 'cc-cvc', 'cc-type',
    'cc-security-code', 'cc-pin',
  ];
  for (const name of CONVENTION) {
    it(`blocks name="${name}"`, () => {
      expect(evaluateFieldSafety({ type: 'text', name }).sensitivity).toBe('blocked');
    });
  }

  const LABELS = [
    'CC Number', 'CC Num', 'CC Type', 'CC CSC', 'CC Security Code',
    'Card Name', 'Card Holder', 'Cardholder Name', 'Name on Card', 'Name as it appears on the card',
    'Card Expiry', 'Card Expiration Month', 'Card Exp Year', 'Card Security Code',
    'Card Verification Value', 'Card Verification Code',
  ];
  for (const label of LABELS) {
    it(`blocks label "${label}"`, () => {
      expect(evaluateFieldSafety({ type: 'text', label }).sensitivity).toBe('blocked');
    });
  }
});

/**
 * Any `cc-*` autocomplete token, by prefix.
 *
 * The previous implementation enumerated the tokens it knew. A prefix rule covers the ones the
 * specification may add later without anyone remembering to update a list.
 */
describe('cc-* autocomplete tokens are refused by prefix, not by enumeration', () => {
  const TOKENS = [
    'cc-number', 'cc-csc', 'cc-exp', 'cc-exp-month', 'cc-exp-year', 'cc-type', 'cc-name',
    'cc-given-name', 'cc-additional-name', 'cc-family-name',
    // Not in today's specification. A prefix rule refuses it anyway, which is the point.
    'cc-some-token-nobody-has-written-yet',
  ];
  for (const token of TOKENS) {
    it(`blocks autocomplete="${token}" even with an innocuous label`, () => {
      expect(
        evaluateFieldSafety({ type: 'text', label: 'Reference', autocomplete: token }).sensitivity,
      ).toBe('blocked');
    });
  }

  it('honours the section and mode prefixes the specification allows', () => {
    for (const raw of ['billing cc-number', 'section-payment shipping cc-csc']) {
      expect(evaluateFieldSafety({ type: 'text', autocomplete: raw }).sensitivity, raw).toBe('blocked');
    }
  });
});

/** Financial authorisation is a consent decision, not a value to fill. */
describe('financial authorisation is left to the user', () => {
  const AUTHORISATIONS = [
    'I authorise this payment',
    'I authorize the charge to my card',
    'I agree to be charged monthly',
    'Authorise the direct debit',
    'I accept the recurring billing terms',
    'Set up a standing order',
  ];
  for (const label of AUTHORISATIONS) {
    it(`blocks the checkbox "${label}"`, () => {
      expect(evaluateFieldSafety({ type: 'checkbox', label }).sensitivity).toBe('blocked');
    });
  }
});

/**
 * Ordinary fields that must stay fillable.
 *
 * The counterweight. Widening the payment rules broke "PIN Code" once already — an Indian postal
 * code, not a credential — so every widening is tested from both sides. `CC` in an email compose
 * form means carbon copy, which is why the rule requires a payment noun beside it rather than
 * treating a bare `cc` as fatal.
 */
describe('ordinary fields are not caught by the payment rules', () => {
  const FILLABLE = [
    { why: 'email carbon copy', field: { label: 'CC' } },
    { why: 'email carbon copy, spelled out', field: { label: 'Cc recipients' } },
    { why: 'email blind copy', field: { label: 'BCC' } },
    { why: 'Indian postal code', field: { label: 'PIN Code' } },
    { why: 'a name', field: { label: 'Full Name' } },
    { why: 'a name on a form, not a card', field: { label: 'Name' } },
    { why: 'an employer', field: { label: 'Current Company' } },
    { why: 'a loyalty card, not a payment card', field: { label: 'Library card name' } },
    { why: 'years of experience', field: { label: 'Years of Experience' } },
    { why: 'graduation year', field: { label: 'Graduation Year' } },
    { why: 'an expiry that is not a card', field: { label: 'Passport expiry city' } },
  ];
  for (const { why, field } of FILLABLE) {
    it(`leaves ${why} alone: ${JSON.stringify(Object.values(field)[0])}`, () => {
      expect(evaluateFieldSafety({ type: 'text', ...field }).sensitivity).toBe('normal');
    });
  }
});

/**
 * The stated reason has to be true, not merely cautious.
 *
 * Found by the React, Vue and Angular E2E specs after the financial-authorisation rule went in:
 * every one of their `Subscribe to the newsletter` checkboxes came back refused — correctly — but
 * with "Authorising a payment is a decision only you can make." Nothing about that control involves
 * money. The refusal count was right, so a test that only counted refusals would have stayed green.
 *
 * It matters because the user's whole basis for trusting a refusal is the sentence beside it. A
 * reason that is visibly wrong on a newsletter opt-in teaches them to discount the same sentence on
 * a real payment control. So a subscription counts as a financial commitment only where the control
 * also names money; otherwise it is a marketing consent choice and says so.
 */
describe('a refusal names the reason that actually applies', () => {
  const reasonFor = (label: string): string =>
    evaluateFieldSafety({ type: 'checkbox', label }).reason ?? '';

  const CONSENT_NOT_PAYMENT = [
    'Subscribe to the newsletter',
    'Subscribe to our mailing list',
    'Yes, subscribe me to product updates',
    'Subscribe',
    'Newsletter subscription',
  ];
  for (const label of CONSENT_NOT_PAYMENT) {
    it(`calls ${JSON.stringify(label)} a consent choice, not a payment`, () => {
      const verdict = evaluateFieldSafety({ type: 'checkbox', label });
      // Still refused — a marketing opt-in is the user's own choice either way.
      expect(verdict.sensitivity).toBe('blocked');
      expect(verdict.reason).toMatch(/consent|agreement/i);
      expect(verdict.reason).not.toMatch(/payment/i);
    });
  }

  const GENUINELY_FINANCIAL = [
    'Subscribe for $9.99 per month',
    'Start my paid subscription',
    'I agree to a monthly subscription fee',
    'Subscribe to the Premium plan and begin billing',
    'Subscribe now — free trial, then billed annually',
  ];
  for (const label of GENUINELY_FINANCIAL) {
    it(`calls ${JSON.stringify(label)} a payment authorisation`, () => {
      const verdict = evaluateFieldSafety({ type: 'checkbox', label });
      expect(verdict.sensitivity).toBe('blocked');
      expect(verdict.reason).toMatch(/payment/i);
    });
  }

  it('still names a payment for the authorisation wordings that have nothing to do with subscriptions', () => {
    expect(reasonFor('I authorise a charge to my card')).toMatch(/payment/i);
    expect(reasonFor('Set up a direct debit')).toMatch(/payment/i);
    expect(reasonFor('Auto-renew my plan')).toMatch(/payment/i);
  });
});

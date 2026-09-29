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

/**
 * Phrases that mark a control as a credential, one-time secret, payment instrument or
 * government identifier.
 *
 * The list is long on purpose. Every entry past the obvious ones was added because an
 * adversarial probe (`tests/safety/evasion.test.ts`) showed the shorter list missing it:
 * "SMS code" and "the 6-digit code we texted you" are one-time codes that contain none of
 * the words `otp`, `verification` or `one time`, and "Sort code" and "UPI ID" are payment
 * rails with no card in the name. A phrase list can never be complete, so it is one of
 * several layers — see `isAffirmationControl` and the `confusables` fold below.
 */
const SECRET_PHRASES = [
  // Passwords and PINs. `pin` alone is deliberately absent: in India "PIN Code" and
  // "PIN number" both mean Postal Index Number, so a bare `pin` blocked ordinary
  // postal-code fields — 27 of them in a 400-field test form. Only the qualified forms,
  // where the word can only mean a secret, are listed.
  'password', 'passcode', 'pass phrase', 'passphrase',
  'atm pin', 'card pin', 'debit pin', 'credit pin', 'upi pin', 'mpin',
  'security pin', 'transaction pin', 'login pin', 'pin to authorise',
  // One-time and second-factor codes.
  'otp', 'one time password', 'one time code', 'single use code',
  'verification code', 'security code', 'authentication code', 'authenticator',
  'two factor', 'two step', '2fa', 'mfa', 'sms code', 'text code', 'email code',
  'login code', 'access code', 'confirmation code', 'digit code', 'code sent',
  'code we sent', 'code we texted', 'code from the app',
  // Knowledge-based authentication, which is a credential in all but name.
  'security question', 'secret question', 'security answer', 'maiden name',
  // Cards and bank rails.
  'cvv', 'cvc', 'cvv2', 'csc', 'valid thru', 'valid through',
  'card number', 'card no', 'cardnumber', 'credit card',
  'debit card', 'card expiry', 'card expiration', 'expiry date', 'expiration date',
  'iban', 'bic', 'swift code', 'sort code', 'routing number', 'account number',
  'upi', 'upi id', 'vpa',
  // Government and national identifiers.
  'ssn', 'social security', 'aadhaar', 'aadhar', 'pan number', 'passport number',
  // `tin` alone is left out for the same reason as `pin`: too short to be unambiguous.
  'national id', 'national insurance', 'nin', 'tax id', 'tin number', 'voter id',
  'driving licence', 'drivers licence', 'driving license', 'drivers license',
  'licence number', 'license number',
  // Anti-bot.
  'captcha',
];

/**
 * Phrases that mark a control as a legal agreement or marketing consent.
 *
 * Also expanded from the adversarial probe. The original list only caught first-person
 * wording ("I agree"), so every site that writes "By ticking this box you agree to our
 * terms" or "Tick here to confirm you have read the privacy notice" slipped through.
 */
const CONSENT_PHRASES = [
  // First person.
  'i agree', 'i accept', 'i consent', 'i certify', 'i declare', 'i confirm',
  'i acknowledge', 'i authorise', 'i authorize', 'i understand', 'i have read',
  'i electronically sign', 'i sign',
  // Second person and imperative, which is how most real sites word it.
  'you agree', 'you accept', 'you consent', 'you authorise', 'you authorize',
  'agree to', 'agree with', 'accept the', 'consent to', 'acknowledge the',
  'by ticking', 'by checking', 'by submitting', 'by signing', 'tick here',
  'tick this box', 'check this box', 'check the box',
  // The documents themselves.
  'terms and conditions', 'terms of service', 'terms of use', 'privacy policy',
  'privacy notice', 'cookie policy', 'data processing', 'gdpr', 'code of conduct',
  'background check', 'credit check',
  // Attestations.
  'true and correct', 'true and accurate', 'read and understood',
  'read and accept', 'best of my knowledge', 'electronically sign', 'e sign',
  // Marketing opt-in.
  'newsletter', 'marketing emails', 'promotional emails', 'receive updates',
  'receive offers', 'receive news', 'subscribe', 'opt in', 'keep me posted',
  'send me', 'contact me', 'contacted by', 'third parties', 'partners',
];

/** `autocomplete` tokens that identify a credential or one-time code. */
const BLOCKED_AUTOCOMPLETE = new Set(['one-time-code', 'new-password', 'current-password']);

/**
 * `autocomplete` token prefixes that identify a payment instrument.
 *
 * A prefix rule rather than an enumeration. Every payment token the WHATWG autofill table defines
 * begins `cc-`, and the table gains entries over time; an enumeration only covers the ones whoever
 * wrote it happened to know. `cc-given-name` and `cc-additional-name` are already in the
 * specification and were both missing from the list this replaced.
 */
const BLOCKED_AUTOCOMPLETE_PREFIXES = ['cc-'];

/**
 * Field-name patterns for payment instruments.
 *
 * These exist because a phrase list could not catch what real markup actually does. The v1 held-out
 * evaluation put the policy in front of 33 payment and credential controls written by strangers and
 * it missed four, all of the same shape: authors name the field after the `autocomplete` token they
 * are pairing it with, so a cardholder-name input is `cc-name` or labelled "CC Name" — words that
 * appear nowhere in a list built by imagining how a payment field might be worded.
 *
 * A pattern generalises where a list cannot. `cc` or `card` beside a payment noun is the naming
 * convention the whole industry uses, and matching the convention covers the spellings nobody here
 * thought of.
 *
 * The payment noun is required. A bare `cc` must stay fillable: in an email compose form `CC` means
 * carbon copy, and blocking it would be the same class of mistake as blocking "PIN Code" — an
 * Indian postal code — which a bare `pin` in the phrase list did until it was caught.
 */
const PAYMENT_FIELD_PATTERNS: readonly RegExp[] = [
  // `cc name`, `card expiry`, `cc exp year`, `card type`. Normalization has already split
  // `cc-exp-year` into words, so one pattern covers attributes and visible labels alike.
  // `experience` is accepted beside a card token as a second line of defence: the normalizer now
  // expands `cc exp` to `cc expiry`, but the safety layer should not depend on that being right.
  /\b(cc|card|creditcard|debitcard)\s+(number|num|no|name|holder|owner|given\s+name|family\s+name|additional\s+name|exp|expiry|expiration|expires|experience|month|year|date|code|csc|cvv|cvc|cvn|cid|type|brand|pin|security|verification)\b/,
  // One word, no space: `cardholder`, `cardnumber`.
  /\bcard\s*(holder|number|num)\b|\bcardholder\b/,
  // The reverse order checkout pages use, with room for the words people put in between:
  // `name on card`, `name as it appears on the card`, `number printed on your card`.
  /\b(number|name|code|csc|cvv|cvc|expiry|expiration)\b[a-z\s]{0,24}\bon\s+(the\s+|your\s+)?(credit\s+|debit\s+)?card\b/,
  // `card verification value`, spelled out.
  /\bcard\s+verification\b/,
];

/**
 * Words that mean a nearby `card` is not a payment card.
 *
 * Without this, "Library card name" is refused — the same class of mistake as refusing "PIN Code",
 * an Indian postal code, which a bare `pin` in the phrase list did until an independent test caught
 * it. Over-blocking is a real defect: a safety net that catches ordinary fields stops being used.
 */
/**
 * Knowledge-based authentication questions.
 *
 * A security question is a credential wearing the clothes of an ordinary question, and the phrase
 * list only caught the ones that say so ("security question answer"). The frozen safety corpus
 * showed "What was your first pet's name?" getting a *suggestion* — the worst outcome of the three
 * gaps it found, because the other two merely failed to be labelled as refusals while still
 * offering no value.
 *
 * The discriminator is the noun, not the question shape. "What was your first job?" is a legitimate
 * application question and must stay reviewable, so a pattern like `what was your first ...` is too
 * broad. Only the nouns that exist almost exclusively as account-recovery answers are listed.
 */
const KBA_QUESTION_PATTERNS: readonly RegExp[] = [
  /\b(first|favourite|favorite|childhood|maiden)\s+(pet|pets|school|teacher|street|nickname|car|memory|neighbour|neighbor)\b/,
  /\bmaiden\s+name\b/,
  /\bstreet\s+you\s+grew\s+up\b/,
  /\bcity\s+(you\s+)?(were\s+)?born\b/,
];

const NOT_A_PAYMENT_CARD = [
  'library', 'loyalty', 'membership', 'member', 'id card', 'identity card', 'business card',
  'sim card', 'graphics card', 'report card', 'gift card holder name', 'boarding',
  'access card', 'key card', 'student card', 'travel card', 'transit card',
];

/**
 * Phrases that mark a boolean control as authorising money to move.
 *
 * Kept separate from `CONSENT_PHRASES` because the consequence is different in kind: agreeing to
 * terms is a commitment, authorising a charge is a transaction. Both are refused, and the reason
 * shown to the user names which one it is.
 */
const FINANCIAL_AUTHORISATION_PATTERNS: readonly RegExp[] = [
  /\bauthoris|\bauthoriz/,
  /\bcharge(d)?\b/,
  /\bdirect\s+debit\b/,
  /\bstanding\s+order\b/,
  /\brecurring\s+(billing|payment|charge)\b/,
  /\bauto\s*renew/,
  /\bsubscri(be|ption)\b/,
];

/**
 * Text on a control that submits, pays, or otherwise commits the user.
 *
 * Over-matching here is cheap and under-matching is not: the only consequence of a false
 * positive is that FormPilot declines to click a choice and says so, whereas a false
 * negative means clicking something that commits the user. The list is therefore
 * deliberately generous.
 */
export const CONSEQUENTIAL_ACTION_PATTERNS: readonly RegExp[] = [
  // Submission and navigation between steps.
  /\bsubmit\b/i,
  /\bsend\b/i,
  /\bapply\s*now\b/i,
  /\bnext\b/i,
  /\bcontinue\b/i,
  /\bproceed\b/i,
  /\bfinish\b/i,
  /\bdone\b/i,
  /\bcomplete\b/i,
  /\bconfirm\b/i,
  // Money.
  /\bpay\b/i,
  /\bpayment\b/i,
  /\bpurchase\b/i,
  /\bbuy\b/i,
  /\bcheckout\b/i,
  /\bplace\s*order\b/i,
  /\bdonate\b/i,
  /\btransfer\b/i,
  /\bwithdraw\b/i,
  /\bsubscribe\b/i,
  /\bfree\s*trial\b/i,
  // Authentication and identity.
  /\bsign\s*(in|up|out)\b/i,
  /\bsign\b/i,
  /\blog\s*(in|out)\b/i,
  /\bregister\b/i,
  // Agreement.
  /\baccept\b/i,
  /\bagree\b/i,
  /\bauthorise\b/i,
  /\bauthorize\b/i,
  // Destructive.
  /\bdelete\b/i,
  /\bremove\b/i,
  /\bcancel\s*(order|booking|subscription)\b/i,
];

/**
 * Letters from other scripts that render like Latin ones.
 *
 * A page that labels a field "Раssword" with a Cyrillic Р and а reads identically to a
 * human but matched none of the phrases above, so the field came back `normal`. Folding
 * these to their Latin look-alikes closes that off. The fold is applied *only* as an extra
 * safety check, never to the text the matcher sees: it is lossy, and making `а` and `a`
 * interchangeable everywhere would invent concept matches that are not there.
 */
const CONFUSABLES: Readonly<Record<string, string>> = {
  // Cyrillic.
  а: 'a', в: 'b', с: 'c', е: 'e', н: 'h', к: 'k', м: 'm', о: 'o',
  р: 'p', ѕ: 's', т: 't', у: 'y', х: 'x', і: 'i', ј: 'j', ԁ: 'd',
  // Greek.
  α: 'a', β: 'b', ε: 'e', ι: 'i', κ: 'k', ο: 'o', ρ: 'p', τ: 't',
  υ: 'u', ν: 'v', χ: 'x', γ: 'y', ϲ: 'c',
};

/**
 * Replace look-alike letters with their Latin equivalents.
 *
 * Lookup is on the lower-cased character so the table needs only one case: Cyrillic `Р`
 * lower-cases to `р`, which is in the map. The result is fed to `normalizeText`, which
 * lower-cases everything anyway, so losing case here costs nothing.
 */
function foldConfusables(text: string): string {
  let folded = '';
  for (const character of text) {
    folded += CONFUSABLES[character.toLowerCase()] ?? character;
  }
  return folded;
}

/**
 * True for a control whose only meaning is "yes, I affirm this".
 *
 * A single checkbox is an assertion the user makes; a checkbox *group* is a choice among
 * options ("which skills do you have?"), and a radio group is likewise a selection. So
 * only the single checkbox gets this treatment. Callers use it to refuse pre-acceptance:
 * a phrase list will always miss some wording, but "never tick a box on the user's behalf
 * without them clicking it" holds regardless of what the label says.
 */
export function isAffirmationControl(type: UnifiedField['type']): boolean {
  return type === 'checkbox';
}

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
  if (
    autocompleteToken &&
    (BLOCKED_AUTOCOMPLETE.has(autocompleteToken) ||
      BLOCKED_AUTOCOMPLETE_PREFIXES.some((prefix) => autocompleteToken.startsWith(prefix)))
  ) {
    return {
      sensitivity: 'blocked',
      reason: 'This field is declared as a credential or payment field.',
    };
  }

  const raw = [field.label, field.ariaLabel, field.name, field.elementId, field.placeholder]
    .filter(Boolean)
    .join(' ');

  // Two views of the same text: as written, and with look-alike letters folded to Latin.
  // A phrase only has to hit one of them, so a page cannot dodge the policy by spelling
  // "Password" with a Cyrillic а.
  const haystacks = [normalizeText(raw)];
  const folded = normalizeText(foldConfusables(raw));
  if (folded !== haystacks[0]) haystacks.push(folded);

  const matchesAny = (phrases: readonly string[]): boolean =>
    phrases.some((phrase) => {
      const needle = normalizeText(phrase);
      return haystacks.some((haystack) => containsPhrase(haystack, needle));
    });

  const matchesPattern = (patterns: readonly RegExp[]): boolean =>
    patterns.some((pattern) => haystacks.some((haystack) => pattern.test(haystack)));

  if (matchesPattern(PAYMENT_FIELD_PATTERNS) && !matchesAny(NOT_A_PAYMENT_CARD)) {
    return {
      sensitivity: 'blocked',
      reason: 'Payment card details are never autofilled — you enter those yourself.',
    };
  }

  if (matchesPattern(KBA_QUESTION_PATTERNS)) {
    return {
      sensitivity: 'blocked',
      reason: 'Security questions are account credentials — only you should answer them.',
    };
  }

  if (matchesAny(SECRET_PHRASES)) {
    return {
      sensitivity: 'blocked',
      reason: 'Credentials, one-time codes and payment or identity numbers are never autofilled.',
    };
  }

  const isBooleanControl =
    field.type === 'checkbox' || field.type === 'checkbox_group' || field.type === 'radio_group';
  if (isBooleanControl && matchesPattern(FINANCIAL_AUTHORISATION_PATTERNS)) {
    return {
      sensitivity: 'blocked',
      reason: 'Authorising a payment is a decision only you can make.',
    };
  }
  if (isBooleanControl && matchesAny(CONSENT_PHRASES)) {
    return {
      sensitivity: 'blocked',
      reason: 'Agreements and consent choices must be made by you.',
    };
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

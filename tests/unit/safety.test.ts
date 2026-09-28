import { describe, expect, it } from 'vitest';
import { evaluateFieldSafety, isConsequentialAction } from '../../shared/safety/policy';

describe('evaluateFieldSafety', () => {
  it('blocks password inputs by type alone', () => {
    const verdict = evaluateFieldSafety({ type: 'password' });
    expect(verdict.sensitivity).toBe('blocked');
    expect(verdict.reason).toMatch(/password/i);
  });

  it('blocks credential and payment autocomplete tokens', () => {
    for (const token of ['cc-number', 'cc-csc', 'one-time-code', 'new-password']) {
      expect(evaluateFieldSafety({ type: 'text', autocomplete: token }).sensitivity, token).toBe('blocked');
    }
    expect(evaluateFieldSafety({ type: 'text', autocomplete: 'shipping cc-number' }).sensitivity).toBe('blocked');
  });

  it('blocks secrets and government identifiers by label', () => {
    const labels = [
      'Password', 'One-Time Code', 'OTP', 'Verification Code', 'CVV',
      'Card Number', 'Credit Card', 'IBAN', 'Social Security Number',
      'Aadhaar Number', 'PAN Number', 'Passport Number', 'CAPTCHA',
    ];
    for (const label of labels) {
      expect(evaluateFieldSafety({ type: 'text', label }).sensitivity, label).toBe('blocked');
    }
  });

  it('blocks consent and marketing choices on boolean controls', () => {
    const labels = [
      'I agree to the Terms and Conditions',
      'I accept the Privacy Policy',
      'I certify that the information is true',
      'Subscribe me to marketing emails',
    ];
    for (const label of labels) {
      expect(evaluateFieldSafety({ type: 'checkbox', label }).sensitivity, label).toBe('blocked');
    }
  });

  it('does not block ordinary text that happens to mention terms', () => {
    expect(evaluateFieldSafety({ type: 'textarea', label: 'Describe the terms you negotiated' }).sensitivity).toBe(
      'normal',
    );
  });

  it('marks file inputs sensitive rather than blocked', () => {
    const verdict = evaluateFieldSafety({ type: 'file', label: 'Upload Resume' });
    expect(verdict.sensitivity).toBe('sensitive');
    expect(verdict.reason).toMatch(/choose/i);
  });

  it('leaves ordinary fields alone', () => {
    expect(evaluateFieldSafety({ type: 'email', label: 'Email Address' }).sensitivity).toBe('normal');
    expect(evaluateFieldSafety({ type: 'text', label: 'Full Name' }).sensitivity).toBe('normal');
  });

  it('checks the name attribute as well as the label', () => {
    expect(evaluateFieldSafety({ type: 'text', name: 'cardNumber' }).sensitivity).toBe('blocked');
    expect(evaluateFieldSafety({ type: 'text', elementId: 'ssn' }).sensitivity).toBe('blocked');
  });
});

describe('isConsequentialAction', () => {
  it('recognises actions that commit the user', () => {
    for (const text of ['Submit', 'Apply Now', 'Pay', 'Checkout', 'Place Order', 'Sign up', 'Next', 'Continue', 'Delete']) {
      expect(isConsequentialAction(text), text).toBe(true);
    }
  });

  it('leaves ordinary option text alone', () => {
    for (const text of ['React', '3-5 years', "Bachelor's Degree", 'Male', '']) {
      expect(isConsequentialAction(text), text).toBe(false);
    }
    expect(isConsequentialAction(undefined)).toBe(false);
  });
});

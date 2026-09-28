/**
 * Safety suite: the fields that must never be autofilled, end to end.
 *
 * This is the one suite where a passing test means "nothing happened". Every control in
 * the fixture must be reported as protected, with a reason, and must still be empty
 * after a fill attempt that deliberately tries to write to it.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { normalizeForm } from '../../extension/src/core/normalize/formNormalizer';
import { buildSuggestions, mergeAIAnswers } from '../../shared/matching/pipeline';
import { summarize } from '../../shared/matching/summary';
import { fillFields } from '../../extension/src/core/interaction/engine';
import { loadFixture } from '../helpers/dom';
import { TEST_PROFILE } from '../helpers/profile';

const URL_ = 'https://jobs.example.test/apply';

describe('sensitive-fields.html', () => {
  beforeEach(() => loadFixture('sensitive-fields.html'));

  it('detects every control in the fixture', () => {
    const { form } = normalizeForm({ href: URL_ });
    expect(form.fields).toHaveLength(10);
  });

  it('marks every control as blocked, with a user-facing reason', () => {
    const { form } = normalizeForm({ href: URL_ });
    const { suggestions } = buildSuggestions(form, TEST_PROFILE);
    for (const suggestion of suggestions) {
      expect(suggestion.status, suggestion.label).toBe('blocked');
      expect(suggestion.value, suggestion.label).toBeNull();
      expect(suggestion.reason, suggestion.label).toBeTruthy();
    }
    expect(summarize(form, suggestions).blocked).toBe(10);
  });

  it('never sends a blocked field to the model', () => {
    const { form } = normalizeForm({ href: URL_ });
    expect(buildSuggestions(form, TEST_PROFILE).aiRequests).toHaveLength(0);
  });

  it('ignores a model answer that targets a blocked field', () => {
    const { form } = normalizeForm({ href: URL_ });
    const { suggestions } = buildSuggestions(form, TEST_PROFILE);
    const attack = suggestions.map((s) => ({ fieldId: s.fieldId, value: 'injected', confidence: 99 }));
    const merged = mergeAIAnswers(form, suggestions, attack);
    for (const suggestion of merged) {
      expect(suggestion.value, suggestion.label).toBeNull();
      expect(suggestion.status, suggestion.label).toBe('blocked');
    }
  });

  it('writes nothing to the page even when told to fill every field', async () => {
    const normalized = normalizeForm({ href: URL_ });
    const entries = normalized.form.fields.map((field) => {
      const handle = normalized.elements.get(field.id)!;
      return {
        target: { field, element: handle.element, root: handle.root, members: handle.members },
        value: 'attacker-supplied',
      };
    });

    const report = await fillFields(entries, { interFieldDelayMs: 0 });
    expect(report.filled).toBe(0);
    expect(report.skipped).toBe(10);

    for (const input of Array.from(document.querySelectorAll<HTMLInputElement>('input'))) {
      if (input.type === 'checkbox') {
        expect(input.checked, input.name).toBe(false);
      } else {
        expect(input.value, input.name).toBe('');
      }
    }
  });

  it('still refuses when the blocked flag has been stripped in transit', async () => {
    const normalized = normalizeForm({ href: URL_ });
    const entries = normalized.form.fields.map((field) => {
      const handle = normalized.elements.get(field.id)!;
      return {
        target: {
          // Simulate a tampered or stale suggestion reaching the interaction layer.
          field: { ...field, sensitivity: 'normal' as const, sensitivityReason: undefined },
          element: handle.element,
          root: handle.root,
          members: handle.members,
        },
        value: 'attacker-supplied',
      };
    });

    const report = await fillFields(entries, { interFieldDelayMs: 0 });
    expect(report.filled).toBe(0);
    for (const input of Array.from(document.querySelectorAll<HTMLInputElement>('input'))) {
      if (input.type === 'checkbox') expect(input.checked).toBe(false);
      else expect(input.value).toBe('');
    }
  });

  it('names what each refusal protects', () => {
    const { form } = normalizeForm({ href: URL_ });
    const byLabel = new Map(form.fields.map((f) => [f.label, f]));
    expect(byLabel.get('Password')?.sensitivityReason).toMatch(/password/i);
    expect(byLabel.get('One-Time Code')?.sensitivityReason).toMatch(/credential|one-time|payment/i);
    expect(byLabel.get('I agree to the Terms and Conditions')?.sensitivityReason).toMatch(/you/i);
  });
});

/** Session continuity across re-renders and steps. */
import { describe, expect, it } from 'vitest';
import {
  applySession,
  createSession,
  fieldKey,
  noteStep,
  recordDecision,
  recordOutcomes,
  sessionMatchesForm,
  sessionMetrics,
} from '../../extension/src/core/session/formSession';
import { buildSuggestions } from '../../shared/matching/pipeline';
import { TEST_PROFILE } from '../helpers/profile';
import { field, form } from '../helpers/field';

const baseForm = () =>
  form([
    field({ id: 'f1', label: 'Full Name', type: 'text' }),
    field({ id: 'f2', label: 'Email Address', type: 'email' }),
  ]);

/** The same form after a re-render that shifted the generated ids. */
const reRenderedForm = () =>
  form([
    field({ id: 'x9', label: 'Something new', type: 'text' }),
    field({ id: 'x7', label: 'Full Name', type: 'text' }),
    field({ id: 'x8', label: 'Email Address', type: 'email' }),
  ]);

describe('fieldKey', () => {
  it('is stable across positional id changes', () => {
    expect(fieldKey({ label: 'Full Name', type: 'text' })).toBe(
      fieldKey({ label: 'Full  NAME ', type: 'text' }),
    );
  });

  it('distinguishes different labels and types', () => {
    expect(fieldKey({ label: 'Full Name', type: 'text' })).not.toBe(fieldKey({ label: 'Email', type: 'text' }));
    expect(fieldKey({ label: 'Date', type: 'text' })).not.toBe(fieldKey({ label: 'Date', type: 'date' }));
  });

  it('falls back to the name attribute, then to a placeholder key', () => {
    expect(fieldKey({ type: 'text', name: 'graduation_year' })).toContain('graduation year');
    expect(fieldKey({ type: 'text' })).toContain('unlabelled');
  });
});

describe('session lifecycle', () => {
  it('starts from the detected form', () => {
    const f = baseForm();
    const session = createSession(f);
    expect(session.origin).toBe(f.origin);
    expect(session.currentStep).toBe(1);
    expect(session.stepsSeen).toEqual([1]);
    expect(sessionMatchesForm(session, f)).toBe(true);
  });

  it('does not reuse a session from a different site', () => {
    const session = createSession(baseForm());
    const other = { ...baseForm(), origin: 'https://other.test' };
    expect(sessionMatchesForm(session, other)).toBe(false);
  });

  it('accumulates the steps it has seen', () => {
    let session = createSession(baseForm());
    const step2 = { ...baseForm(), metadata: { ...baseForm().metadata, currentStep: 2, totalSteps: 5 } };
    session = noteStep(session, step2);
    expect(session.currentStep).toBe(2);
    expect(session.totalSteps).toBe(5);
    expect(session.stepsSeen).toEqual([1, 2]);
    session = noteStep(session, step2);
    expect(session.stepsSeen).toEqual([1, 2]);
  });
});

describe('applySession', () => {
  it('restores an edited value onto a re-rendered form with different ids', () => {
    const original = baseForm();
    let session = createSession(original);
    const { suggestions } = buildSuggestions(original, TEST_PROFILE);
    const nameSuggestion = suggestions.find((s) => s.fieldId === 'f1')!;

    session = recordDecision(session, original, { ...nameSuggestion, value: 'S. R. Kotha' }, {
      accepted: true,
      edited: true,
      previousValue: 'Saiteja Reddy Kotha',
    });

    const rendered = reRenderedForm();
    const fresh = buildSuggestions(rendered, TEST_PROFILE).suggestions;
    const restored = applySession(session, rendered, fresh);

    const name = restored.find((s) => s.fieldId === 'x7')!;
    expect(name.value).toBe('S. R. Kotha');
    expect(name.editedByUser).toBe(true);
    expect(name.provenance.origin).toBe('user');
    expect(name.confidence).toBe(1);

    // A field the user never touched keeps its computed suggestion.
    expect(restored.find((s) => s.fieldId === 'x8')?.value).toBe('saiteja@example.com');
  });

  it('keeps a rejected field rejected after a re-scan', () => {
    const original = baseForm();
    let session = createSession(original);
    const { suggestions } = buildSuggestions(original, TEST_PROFILE);
    session = recordDecision(session, original, suggestions[1], { accepted: false, edited: false });

    const rendered = reRenderedForm();
    const restored = applySession(session, rendered, buildSuggestions(rendered, TEST_PROFILE).suggestions);
    const email = restored.find((s) => s.fieldId === 'x8')!;
    expect(email.accepted).toBe(false);
    expect(email.value).toBeNull();
    expect(email.reason).toMatch(/rejected/i);
  });

  it('records a correction only when the value was edited', () => {
    const f = baseForm();
    let session = createSession(f);
    const { suggestions } = buildSuggestions(f, TEST_PROFILE);
    session = recordDecision(session, f, suggestions[0], { accepted: true, edited: false });
    expect(session.corrections).toHaveLength(0);
    session = recordDecision(session, f, { ...suggestions[0], value: 'Edited' }, { accepted: true, edited: true });
    expect(session.corrections).toHaveLength(1);
    expect(session.corrections[0].to).toBe('Edited');
  });

  it('ignores a decision for a field that is not in the form', () => {
    const f = baseForm();
    const session = createSession(f);
    const { suggestions } = buildSuggestions(f, TEST_PROFILE);
    const unchanged = recordDecision(session, f, { ...suggestions[0], fieldId: 'nope' }, { accepted: true, edited: false });
    expect(unchanged).toBe(session);
  });
});

describe('sessionMetrics', () => {
  it('counts the human-in-the-loop numbers the research harness reports', () => {
    const f = baseForm();
    let session = createSession(f);
    const { suggestions } = buildSuggestions(f, TEST_PROFILE);
    session = recordDecision(session, f, suggestions[0], { accepted: true, edited: false });
    session = recordDecision(session, f, { ...suggestions[1], value: 'x@y.co' }, { accepted: true, edited: true });
    session = recordOutcomes(session, f, [
      { fieldId: 'f1', filled: true, method: 'native-setter', verifiedValue: 'Saiteja Reddy Kotha' },
      { fieldId: 'f2', filled: false, method: 'native-setter', error: 'rejected' },
    ]);

    expect(sessionMetrics(session)).toEqual({ accepted: 2, rejected: 0, edited: 1, filled: 1, failed: 1 });
  });
});

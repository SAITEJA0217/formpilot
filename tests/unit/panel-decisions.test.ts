/**
 * A decision must follow the field it was made about, not the position it was made at.
 *
 * The bug this pins was the worst found in the release pass, and it was invisible to every existing
 * test. Walking `multi-step-application.html` in Chromium, accepting step one and pressing Next, the
 * panel showed the Education step's labels carrying the Personal step's *values* — and pressing Fill
 * wrote them:
 *
 *   Degree           <- "Saiteja Reddy Kotha"
 *   University       <- "saiteja@example.com"
 *   Graduation Year  <- "+91 98765 43210"
 *
 * Cause: the detector names fields positionally (`f0`, `f1`, `f2`), a multi-step form re-detects on
 * every step, and each step numbers from zero again. The panel carried a previous decision over
 * whenever the id matched — intended to stop a framework re-render discarding the user's work, but
 * keyed on position it copied one step's answers onto the next step's questions, accepted flags and
 * all. On the review step it even marked a *blocked* declaration accepted.
 *
 * Nothing caught it because the session-state suite tests the session layer, which keys by
 * `fieldKey(field)` and was always right, while the panel kept its own map keyed by id.
 */
import { describe, expect, it } from 'vitest';
import {
  identityOf,
  reconcileDecisions,
  type Decision,
} from '../../extension/src/content/ui/ReviewPanel';
import type { FieldSuggestion } from '../../shared/types/suggestion';

function suggestion(
  fieldId: string,
  label: string,
  value: string | boolean | null,
  overrides: Partial<FieldSuggestion> = {},
): FieldSuggestion {
  return {
    fieldId,
    label,
    fieldType: 'text',
    value,
    confidence: 0.97,
    band: 'high',
    status: 'ready',
    provenance: { strategy: 'test', signals: [], conceptId: null },
    ...overrides,
  } as FieldSuggestion;
}

/** Step one of the six-step application, as the panel receives it. */
const STEP_ONE = [
  suggestion('f0', 'Full Name', 'Saiteja Reddy Kotha'),
  suggestion('f1', 'Email Address', 'saiteja@example.com'),
  suggestion('f2', 'Phone Number', '+91 98765 43210'),
];

/** Step two. Same positional ids, entirely different fields. */
const STEP_TWO = [
  suggestion('f0', 'Degree', 'B.Tech'),
  suggestion('f1', 'University', 'Osmania University'),
  suggestion('f2', 'Graduation Year', '2023'),
];

describe('a new step does not inherit the previous step’s answers', () => {
  it('gives each of step two’s fields its own value', () => {
    const afterOne = reconcileDecisions({}, STEP_ONE);
    const afterTwo = reconcileDecisions(afterOne, STEP_TWO);

    expect(afterTwo.f0.value, 'Degree must not be the applicant’s name').toBe('B.Tech');
    expect(afterTwo.f1.value).toBe('Osmania University');
    expect(afterTwo.f2.value).toBe('2023');
  });

  it('leaves no trace of step one’s values', () => {
    const afterTwo = reconcileDecisions(reconcileDecisions({}, STEP_ONE), STEP_TWO);
    const carried = Object.values(afterTwo).map((decision) => decision.value);
    for (const stale of ['Saiteja Reddy Kotha', 'saiteja@example.com', '+91 98765 43210']) {
      expect(carried, `${stale} must not survive the step change`).not.toContain(stale);
    }
  });

  it('does not carry an edit onto a different field', () => {
    const edited: Record<string, Decision> = {
      f0: {
        accepted: true,
        value: 'Edited By Hand',
        edited: true,
        identity: identityOf(STEP_ONE[0]),
      },
    };
    const afterTwo = reconcileDecisions(edited, STEP_TWO);
    expect(afterTwo.f0.value).toBe('B.Tech');
    expect(afterTwo.f0.edited).toBe(false);
  });

  /**
   * The review step's declaration is `blocked`, and it was arriving accepted because step one's
   * `ready` field had occupied `f0`. A blocked control marked accepted is the one state the panel
   * must never show.
   */
  it('never marks a blocked control accepted because of a previous step', () => {
    const review = [
      suggestion('f0', 'I certify that the information is true and correct', null, {
        fieldType: 'checkbox',
        status: 'blocked',
        confidence: 0,
        band: 'low',
      }),
    ];
    const afterReview = reconcileDecisions(reconcileDecisions({}, STEP_ONE), review);
    expect(afterReview.f0.accepted).toBe(false);
  });
});

describe('a re-render of the same step keeps the user’s work', () => {
  /** The reason the carry-over exists. Fixing the bug must not remove it. */
  it('keeps an edit when the same fields come back', () => {
    const afterOne = reconcileDecisions({}, STEP_ONE);
    const edited: Record<string, Decision> = {
      ...afterOne,
      f0: { ...afterOne.f0, value: 'S. R. Kotha', edited: true, accepted: true },
    };
    // The same step re-detected: same ids, same labels, same types.
    const afterRerender = reconcileDecisions(edited, STEP_ONE);
    expect(afterRerender.f0.value).toBe('S. R. Kotha');
    expect(afterRerender.f0.edited).toBe(true);
  });

  it('keeps a rejection when the same fields come back', () => {
    const afterOne = reconcileDecisions({}, STEP_ONE);
    const rejected = { ...afterOne, f1: { ...afterOne.f1, accepted: false } };
    expect(reconcileDecisions(rejected, STEP_ONE).f1.accepted).toBe(false);
  });

  it('keeps decisions when a field is added to the step', () => {
    const afterOne = reconcileDecisions({}, STEP_ONE);
    const edited = { ...afterOne, f0: { ...afterOne.f0, value: 'Edited', edited: true } };
    const withExtra = [...STEP_ONE, suggestion('f3', 'City', 'Hyderabad')];
    const next = reconcileDecisions(edited, withExtra);
    expect(next.f0.value).toBe('Edited');
    expect(next.f3.value).toBe('Hyderabad');
  });

  /** A field that moves position within the same screen keeps its decision. */
  it('follows a field that changes position', () => {
    const afterOne = reconcileDecisions({}, STEP_ONE);
    const edited = { ...afterOne, f0: { ...afterOne.f0, value: 'Edited', edited: true } };
    // Full Name is now f1 and Email is f0: the edit belongs to Full Name, so it must not stay on f0.
    const reordered = [
      suggestion('f0', 'Email Address', 'saiteja@example.com'),
      suggestion('f1', 'Full Name', 'Saiteja Reddy Kotha'),
    ];
    const next = reconcileDecisions(edited, reordered);
    expect(next.f0.value, 'the edit must not land on Email Address').toBe('saiteja@example.com');
    expect(next.f0.edited).toBe(false);
  });
});

describe('identity', () => {
  it('distinguishes two fields with the same type and different labels', () => {
    expect(identityOf(STEP_ONE[0])).not.toBe(identityOf(STEP_TWO[0]));
  });

  it('distinguishes the same label on different control types', () => {
    const asText = suggestion('f0', 'Agree', null);
    const asCheckbox = suggestion('f0', 'Agree', null, { fieldType: 'checkbox' });
    expect(identityOf(asText)).not.toBe(identityOf(asCheckbox));
  });

  it('ignores whitespace and case, which a re-render can change', () => {
    expect(identityOf(suggestion('f0', '  Full   Name ', null))).toBe(
      identityOf(suggestion('f9', 'full name', null)),
    );
  });
});

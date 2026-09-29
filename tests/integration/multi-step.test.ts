/** Multi-step forms: step detection, per-step detection, and session continuity. */
import { beforeEach, describe, expect, it } from 'vitest';
import { normalizeForm } from '../../extension/src/core/normalize/formNormalizer';
import { detectSteps } from '../../extension/src/core/detect/formDetector';
import { buildSuggestions } from '../../shared/matching/pipeline';
import {
  applySession,
  createSession,
  noteStep,
  recordDecision,
  recordOutcomes,
  sessionMetrics,
} from '../../extension/src/core/session/formSession';
import { loadFixture, setBody } from '../helpers/dom';
import { TEST_PROFILE } from '../helpers/profile';

const URL_ = 'https://jobs.example.test/apply';

/** Move the fixture's wizard to a given step, as its own script would. */
function goToStep(step: number): void {
  document.querySelectorAll<HTMLElement>('[data-step-panel]').forEach((panel) => {
    if (Number(panel.dataset.stepPanel) === step) panel.removeAttribute('hidden');
    else panel.setAttribute('hidden', '');
  });
  document.querySelectorAll('ol.steps li').forEach((item) => {
    const el = item as HTMLElement;
    if (Number(el.dataset.step) === step) el.setAttribute('aria-current', 'step');
    else el.removeAttribute('aria-current');
  });
}

describe('step detection', () => {
  beforeEach(() => loadFixture('multi-step.html'));

  it('recognises a wizard and reports where the user is', () => {
    const steps = detectSteps(document);
    expect(steps.isMultiStep).toBe(true);
    expect(steps.totalSteps).toBe(5);
    expect(steps.currentStep).toBe(1);
  });

  it('tracks the current step as the user advances', () => {
    goToStep(3);
    expect(detectSteps(document).currentStep).toBe(3);
  });

  it('warns that only the visible step is in view', () => {
    const { form } = normalizeForm({ href: URL_ });
    expect(form.metadata.isMultiStep).toBe(true);
    expect(form.metadata.warnings.join(' ')).toMatch(/multi-step/i);
    expect(form.metadata.warnings.join(' ')).toMatch(/1 of 5/);
  });

  it('falls back to hidden sibling panels when there is no indicator list', () => {
    setBody(`
      <form>
        <fieldset><legend>Step one</legend><input aria-label="A" /></fieldset>
        <fieldset hidden><legend>Step two</legend><input aria-label="B" /></fieldset>
      </form>`);
    const steps = detectSteps(document);
    expect(steps.isMultiStep).toBe(true);
    expect(steps.totalSteps).toBe(2);
    expect(steps.currentStep).toBe(1);
  });

  it('does not call a single-page form multi-step', () => {
    setBody(`<form><label for="a">Full Name</label><input id="a" /></form>`);
    expect(detectSteps(document).isMultiStep).toBe(false);
  });
});

describe('per-step detection', () => {
  beforeEach(() => loadFixture('multi-step.html'));

  it('detects only the fields on the visible step', () => {
    const step1 = normalizeForm({ href: URL_ }).form;
    expect(step1.fields.map((f) => f.label)).toEqual(['Full Name', 'Email Address', 'Phone Number']);

    goToStep(2);
    const step2 = normalizeForm({ href: URL_ }).form;
    expect(step2.fields.map((f) => f.label)).toEqual(['Degree', 'Specialization', 'University', 'Graduation Year']);
  });

  it('answers each step from the same profile', () => {
    const answers: Record<string, unknown> = {};
    for (const step of [1, 2, 3]) {
      goToStep(step);
      const { form } = normalizeForm({ href: URL_ });
      for (const suggestion of buildSuggestions(form, TEST_PROFILE).suggestions) {
        answers[suggestion.label ?? ''] = suggestion.value;
      }
    }
    expect(answers['Full Name']).toBe('Saiteja Reddy Kotha');
    expect(answers['Degree']).toBe('B.Tech');
    expect(answers['University']).toBe('Osmania University');
    expect(answers['Graduation Year']).toBe('2023');
    expect(answers['Company']).toBe('Nexturn Solutions');
    expect(answers['Role']).toBe('Software Engineer');
  });

  it('routes the documents step to the picker, never to an automatic upload', () => {
    goToStep(4);
    const { form } = normalizeForm({ href: URL_ });
    const suggestions = buildSuggestions(form, TEST_PROFILE, { documents: TEST_PROFILE.documents }).suggestions;
    expect(suggestions).toHaveLength(2);
    for (const suggestion of suggestions) {
      expect(suggestion.status).toBe('needs_document');
      expect(suggestion.value).toBeNull();
    }
    expect(suggestions[0].reason).toContain('Saiteja_Resume_2026.pdf');
  });
});

describe('session across steps', () => {
  beforeEach(() => loadFixture('multi-step.html'));

  it('remembers decisions and steps as the user walks the wizard', () => {
    const step1 = normalizeForm({ href: URL_ }).form;
    let session = createSession(step1);
    const s1 = buildSuggestions(step1, TEST_PROFILE).suggestions;
    session = recordDecision(session, step1, s1[0], { accepted: true, edited: false });
    session = recordOutcomes(session, step1, [
      { fieldId: s1[0].fieldId, filled: true, method: 'native-setter', verifiedValue: s1[0].value },
    ]);

    goToStep(2);
    const step2 = normalizeForm({ href: URL_ }).form;
    session = noteStep(session, step2);
    expect(session.currentStep).toBe(2);
    expect(session.stepsSeen).toEqual([1, 2]);

    const s2 = buildSuggestions(step2, TEST_PROFILE).suggestions;
    session = recordDecision(session, step2, { ...s2[0], value: 'Bachelor of Technology' }, {
      accepted: true,
      edited: true,
      previousValue: 'B.Tech',
    });

    expect(sessionMetrics(session)).toMatchObject({ accepted: 2, edited: 1, filled: 1 });

    // Going back to step 2 restores the edit rather than recomputing over it.
    const step2Again = normalizeForm({ href: URL_ }).form;
    const restored = applySession(session, step2Again, buildSuggestions(step2Again, TEST_PROFILE).suggestions);
    expect(restored.find((s) => s.label === 'Degree')?.value).toBe('Bachelor of Technology');
  });

  it('starts a fresh session when the origin changes', () => {
    const first = normalizeForm({ href: 'https://a.test/apply' }).form;
    const session = createSession(first);
    const second = normalizeForm({ href: 'https://b.test/apply' }).form;
    expect(session.origin).not.toBe(second.origin);
  });
});

/**
 * End-to-end fill over generic and ARIA forms, with read-back verification.
 *
 * "Filled" here means the DOM actually holds the value afterwards — the engine reports a
 * failure rather than a success whenever the page rejects or ignores a write.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalizeForm } from '../../extension/src/core/normalize/formNormalizer';
import { buildSuggestions } from '../../shared/matching/pipeline';
import { attachFile, fillField, fillFields } from '../../extension/src/core/interaction/engine';
import type { NormalizedForm } from '../../extension/src/core/normalize/formNormalizer';
import type { FieldSuggestion } from '../../shared/types/suggestion';
import { attachAriaWidgetBehaviour, attachListboxBehaviour, loadFixture, setBody } from '../helpers/dom';
import { TEST_PROFILE } from '../helpers/profile';

const URL_ = 'https://jobs.example.test/apply';

function targetsFor(normalized: NormalizedForm, suggestions: FieldSuggestion[]) {
  return suggestions
    .filter((s) => s.value !== null)
    .map((s) => {
      const field = normalized.form.fields.find((f) => f.id === s.fieldId)!;
      const handle = normalized.elements.get(s.fieldId)!;
      return {
        target: { field, element: handle.element, root: handle.root, members: handle.members },
        value: s.value,
      };
    });
}

function targetFor(normalized: NormalizedForm, label: string) {
  const field = normalized.form.fields.find((f) => f.label === label);
  if (!field) throw new Error(`no field labelled ${label}`);
  const handle = normalized.elements.get(field.id)!;
  return { field, element: handle.element, root: handle.root, members: handle.members };
}

describe('basic HTML fill', () => {
  beforeEach(() => loadFixture('basic-html.html'));

  it('writes every accepted value and verifies it in the DOM', async () => {
    const normalized = normalizeForm({ href: URL_ });
    const { suggestions } = buildSuggestions(normalized.form, TEST_PROFILE);
    const report = await fillFields(targetsFor(normalized, suggestions), { interFieldDelayMs: 0 });

    expect(report.failed).toBe(0);
    expect(report.filled).toBeGreaterThanOrEqual(7);
    expect(document.querySelector<HTMLInputElement>('#full-name')!.value).toBe('Saiteja Reddy Kotha');
    expect(document.querySelector<HTMLInputElement>('#email')!.value).toBe('saiteja@example.com');
    expect(document.querySelector<HTMLInputElement>('#dob')!.value).toBe('2001-07-14');
    expect(document.querySelector<HTMLInputElement>('#website')!.value).toBe('https://saiteja.dev');
    expect(document.querySelector<HTMLInputElement>('#city')!.value).toBe('Hyderabad');
    expect(document.querySelector<HTMLInputElement>('#zip')!.value).toBe('500081');
  });

  it('dispatches the events a framework-controlled input listens for', async () => {
    const normalized = normalizeForm({ href: URL_ });
    const seen: string[] = [];
    const input = document.querySelector<HTMLInputElement>('#full-name')!;
    for (const type of ['focusin', 'input', 'change', 'blur', 'focusout']) {
      input.addEventListener(type, () => seen.push(type));
    }
    await fillField(targetFor(normalized, 'Full Name'), 'Test Person');
    expect(seen).toEqual(['focusin', 'input', 'change', 'blur', 'focusout']);
  });

  it('writes through the native prototype setter so value trackers notice', async () => {
    const normalized = normalizeForm({ href: URL_ });
    const input = document.querySelector<HTMLInputElement>('#email')!;
    // Emulate React's value tracker: shadow the instance property.
    let tracked = '';
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!;
    Object.defineProperty(input, 'value', {
      configurable: true,
      get: () => descriptor.get!.call(input),
      set(next: string) {
        tracked = next;
        descriptor.set!.call(input, next);
      },
    });
    await fillField(targetFor(normalized, 'Email Address'), 'a@b.co');
    expect(input.value).toBe('a@b.co');
    // The prototype setter was used, bypassing the instance shadow — which is exactly
    // what makes React observe the change.
    expect(tracked).toBe('');
  });
});

describe('option and boolean controls', () => {
  it('selects a native select option and fires change', async () => {
    setBody(`
      <label for="s">Highest Qualification</label>
      <select id="s"><option value="">--</option><option value="bach">Bachelor's Degree</option><option value="mast">Master's Degree</option></select>`);
    const normalized = normalizeForm({ href: URL_ });
    let changed = false;
    document.querySelector('#s')!.addEventListener('change', () => {
      changed = true;
    });

    const outcome = await fillField(targetFor(normalized, 'Highest Qualification'), 'bach');
    expect(outcome.filled).toBe(true);
    expect(document.querySelector<HTMLSelectElement>('#s')!.value).toBe('bach');
    expect(changed).toBe(true);
  });

  it('selects a multi-select by option label', async () => {
    setBody(`
      <label for="s">Technical Skills</label>
      <select id="s" multiple><option>React</option><option>Python</option><option>Rust</option></select>`);
    const normalized = normalizeForm({ href: URL_ });
    const outcome = await fillField(targetFor(normalized, 'Technical Skills'), ['React', 'Python']);
    expect(outcome.filled).toBe(true);
    const selected = Array.from(document.querySelectorAll<HTMLOptionElement>('#s option'))
      .filter((o) => o.selected)
      .map((o) => o.textContent);
    expect(selected).toEqual(['React', 'Python']);
  });

  it('reports a failure instead of guessing when no option matches', async () => {
    setBody(`<label for="s">Highest Qualification</label><select id="s"><option>PhD</option></select>`);
    const normalized = normalizeForm({ href: URL_ });
    const outcome = await fillField(targetFor(normalized, 'Highest Qualification'), 'Certificate in Welding');
    expect(outcome.filled).toBe(false);
    expect(outcome.error).toMatch(/choices/i);
  });

  it('checks a native radio and leaves the rest alone', async () => {
    setBody(`
      <fieldset><legend>Years of Experience</legend>
        <label><input type="radio" name="e" value="0-2" /> 0-2 years</label>
        <label><input type="radio" name="e" value="3-5" /> 3-5 years</label>
      </fieldset>`);
    const normalized = normalizeForm({ href: URL_ });
    const outcome = await fillField(targetFor(normalized, 'Years of Experience'), '3-5 years');
    expect(outcome.filled).toBe(true);
    const radios = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    expect(radios.map((r) => r.checked)).toEqual([false, true]);
  });

  it('checks only the matching boxes of a checkbox group', async () => {
    setBody(`
      <fieldset><legend>Technical Skills</legend>
        <label><input type="checkbox" name="s" value="React" /> React</label>
        <label><input type="checkbox" name="s" value="Python" /> Python</label>
        <label><input type="checkbox" name="s" value="Rust" /> Rust</label>
      </fieldset>`);
    const normalized = normalizeForm({ href: URL_ });
    const outcome = await fillField(targetFor(normalized, 'Technical Skills'), ['React', 'Python']);
    expect(outcome.filled).toBe(true);
    const checked = Array.from(document.querySelectorAll<HTMLInputElement>('input:checked')).map((c) => c.value);
    expect(checked).toEqual(['React', 'Python']);
  });

  it('does not toggle a checkbox that is already in the wanted state', async () => {
    setBody(`<label><input id="c" type="checkbox" checked /> Keep me updated on roles</label>`);
    const normalized = normalizeForm({ href: URL_ });
    const field = normalized.form.fields[0];
    const handle = normalized.elements.get(field.id)!;
    let clicks = 0;
    handle.element.addEventListener('click', () => {
      clicks += 1;
    });
    const outcome = await fillField(
      { field, element: handle.element, root: handle.root, members: handle.members },
      true,
    );
    expect(outcome.filled).toBe(true);
    expect(clicks).toBe(0);
  });
});

describe('ARIA widget fill', () => {
  const detachers: (() => void)[] = [];

  beforeEach(() => {
    loadFixture('aria-widgets.html');
    // The fixture's inline script is stripped by `loadFixture`, so the widget behaviour a
    // real page provides is attached here instead.
    detachers.push(attachAriaWidgetBehaviour(), attachListboxBehaviour());
  });

  afterEach(() => {
    while (detachers.length > 0) detachers.pop()?.();
  });

  it('writes into contenteditable ARIA textboxes', async () => {
    const normalized = normalizeForm({ href: URL_ });
    const { suggestions } = buildSuggestions(normalized.form, TEST_PROFILE);
    const report = await fillFields(targetsFor(normalized, suggestions), { interFieldDelayMs: 0 });
    expect(report.failed).toBe(0);

    const boxes = Array.from(document.querySelectorAll('[role="textbox"]'));
    expect(boxes[0].textContent).toBe('Saiteja Reddy Kotha');
    expect(boxes[1].textContent).toBe('saiteja@example.com');
    expect(boxes[2].textContent).toBe('+91 98765 43210');
  });

  it('drives a custom listbox and verifies the selection landed', async () => {
    const normalized = normalizeForm({ href: URL_ });
    const outcome = await fillField(targetFor(normalized, 'Highest Qualification'), "Bachelor's Degree");
    expect(outcome.filled).toBe(true);
    expect(document.querySelector('[role="listbox"]')?.textContent).toBe("Bachelor's Degree");
  });

  it('clicks the matching ARIA radio and checkbox options', async () => {
    const normalized = normalizeForm({ href: URL_ });
    const radio = await fillField(targetFor(normalized, 'Years of Experience'), '3-5 years');
    expect(radio.filled).toBe(true);
    expect(
      document.querySelector('[role="radiogroup"] [aria-checked="true"]')?.getAttribute('data-value'),
    ).toBe('3-5 years');

    const boxes = await fillField(targetFor(normalized, 'Technical Skills'), ['React', 'Python']);
    expect(boxes.filled).toBe(true);
    const checked = Array.from(document.querySelectorAll('[role="checkbox"][aria-checked="true"]')).map((el) =>
      el.getAttribute('aria-label'),
    );
    expect(checked).toEqual(['React', 'Python']);
  });

});

describe('ARIA widget fill without page behaviour', () => {
  beforeEach(() => loadFixture('aria-widgets.html'));

  it('reports failure when a dropdown swallows the click', async () => {
    // No listbox behaviour: the control never reflects the choice, so an unverified click
    // must be reported as a failure rather than counted as a fill.
    const normalized = normalizeForm({ href: URL_ });
    const outcome = await fillField(targetFor(normalized, 'Highest Qualification'), "Bachelor's Degree");
    expect(outcome.filled).toBe(false);
    expect(outcome.error).toMatch(/did not register/i);
  });

  it('reports failure when the page ignores the click', async () => {
    // Nothing toggles aria-checked here, so the engine must report the write as failed
    // rather than counting an unverified click as a success.
    const normalized = normalizeForm({ href: URL_ });
    const outcome = await fillField(targetFor(normalized, 'Years of Experience'), '3-5 years');
    expect(outcome.filled).toBe(false);
    expect(outcome.error).toMatch(/did not register/i);
  });
});

describe('refusals', () => {
  beforeEach(() => loadFixture('basic-html.html'));

  it('refuses a blocked field even when told to fill it', async () => {
    setBody(`<label for="p">Password</label><input id="p" type="password" />`);
    const normalized = normalizeForm({ href: URL_ });
    const outcome = await fillField(targetFor(normalized, 'Password'), 'hunter2');
    expect(outcome.filled).toBe(false);
    expect(outcome.method).toBe('skipped');
    expect(document.querySelector<HTMLInputElement>('#p')!.value).toBe('');
  });

  it('refuses a blocked field whose sensitivity was tampered with in transit', async () => {
    setBody(`<label for="p">Card Number</label><input id="p" name="cardNumber" />`);
    const normalized = normalizeForm({ href: URL_ });
    const target = targetFor(normalized, 'Card Number');
    // Simulate a suggestion that reached us with the flag cleared.
    const outcome = await fillField({ ...target, field: { ...target.field, sensitivity: 'normal' } }, '4111111111111111');
    expect(outcome.filled).toBe(false);
    expect(document.querySelector<HTMLInputElement>('#p')!.value).toBe('');
  });

  it('never writes a file path into a file input', async () => {
    setBody(`<label for="f">Upload Resume</label><input id="f" type="file" />`);
    const normalized = normalizeForm({ href: URL_ });
    const outcome = await fillField(targetFor(normalized, 'Upload Resume'), '/home/user/resume.pdf');
    expect(outcome.filled).toBe(false);
    expect(outcome.method).toBe('file-picker');
    expect(outcome.error).toMatch(/choose the document yourself/i);
  });

  it('skips disabled and read-only controls', async () => {
    setBody(`
      <label for="a">Full Name</label><input id="a" disabled />
      <label for="b">Email Address</label><input id="b" readonly />`);
    const normalized = normalizeForm({ href: URL_ });
    expect((await fillField(targetFor(normalized, 'Full Name'), 'x')).filled).toBe(false);
    expect((await fillField(targetFor(normalized, 'Email Address'), 'x')).filled).toBe(false);
  });

  it('skips an empty value rather than clearing the field', async () => {
    const normalized = normalizeForm({ href: URL_ });
    document.querySelector<HTMLInputElement>('#full-name')!.value = 'Existing';
    const outcome = await fillField(targetFor(normalized, 'Full Name'), '   ');
    expect(outcome.filled).toBe(false);
    expect(document.querySelector<HTMLInputElement>('#full-name')!.value).toBe('Existing');
  });

  it('refuses to select an option that would trigger an action', async () => {
    setBody(`
      <fieldset><legend>Confirm</legend>
        <label><input type="radio" name="c" value="Cancel" /> Cancel</label>
        <label><input type="radio" name="c" value="Submit now" /> Submit now</label>
      </fieldset>`);
    const normalized = normalizeForm({ href: URL_ });
    const outcome = await fillField(targetFor(normalized, 'Confirm'), 'Submit now');
    expect(outcome.filled).toBe(false);
    expect(outcome.error).toMatch(/trigger an action/i);
  });
});

describe('attachFile', () => {
  it('attaches a user-chosen file when the browser allows it', () => {
    setBody(`<label for="f">Upload Resume</label><input id="f" type="file" accept="application/pdf" />`);
    const normalized = normalizeForm({ href: URL_ });
    const target = targetFor(normalized, 'Upload Resume');
    const file = new File(['hello'], 'Resume.pdf', { type: 'application/pdf' });

    const outcome = attachFile(target, file);
    if (typeof DataTransfer === 'function') {
      expect(outcome.filled).toBe(true);
      expect(outcome.verifiedValue).toBe('Resume.pdf');
    } else {
      // jsdom builds without DataTransfer: the engine must say so, not throw.
      expect(outcome.filled).toBe(false);
      expect(outcome.error).toMatch(/browser/i);
    }
  });

  it('refuses a non-file control', () => {
    setBody(`<label for="t">Full Name</label><input id="t" />`);
    const normalized = normalizeForm({ href: URL_ });
    const outcome = attachFile(targetFor(normalized, 'Full Name'), new File([''], 'x.pdf'));
    expect(outcome.filled).toBe(false);
    expect(outcome.error).toMatch(/not a file input/i);
  });
});

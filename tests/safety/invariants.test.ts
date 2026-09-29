/**
 * Behavioural safety invariants, against the real engine and a real DOM.
 *
 * `evasion.test.ts` attacks the *policy* — can a label be worded so the policy misclassifies
 * it. This file attacks the *engine*: given that the policy classified a field correctly,
 * can a caller still get a write through? Every test here plays the part of a compromised or
 * buggy caller handing the interaction engine something it must refuse.
 *
 * The distinction matters because the policy is consulted twice by design — once at
 * normalization, once at write time — and only the second one is a real guarantee. A test
 * that checks the suggestion list would pass even if `fillField` ignored `sensitivity`
 * entirely.
 *
 * CI runs this file and a failure fails the build. These are not preferences.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeForm } from '../../extension/src/core/normalize/formNormalizer';
import { fillField, fillFields } from '../../extension/src/core/interaction/engine';
import { buildSuggestions } from '../../shared/matching/pipeline';
import type { NormalizedForm } from '../../extension/src/core/normalize/formNormalizer';
import type { FillTarget } from '../../extension/src/core/interaction/types';
import { loadFixture, setBody } from '../helpers/dom';
import { TEST_PROFILE } from '../helpers/profile';

/** Build a fill target for the field whose label matches, by its own id. */
function targetFor(normalized: NormalizedForm, label: string): FillTarget {
  const field = normalized.form.fields.find((f) => f.label === label);
  if (!field) {
    const seen = normalized.form.fields.map((f) => f.label).join(' | ');
    throw new Error(`no field labelled "${label}"; saw: ${seen}`);
  }
  const handle = normalized.elements.get(field.id);
  if (!handle) throw new Error(`no element handle for "${label}"`);
  return { field, element: handle.element, root: handle.root, members: handle.members };
}

const value = (selector: string): string =>
  (document.querySelector(selector) as HTMLInputElement | null)?.value ?? '<missing>';

const checked = (selector: string): boolean =>
  (document.querySelector(selector) as HTMLInputElement | null)?.checked ?? false;

// ─── A blocked field stays blocked, whatever the caller says ──────────────────

describe('a blocked field cannot be written by any caller', () => {
  beforeEach(() => loadFixture('sensitive-fields.html'));

  it('refuses every blocked field on the sensitive fixture', async () => {
    const normalized = normalizeForm({ href: 'https://example.test/apply' });
    const blocked = normalized.form.fields.filter((f) => f.sensitivity === 'blocked');
    expect(blocked.length, 'the fixture must contain blocked fields to be meaningful').toBeGreaterThan(0);

    for (const field of blocked) {
      const handle = normalized.elements.get(field.id)!;
      const target: FillTarget = {
        field,
        element: handle.element,
        root: handle.root,
        members: handle.members,
      };
      // The caller is actively hostile: it hands over a plausible value anyway.
      const outcome = await fillField(target, 'ATTACKER-SUPPLIED', { interFieldDelayMs: 0 });
      expect(outcome.filled, `${field.label} must not be filled`).toBe(false);
      expect(outcome.method).toBe('skipped');
    }
  });

  it('leaves the DOM untouched after a refused write', async () => {
    const normalized = normalizeForm({ href: 'https://example.test/apply' });
    const before = document.body.innerHTML;

    for (const field of normalized.form.fields.filter((f) => f.sensitivity === 'blocked')) {
      const handle = normalized.elements.get(field.id)!;
      await fillField(
        { field, element: handle.element, root: handle.root, members: handle.members },
        'ATTACKER-SUPPLIED',
        { interFieldDelayMs: 0 },
      );
    }

    expect(document.body.innerHTML).toBe(before);
    expect(value('input[name="password"]')).toBe('');
    expect(value('input[name="otp"]')).toBe('');
    expect(value('input[name="cvv"]')).toBe('');
    expect(value('input[name="ssn"]')).toBe('');
    expect(value('input[name="aadhaar"]')).toBe('');
  });

  it('re-checks the label at write time, so a forged sensitivity is ignored', async () => {
    // The worst case: something upstream mislabels a one-time-code field as `normal`.
    // `fillField` must reach its own verdict rather than trust the field it was handed.
    setBody('<label for="c">One-Time Code</label><input id="c" name="code" />');
    const normalized = normalizeForm({ href: 'https://example.test/verify' });
    const target = targetFor(normalized, 'One-Time Code');

    const forged: FillTarget = {
      ...target,
      field: { ...target.field, sensitivity: 'normal', sensitivityReason: undefined },
    };

    const outcome = await fillField(forged, '123456', { interFieldDelayMs: 0 });
    expect(outcome.filled).toBe(false);
    expect(value('#c')).toBe('');
  });

  it('refuses a file input even when handed a value', async () => {
    setBody('<label for="f">Upload your resume</label><input id="f" type="file" name="resume" />');
    const normalized = normalizeForm({ href: 'https://example.test/apply' });
    const outcome = await fillField(targetFor(normalized, 'Upload your resume'), '/etc/passwd', {
      interFieldDelayMs: 0,
    });
    expect(outcome.filled).toBe(false);
    expect(outcome.method).toBe('file-picker');
  });
});

// ─── Nothing is ever submitted ───────────────────────────────────────────────

describe('the engine never submits a form', () => {
  it('does not submit while filling a complete form', async () => {
    loadFixture('complex-html.html');
    const form = document.querySelector('form');
    expect(form, 'the fixture must contain a form').not.toBeNull();

    const submitted = vi.fn();
    form!.addEventListener('submit', submitted);
    // jsdom's HTMLFormElement.submit() does not fire a submit event, so spy on it too.
    const nativeSubmit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {});
    const requestSubmit = vi
      .spyOn(HTMLFormElement.prototype, 'requestSubmit')
      .mockImplementation(() => {});

    const normalized = normalizeForm({ href: 'https://example.test/apply' });
    const { suggestions } = buildSuggestions(normalized.form, TEST_PROFILE, {
      documents: TEST_PROFILE.documents,
    });
    const entries = suggestions
      .filter((s) => s.value !== null)
      .map((s) => {
        const field = normalized.form.fields.find((f) => f.id === s.fieldId)!;
        const handle = normalized.elements.get(s.fieldId)!;
        return {
          target: { field, element: handle.element, root: handle.root, members: handle.members },
          value: s.value,
        };
      });

    const report = await fillFields(entries, {
      platformHandler: normalized.adapter.fillField,
      interFieldDelayMs: 0,
    });

    expect(report.filled, 'the fill must actually have done something').toBeGreaterThan(0);
    expect(submitted).not.toHaveBeenCalled();
    expect(nativeSubmit).not.toHaveBeenCalled();
    expect(requestSubmit).not.toHaveBeenCalled();
  });

  it('does not click a submit button even when it is the only control', async () => {
    setBody(`
      <form>
        <label for="n">Full Name</label>
        <input id="n" name="fullName" />
        <button type="submit">Submit application</button>
      </form>
    `);
    const button = document.querySelector('button')!;
    const clicked = vi.fn();
    button.addEventListener('click', clicked);

    const normalized = normalizeForm({ href: 'https://example.test/apply' });
    // A submit button is not a field: it must not even be detected as one.
    expect(normalized.form.fields.map((f) => f.label)).toEqual(['Full Name']);

    await fillField(targetFor(normalized, 'Full Name'), 'Saiteja Reddy Kotha', {
      interFieldDelayMs: 0,
    });
    expect(clicked).not.toHaveBeenCalled();
    expect(value('#n')).toBe('Saiteja Reddy Kotha');
  });

  it('skips a radio option whose text would trigger an action', async () => {
    setBody(`
      <fieldset>
        <legend>How would you like to proceed?</legend>
        <label><input type="radio" name="how" value="Save draft" /> Save draft</label>
        <label><input type="radio" name="how" value="Submit now" /> Submit now</label>
      </fieldset>
    `);
    const normalized = normalizeForm({ href: 'https://example.test/apply' });
    const target = targetFor(normalized, 'How would you like to proceed?');

    const outcome = await fillField(target, 'Submit now', { interFieldDelayMs: 0 });
    expect(outcome.filled).toBe(false);
    expect(outcome.method).toBe('skipped');
    expect(checked('input[value="Submit now"]')).toBe(false);
  });
});

// ─── The source itself contains no submission path ───────────────────────────

describe('no submission path exists in the source we ship', () => {
  /** Every TypeScript file FormPilot authors, excluding tests. */
  async function ourSource(): Promise<{ path: string; text: string }[]> {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const files: { path: string; text: string }[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
          files.push({ path: full, text: readFileSync(full, 'utf8') });
        }
      }
    };
    walk('extension/src');
    walk('shared');
    return files;
  }

  it('calls no form-submission API anywhere', async () => {
    // Scanning our own source rather than the built bundle: the bundle embeds React, whose
    // warning strings mention `form.submit()` and `form.requestSubmit()` as prose. Grepping
    // the bundle flags those and proves nothing, so the check is scoped to code we wrote.
    const offenders: string[] = [];
    for (const file of await ourSource()) {
      for (const [index, line] of file.text.split('\n').entries()) {
        const code = line.replace(/\/\/.*$/, '');
        if (/\brequestSubmit\s*\(/.test(code) || /\.submit\s*\(/.test(code)) {
          offenders.push(`${file.path}:${index + 1}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('confines page-element clicking to one reviewed function', async () => {
    // `clickElement` in setters.ts is the single place a page element is clicked, and every
    // one of its call sites is guarded by `isConsequentialAction`. Keeping that the only
    // clicker is what makes those guards a real boundary rather than a convention. The two
    // allowed exceptions click elements FormPilot created itself — a download anchor and a
    // file input it appends — neither of which belongs to the page's form.
    const ALLOWED = new Set([
      'extension/src/core/interaction/setters.ts',
      'extension/src/options/Options.tsx',
      'extension/src/content/index.tsx',
    ]);
    const clickers = new Set<string>();
    for (const file of await ourSource()) {
      if (/\.click\s*\(\s*\)/.test(file.text)) clickers.add(file.path);
    }
    expect([...clickers].filter((path) => !ALLOWED.has(path))).toEqual([]);
    expect(clickers.has('extension/src/core/interaction/setters.ts')).toBe(true);
  });
});

/**
 * When several ARIA options are one question, and when they are not.
 *
 * Native controls answer this with `name`: a shared name *is* the author saying "these are one
 * question". ARIA options usually have no name, and the detector used to fall back to "same parent
 * element" — a different claim entirely, since a `<fieldset>` is a section and a section holds
 * several unrelated questions.
 *
 * That fallback merged a marketing opt-in and a legal consent, sitting side by side in one fieldset,
 * into a single field labelled with the fieldset's legend. One control for two unrelated decisions,
 * under a label naming neither. Found by `tests/e2e/apps/react-widgets`.
 *
 * Merging now needs a positive signal. Both directions are tested here, because the fix trades one
 * error for another and the trade only holds if the capability it costs is the smaller one.
 */
import { describe, expect, it } from 'vitest';
import { normalizeForm } from '../../extension/src/core/normalize/formNormalizer';
import { setBody } from '../helpers/dom';

const GENERIC = 'https://app.example.test/apply';
const GF_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSc/viewform';

const detect = (url = GENERIC) => normalizeForm({ href: url }).form.fields;
const labels = (url = GENERIC): string[] => detect(url).map((field) => field.label ?? '');

describe('independent ARIA checkboxes stay independent', () => {
  it('does not merge two consent controls that merely share a fieldset', () => {
    setBody(`
      <form>
        <fieldset>
          <legend>Preferences</legend>
          <div role="checkbox" tabindex="0" aria-checked="false" aria-label="Send me product updates"></div>
          <div role="checkbox" tabindex="0" aria-checked="false" aria-label="I agree to the terms and conditions"></div>
        </fieldset>
      </form>
    `);
    const found = detect();
    expect(found).toHaveLength(2);
    expect(found.map((field) => field.label)).toEqual([
      'Send me product updates',
      'I agree to the terms and conditions',
    ]);
    // Each is its own boolean, not a member of a multi-select.
    for (const field of found) expect(field.type).toBe('checkbox');
  });

  it('never labels a control with the section heading above it', () => {
    setBody(`
      <form>
        <fieldset>
          <legend>Custom widgets</legend>
          <div role="checkbox" tabindex="0" aria-checked="false" aria-label="I certify the above is true"></div>
        </fieldset>
      </form>
    `);
    expect(labels()).not.toContain('Custom widgets');
    expect(labels()).toContain('I certify the above is true');
  });

  it('keeps them separate even with no fieldset at all', () => {
    setBody(`
      <form>
        <div>
          <div role="checkbox" tabindex="0" aria-checked="false" aria-label="Subscribe to the newsletter"></div>
          <div role="checkbox" tabindex="0" aria-checked="false" aria-label="I accept the privacy policy"></div>
        </div>
      </form>
    `);
    expect(detect()).toHaveLength(2);
  });
});

describe('an author who marks up a group gets a group', () => {
  /** `role="group"` is how ARIA says "these belong together". Honour it. */
  it('merges ARIA checkboxes inside a role="group"', () => {
    setBody(`
      <form>
        <span id="skills-label">Technical skills</span>
        <div role="group" aria-labelledby="skills-label">
          <div role="checkbox" tabindex="0" aria-checked="false" aria-label="React"></div>
          <div role="checkbox" tabindex="0" aria-checked="false" aria-label="TypeScript"></div>
          <div role="checkbox" tabindex="0" aria-checked="false" aria-label="Python"></div>
        </div>
      </form>
    `);
    const found = detect();
    expect(found).toHaveLength(1);
    expect(found[0].type).toBe('checkbox_group');
    expect(found[0].options?.map((option) => option.label)).toEqual([
      'React',
      'TypeScript',
      'Python',
    ]);
  });

  it('merges ARIA radios inside a role="radiogroup"', () => {
    setBody(`
      <form>
        <span id="exp-label">Years of experience</span>
        <div role="radiogroup" aria-labelledby="exp-label">
          <div role="radio" tabindex="0" aria-checked="false" data-value="0-2">0-2</div>
          <div role="radio" tabindex="0" aria-checked="false" data-value="3-5">3-5</div>
        </div>
      </form>
    `);
    const found = detect();
    expect(found).toHaveLength(1);
    expect(found[0].type).toBe('radio_group');
  });

  /**
   * Radios are safe to merge without any group marker: they are mutually exclusive by definition, so
   * treating a set of them as one question cannot fuse two independent decisions the way checkboxes
   * can. This keeps working for pages that build a radio group out of loose divs.
   */
  it('still merges loose ARIA radios that share a parent', () => {
    setBody(`
      <form>
        <fieldset>
          <legend>Engagement type</legend>
          <div role="radio" tabindex="0" aria-checked="false" data-value="Full time">Full time</div>
          <div role="radio" tabindex="0" aria-checked="false" data-value="Contract">Contract</div>
        </fieldset>
      </form>
    `);
    const found = detect();
    expect(found).toHaveLength(1);
    expect(found[0].type).toBe('radio_group');
  });
});

describe('native controls are unaffected', () => {
  it('still merges native checkboxes that share a name', () => {
    setBody(`
      <form>
        <fieldset>
          <legend>Technical skills</legend>
          <label><input type="checkbox" name="skills" value="React" /> React</label>
          <label><input type="checkbox" name="skills" value="Python" /> Python</label>
        </fieldset>
      </form>
    `);
    const found = detect();
    expect(found).toHaveLength(1);
    expect(found[0].type).toBe('checkbox_group');
  });

  it('still keeps native checkboxes with different names apart', () => {
    setBody(`
      <form>
        <label><input type="checkbox" name="newsletter" /> Subscribe to the newsletter</label>
        <label><input type="checkbox" name="terms" /> I agree to the terms and conditions</label>
      </form>
    `);
    expect(detect()).toHaveLength(2);
  });
});

describe('a platform adapter decides for its own markup', () => {
  /**
   * A platform adapter's containers are questions by construction — Google Forms' `role="listitem"`
   * is one question — so its word is enough on its own, with no ARIA group marker needed. This is
   * the case the new rule must not break, since the Google Forms adapter is Verified.
   */
  it('merges Google Forms checkbox options from the adapter container alone', () => {
    setBody(`
      <div role="listitem" data-params="checkbox">
        <div role="heading">Technical Skills</div>
        <div>
          <div role="checkbox" aria-checked="false" aria-label="React" data-value="React"></div>
          <div role="checkbox" aria-checked="false" aria-label="TypeScript" data-value="TypeScript"></div>
          <div role="checkbox" aria-checked="false" aria-label="Python" data-value="Python"></div>
        </div>
      </div>
    `);
    const found = detect(GF_URL);
    expect(found).toHaveLength(1);
    expect(found[0].label).toBe('Technical Skills');
    expect(found[0].type).toBe('checkbox_group');
    expect(found[0].options).toHaveLength(3);
  });

  it('still keeps two separate Google Forms questions separate', () => {
    setBody(`
      <div role="listitem" data-params="checkbox">
        <div role="heading">Technical Skills</div>
        <div><div role="checkbox" aria-checked="false" aria-label="React" data-value="React"></div></div>
      </div>
      <div role="listitem" data-params="checkbox">
        <div role="heading">Declaration</div>
        <div><div role="checkbox" aria-checked="false" aria-label="I certify this is true" data-value="certify"></div></div>
      </div>
    `);
    expect(detect(GF_URL)).toHaveLength(2);
  });
});

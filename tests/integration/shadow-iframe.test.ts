/**
 * Shadow DOM and iframe support, and honest reporting of what is out of reach.
 *
 * The fixtures' web components are defined by inline scripts, which `loadFixture`
 * strips, so these tests build the same structures directly — the point under test is
 * the traversal, not `customElements`.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { normalizeForm } from '../../extension/src/core/normalize/formNormalizer';
import { buildSuggestions } from '../../shared/matching/pipeline';
import { fillField } from '../../extension/src/core/interaction/engine';
import { setBody } from '../helpers/dom';
import { TEST_PROFILE } from '../helpers/profile';

const URL_ = 'https://jobs.example.test/apply';

function attachOpenShadow(hostSelector: string, html: string): ShadowRoot {
  const host = document.querySelector(hostSelector)!;
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = html;
  return shadow;
}

describe('open shadow roots', () => {
  beforeEach(() => {
    setBody(`
      <label for="outside">Full Name</label><input id="outside" autocomplete="name" />
      <div id="card"></div>`);
    attachOpenShadow(
      '#card',
      `<label for="s-email">Email Address</label><input id="s-email" type="email" autocomplete="email" />
       <label for="s-phone">Phone Number</label><input id="s-phone" type="tel" autocomplete="tel" />
       <div id="nested"></div>`,
    );
  });

  it('detects fields inside a shadow root alongside light-DOM fields', () => {
    const { form } = normalizeForm({ href: URL_ });
    expect(form.fields.map((f) => f.label)).toEqual(['Full Name', 'Email Address', 'Phone Number']);
    expect(form.metadata.shadowRootsTraversed).toBe(1);
  });

  it('records the shadow path so the field can be re-addressed', () => {
    const { form } = normalizeForm({ href: URL_ });
    const email = form.fields.find((f) => f.label === 'Email Address')!;
    expect(email.shadowPath).toEqual(['div#card']);
    expect(form.fields.find((f) => f.label === 'Full Name')?.shadowPath).toBeUndefined();
  });

  it('descends into nested shadow roots', () => {
    const outer = document.querySelector('#card')!.shadowRoot!;
    const nested = outer.querySelector('#nested')!;
    const inner = nested.attachShadow({ mode: 'open' });
    inner.innerHTML = `<label for="n">LinkedIn Profile</label><input id="n" type="url" />`;

    const { form } = normalizeForm({ href: URL_ });
    expect(form.fields.map((f) => f.label)).toContain('LinkedIn Profile');
    expect(form.metadata.shadowRootsTraversed).toBe(2);
    expect(form.fields.find((f) => f.label === 'LinkedIn Profile')?.shadowPath).toEqual(['div#card', 'div#nested']);
  });

  it('matches and fills a shadowed field like any other', async () => {
    const normalized = normalizeForm({ href: URL_ });
    const { suggestions } = buildSuggestions(normalized.form, TEST_PROFILE);
    const email = suggestions.find((s) => s.label === 'Email Address')!;
    expect(email.value).toBe('saiteja@example.com');

    const field = normalized.form.fields.find((f) => f.id === email.fieldId)!;
    const handle = normalized.elements.get(field.id)!;
    const outcome = await fillField(
      { field, element: handle.element, root: handle.root, members: handle.members },
      email.value,
    );
    expect(outcome.filled).toBe(true);
    expect(document.querySelector('#card')!.shadowRoot!.querySelector<HTMLInputElement>('#s-email')!.value).toBe(
      'saiteja@example.com',
    );
  });

  it('cannot see into a closed shadow root and does not pretend otherwise', () => {
    setBody(`<div id="closed"></div><label for="a">Full Name</label><input id="a" />`);
    const closed = document.querySelector('#closed')!.attachShadow({ mode: 'closed' });
    closed.innerHTML = `<label for="h">Email Address</label><input id="h" />`;

    const { form } = normalizeForm({ href: URL_ });
    expect(form.fields.map((f) => f.label)).toEqual(['Full Name']);
    expect(form.metadata.shadowRootsTraversed).toBe(0);
  });
});

describe('iframes', () => {
  it('detects and fills fields in a same-origin frame', async () => {
    setBody(`<label for="host">Full Name</label><input id="host" /><iframe id="f"></iframe>`);
    const frameDoc = document.querySelector<HTMLIFrameElement>('#f')!.contentDocument!;
    frameDoc.body.innerHTML = `<label for="fe">Email Address</label><input id="fe" type="email" />`;

    const normalized = normalizeForm({ href: URL_ });
    expect(normalized.form.fields.map((f) => f.label)).toEqual(['Full Name', 'Email Address']);
    const framed = normalized.form.fields.find((f) => f.label === 'Email Address')!;
    expect(framed.framePath).toEqual([0]);
    expect(normalized.form.metadata.inaccessibleFrames).toBe(0);

    const handle = normalized.elements.get(framed.id)!;
    const outcome = await fillField(
      { field: framed, element: handle.element, root: handle.root, members: handle.members },
      'saiteja@example.com',
    );
    expect(outcome.filled).toBe(true);
    expect(frameDoc.querySelector<HTMLInputElement>('#fe')!.value).toBe('saiteja@example.com');
  });

  it('counts a cross-origin frame and warns the user instead of failing silently', () => {
    setBody(`<label for="a">Full Name</label><input id="a" /><iframe id="x"></iframe>`);
    const frame = document.querySelector<HTMLIFrameElement>('#x')!;
    Object.defineProperty(frame, 'contentDocument', {
      get() {
        throw new Error('SecurityError: Blocked a frame with origin');
      },
    });

    const { form } = normalizeForm({ href: URL_ });
    expect(form.fields.map((f) => f.label)).toEqual(['Full Name']);
    expect(form.metadata.inaccessibleFrames).toBe(1);
    expect(form.metadata.warnings.join(' ')).toMatch(/different origin/i);
    expect(form.metadata.warnings.join(' ')).toMatch(/manually/i);
  });

  it('labels a field from its own frame document, not the host page', () => {
    setBody(`<h1>Host page</h1><iframe id="f"></iframe>`);
    const frameDoc = document.querySelector<HTMLIFrameElement>('#f')!.contentDocument!;
    frameDoc.body.innerHTML = `<h2>Contact details</h2><label for="c">City</label><input id="c" />`;

    const { form } = normalizeForm({ href: URL_ });
    const city = form.fields.find((f) => f.label === 'City')!;
    expect(city.labelSource).toBe('label-for');
    expect(city.framePath).toEqual([0]);
  });
});

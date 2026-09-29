/** Selector synthesis must survive the round trip between detection and filling. */
import { describe, expect, it } from 'vitest';
import { buildSelector, resolveSelector } from '../../extension/src/core/detect/selector';
import { setBody } from '../helpers/dom';

const el = (selector: string): Element => {
  const found = document.querySelector(selector);
  if (!found) throw new Error(`fixture missing ${selector}`);
  return found;
};

describe('buildSelector', () => {
  it('prefers a unique id', () => {
    setBody(`<input id="full-name" /><input id="email" />`);
    expect(buildSelector(el('#full-name'), document)).toBe('#full-name');
  });

  it('escapes ids that need it', () => {
    setBody(`<input id="user:name" />`);
    const selector = buildSelector(el('[id="user:name"]'), document);
    expect(resolveSelector(selector, document)).toBe(el('[id="user:name"]'));
  });

  it('does not use an id that starts with a digit', () => {
    setBody(`<input id="1abc" name="one" />`);
    expect(buildSelector(el('[id="1abc"]'), document)).not.toBe('#1abc');
  });

  it('prefers test hooks over structure', () => {
    setBody(`<div><input data-testid="email-input" /></div>`);
    expect(buildSelector(el('[data-testid]'), document)).toBe('input[data-testid="email-input"]');
  });

  it('uses the name attribute when it is unique', () => {
    setBody(`<input name="email" /><input name="phone" />`);
    expect(buildSelector(el('[name="email"]'), document)).toBe('input[name="email"]');
  });

  it('disambiguates a shared name by type', () => {
    setBody(`<input name="contact" type="email" /><input name="contact" type="tel" />`);
    const selector = buildSelector(el('[type="tel"]'), document);
    expect(resolveSelector(selector, document)).toBe(el('[type="tel"]'));
  });

  it('falls back to a structural path when no attribute is distinctive', () => {
    setBody(`<div><span></span><input /><input /></div>`);
    const second = document.querySelectorAll('input')[1];
    const selector = buildSelector(second, document);
    expect(selector).toContain('nth-of-type');
    expect(resolveSelector(selector, document)).toBe(second);
  });

  it('produces a selector that resolves for every control on a busy page', () => {
    setBody(`
      <form>
        <input id="a" /><input name="b" /><input aria-label="C" />
        <div><div><input /></div><div><input /></div></div>
        <select><option>x</option></select><textarea></textarea>
      </form>`);
    const controls = Array.from(document.querySelectorAll('input, select, textarea'));
    for (const control of controls) {
      const selector = buildSelector(control, document);
      expect(resolveSelector(selector, document), selector).toBe(control);
    }
  });

  it('scopes selectors to a shadow root', () => {
    setBody(`<div id="host"></div><input id="a" />`);
    const host = el('#host');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<input id="a" name="inner" />`;
    const inner = shadow.querySelector('#a')!;
    const selector = buildSelector(inner, shadow);
    expect(resolveSelector(selector, shadow)).toBe(inner);
  });
});

describe('resolveSelector', () => {
  it('returns null for an empty or invalid selector', () => {
    setBody(`<input id="a" />`);
    expect(resolveSelector('', document)).toBeNull();
    expect(resolveSelector('input[', document)).toBeNull();
    expect(resolveSelector('#nope', document)).toBeNull();
  });
});

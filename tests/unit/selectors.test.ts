/**
 * Selector-list composition.
 *
 * These exist because the naive `` `${A} ${B}` `` form shipped in four adapters and was
 * caught in real Chromium: a React page whose only marker was a plain `<fieldset><legend>`
 * was claimed by the SurveyMonkey adapter, because `'a, b' + ' ' + 'c, legend'` parses as
 * a list whose last member is a bare `legend`.
 */
import { describe, expect, it } from 'vitest';
import { descendantSelector, refineSelector } from '../../extension/src/core/dom/selectors';

describe('descendantSelector', () => {
  it('expands two lists into a cross product', () => {
    expect(descendantSelector('a, b', 'c, d')).toBe('a c, a d, b c, b d');
  });

  it('leaves single selectors as a plain descendant pair', () => {
    expect(descendantSelector('div[role="listitem"]', 'div[role="heading"]')).toBe(
      'div[role="listitem"] div[role="heading"]',
    );
  });

  it('ignores stray whitespace and empty members', () => {
    expect(descendantSelector(' a ,, b ', ' c ')).toBe('a c, b c');
  });

  it('never yields a member that is only the descendant part', () => {
    const composed = descendantSelector('[data-x], .y', '.title, legend');
    for (const member of composed.split(',')) {
      expect(member.trim().split(/\s+/).length).toBe(2);
    }
  });

  it('matches only a real nesting, which the naive form does not', () => {
    const doc = new DOMParser().parseFromString(
      '<fieldset><legend>Years of experience</legend></fieldset>',
      'text/html',
    );
    const QUESTION = '[data-testid^="question"], .question-body';
    const TITLE = '[data-testid="question-title"], legend';

    // The bug, reproduced: the naive form matches this unrelated page.
    expect(doc.querySelector(`${QUESTION} ${TITLE}`)).not.toBeNull();
    // The fix does not.
    expect(doc.querySelector(descendantSelector(QUESTION, TITLE))).toBeNull();
  });
});

describe('refineSelector', () => {
  it('applies the suffix to every member, not just the last', () => {
    expect(refineSelector('li.form-line, div.form-line', '[data-type]')).toBe(
      'li.form-line[data-type], div.form-line[data-type]',
    );
  });

  it('requires the suffix on each member', () => {
    const doc = new DOMParser().parseFromString('<ul><li class="form-line"></li></ul>', 'text/html');
    const LINE = 'li.form-line, div.form-line';

    // The bug: `${LINE}[data-type]` leaves the first member unqualified.
    expect(doc.querySelector(`${LINE}[data-type]`)).not.toBeNull();
    expect(doc.querySelector(refineSelector(LINE, '[data-type]'))).toBeNull();
  });
});

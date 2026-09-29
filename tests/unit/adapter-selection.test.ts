/**
 * Adapter selection, as a unit.
 *
 * The integration suite checks that each adapter *parses* its platform's markup correctly. These
 * tests check the prior question: which adapter is chosen, and — more importantly — which is not.
 *
 * Both directions matter, and the negative direction matters more. A selector-composition bug once
 * let the SurveyMonkey adapter claim any page containing a single `<fieldset>`, so a plain React page
 * came back labelled as a platform reproduction. An adapter that claims a page it knows nothing about
 * is worse than one that declines a page it could have handled: the generic engine is a competent
 * fallback, a confused platform adapter is not.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { selectAdapter, ADAPTERS } from '../../extension/src/core/adapters/registry';
import { detectPlatform } from '../../extension/src/core/platform/detect';
import type { FormPlatform } from '../../shared/types/form';

function setBody(html: string): void {
  document.body.innerHTML = html;
}

/** Select an adapter the way the normalizer does: detect the platform first, then choose. */
function select(html: string, href: string) {
  setBody(html);
  const platform = detectPlatform(href, document).platform;
  return { platform, ...selectAdapter({ url: href, document, platform }) };
}

beforeEach(() => setBody(''));

// ─── Every adapter declares its support honestly ─────────────────────────────

describe('the registry', () => {
  it('gives every adapter a support status and a unique id', () => {
    const ids = ADAPTERS.map((adapter) => adapter.id);
    expect(new Set(ids).size, 'adapter ids must be unique').toBe(ids.length);
    for (const adapter of ADAPTERS) {
      expect(['verified', 'experimental', 'generic-fallback'], adapter.id).toContain(
        adapter.supportStatus,
      );
    }
  });

  it('requires an experimental adapter to say what it was built against', () => {
    for (const adapter of ADAPTERS.filter((a) => a.supportStatus === 'experimental')) {
      expect(adapter.provenance, `${adapter.id} must carry provenance`).toBeTruthy();
      // The provenance exists so a reader knows the adapter has never met the live product.
      expect(adapter.provenance, adapter.id).toMatch(/unreachable|reproduction/i);
    }
  });

  it('ends with a fallback that matches everything at the lowest priority', () => {
    const generic = ADAPTERS.find((adapter) => adapter.platform === 'generic-html');
    expect(generic).toBeTruthy();
    expect(generic!.priority).toBe(0);
    setBody('<p>no form at all</p>');
    expect(generic!.matches({ url: 'https://example.test/', document, platform: 'unknown' })).toBe(true);
  });
});

// ─── Positive selection ──────────────────────────────────────────────────────

describe('a platform is recognised from its own markup', () => {
  const CASES: { name: string; platform: FormPlatform; adapterId: string; html: string }[] = [
    {
      name: 'Microsoft Forms',
      platform: 'microsoft-forms',
      adapterId: 'microsoft-forms@1-experimental',
      html: `<div data-automation-id="questionItem"><div data-automation-id="questionTitle">Full Name</div><input /></div>`,
    },
    {
      name: 'Typeform',
      platform: 'typeform',
      adapterId: 'typeform@1-experimental',
      html: `<div data-qa="block-container"><div data-qa="question-header">Your name</div><input /></div>`,
    },
    {
      name: 'Jotform',
      platform: 'jotform',
      adapterId: 'jotform@1-experimental',
      html: `<ul><li class="form-line" data-type="control_textbox"><label class="form-label">Full Name</label><input /></li></ul>`,
    },
    {
      name: 'SurveyMonkey',
      platform: 'surveymonkey',
      adapterId: 'surveymonkey@1-experimental',
      html: `<div data-testid="question-1"><div class="question-title-container">Full Name</div><input /></div>`,
    },
    {
      name: 'Google Forms',
      platform: 'google-forms',
      adapterId: 'google-forms@2',
      html: `<div role="listitem" data-params="x"><div role="heading">Full Name</div><input /></div>`,
    },
  ];

  for (const testCase of CASES) {
    it(`selects the ${testCase.name} adapter from markup alone, with no matching URL`, () => {
      // Served from an unrelated origin on purpose. A platform embedded in an iframe or hosted on a
      // custom domain has no recognisable URL, and every one of these must still be identified.
      const result = select(testCase.html, 'https://forms.example.test/survey/42');
      expect(result.platform).toBe(testCase.platform);
      expect(result.adapter.id).toBe(testCase.adapterId);
      expect(result.fallback).toBe(false);
    });
  }
});

// ─── Negative selection: the direction that actually broke ───────────────────

describe('an ordinary page is never claimed by a platform adapter', () => {
  const ORDINARY: { why: string; html: string }[] = [
    { why: 'a plain labelled input', html: `<label for="a">Full Name</label><input id="a" />` },
    {
      why: 'a fieldset with a legend — the exact shape that broke once',
      html: `<fieldset><legend>Years of experience</legend><label><input type="radio" name="y" value="0-2" /> 0-2</label></fieldset>`,
    },
    { why: 'a table-laid-out form', html: `<table><tr><td>Email</td><td><input /></td></tr></table>` },
    {
      why: 'an ARIA widget tree with no native inputs',
      html: `<div role="group" aria-label="Skills"><div role="checkbox" aria-checked="false">React</div></div>`,
    },
    {
      why: 'a class name that merely contains "question"',
      html: `<div class="question-body">What is your name?</div><label for="b">Name</label><input id="b" />`,
    },
    {
      why: 'a data-testid that merely starts with "question"',
      html: `<div data-testid="question-count">3 questions</div><label for="c">Name</label><input id="c" />`,
    },
  ];

  for (const { why, html } of ORDINARY) {
    it(`falls to the generic engine: ${why}`, () => {
      const result = select(html, 'https://jobs.example.test/apply');
      // `unknown` and `generic-html` are both correct here: `detectPlatform` reports `unknown` when
      // a page carries no recognisable form at all. What matters is that no *platform* is claimed.
      expect(['generic-html', 'unknown']).toContain(result.platform);
      expect(result.adapter.platform).toBe('generic-html');
      expect(result.note, 'a generic page must carry no warning').toBeUndefined();
    });
  }
});

// ─── Degradation: right URL, wrong markup ────────────────────────────────────

describe('a platform URL without the platform markup degrades honestly', () => {
  const URLS: { platform: FormPlatform; href: string }[] = [
    { platform: 'typeform', href: 'https://x.typeform.com/to/abc123' },
    { platform: 'jotform', href: 'https://form.jotform.com/240000000000' },
    { platform: 'surveymonkey', href: 'https://www.surveymonkey.com/r/ABCDEF' },
    { platform: 'google-forms', href: 'https://docs.google.com/forms/d/e/1FA/viewform' },
  ];

  for (const { platform, href } of URLS) {
    it(`${platform}: uses the generic engine and says the markup was missing`, () => {
      const result = select(`<label for="a">Email Address</label><input id="a" type="email" />`, href);
      // The URL is still recognised — that is useful information — but the adapter declines.
      expect(result.platform).toBe(platform);
      expect(result.adapter.platform).toBe('generic-html');
      expect(result.fallback).toBe(true);
      expect(result.note ?? '').toMatch(/expected markup was not found/i);
    });
  }
});

// ─── Warnings ────────────────────────────────────────────────────────────────

describe('an experimental adapter warns the user', () => {
  it('says it is experimental and asks for every suggestion to be reviewed', () => {
    const result = select(
      `<div data-automation-id="questionItem"><div data-automation-id="questionTitle">Full Name</div><input /></div>`,
      'https://forms.office.com/r/abc',
    );
    expect(result.note ?? '').toMatch(/experimental/i);
    expect(result.note ?? '').toMatch(/review every suggestion/i);
  });

  it('does not warn for a verified adapter', () => {
    const result = select(
      `<div role="listitem" data-params="x"><div role="heading">Full Name</div><input /></div>`,
      'https://docs.google.com/forms/d/e/1FA/viewform',
    );
    expect(result.adapter.supportStatus).toBe('verified');
    expect(result.note).toBeUndefined();
  });
});

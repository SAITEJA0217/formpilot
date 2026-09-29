/**
 * What of the page URL leaves the device.
 *
 * The URL is sent on the AI path because a generated answer needs to know who is asking. The
 * release brief's instruction was not to remove it blindly but to work out what actually depends on
 * it — and what depends on it is the company, which the hostname carries. Everything after the path
 * is where an applicant's own identifiers live, and none of it helps write an answer.
 *
 * These are the leak cases, written from real careers-URL shapes: a prefilled email in the query, a
 * session token, an application id in the fragment, credentials in the authority.
 */
import { describe, expect, it } from 'vitest';
import { minimiseUrlForAI } from '../../shared/privacy/redact';

describe('the query string never leaves', () => {
  const LEAKS: { why: string; url: string; keeps: string }[] = [
    {
      why: 'a prefilled email',
      url: 'https://jobs.example.com/apply/senior-engineer?email=you@example.com',
      keeps: 'https://jobs.example.com/apply/senior-engineer',
    },
    {
      why: 'a session token',
      url: 'https://careers.example.com/form?token=8f3ac1d29b&step=2',
      keeps: 'https://careers.example.com/form',
    },
    {
      why: 'tracking parameters',
      url: 'https://example.com/careers/apply?utm_source=linkedin&utm_campaign=q4&gclid=abc',
      keeps: 'https://example.com/careers/apply',
    },
    {
      why: 'an application id in the fragment',
      url: 'https://example.com/apply#candidateId=99201&step=3',
      keeps: 'https://example.com/apply',
    },
    {
      why: 'both at once',
      url: 'https://example.com/a/b?email=you@example.com#token=xyz',
      keeps: 'https://example.com/a/b',
    },
  ];

  for (const { why, url, keeps } of LEAKS) {
    it(`drops ${why}`, () => {
      expect(minimiseUrlForAI(url)).toBe(keeps);
    });
  }

  it('drops credentials in the authority', () => {
    const minimised = minimiseUrlForAI('https://someone:secret@jobs.example.com/apply');
    expect(minimised).toBe('https://jobs.example.com/apply');
    expect(minimised).not.toContain('secret');
    expect(minimised).not.toContain('someone');
  });

  it('leaves no trace of the removed parts', () => {
    const minimised = minimiseUrlForAI(
      'https://jobs.example.com/apply?email=you@example.com&token=8f3ac1#candidateId=99201',
    );
    for (const secret of ['you@example.com', '8f3ac1', '99201', 'email', 'token', 'candidateId']) {
      expect(minimised, `${secret} must not survive`).not.toContain(secret);
    }
  });
});

describe('what grounding needs is kept', () => {
  it('keeps the host, because that is who is asking', () => {
    expect(minimiseUrlForAI('https://jobs.acme-corp.com/apply?x=1')).toContain('jobs.acme-corp.com');
  });

  it('keeps the path, because it is usually the role', () => {
    expect(minimiseUrlForAI('https://example.com/careers/senior-backend-engineer?ref=li')).toBe(
      'https://example.com/careers/senior-backend-engineer',
    );
  });

  it('keeps a non-default port, which distinguishes a host', () => {
    expect(minimiseUrlForAI('http://localhost:3000/apply?a=1')).toBe('http://localhost:3000/apply');
  });
});

describe('anything that is not a web page is refused outright', () => {
  /**
   * A `file:` URL names the user's own filesystem and a `chrome-extension:` URL names the
   * extension, neither of which says anything about a company. There is nothing to minimise, so
   * nothing is sent.
   */
  const REFUSED = [
    'file:///Users/someone/Documents/application.html',
    'chrome-extension://abcdefghijklmnop/popup.html',
    'data:text/html,<form></form>',
    'javascript:void(0)',
    'about:blank',
  ];
  for (const url of REFUSED) {
    it(`sends nothing for ${url.slice(0, 32)}`, () => {
      expect(minimiseUrlForAI(url)).toBeNull();
    });
  }

  it('sends nothing for an unparseable or absent URL', () => {
    expect(minimiseUrlForAI('not a url')).toBeNull();
    expect(minimiseUrlForAI('')).toBeNull();
    expect(minimiseUrlForAI(null)).toBeNull();
    expect(minimiseUrlForAI(undefined)).toBeNull();
  });
});

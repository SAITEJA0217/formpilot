/**
 * Platform detection.
 *
 * Recognition is not the same as support. This function says "this page looks like
 * Typeform"; whether a dedicated adapter exists for it is the registry's business.
 * Keeping the two separate is what stops the product from claiming compatibility it
 * has not earned.
 */
import type { FormPlatform } from '../../../../shared/types/form';

export interface PlatformDetection {
  platform: FormPlatform;
  /** 0..1 confidence in the recognition itself. */
  confidence: number;
  evidence: string;
}

interface HostRule {
  platform: FormPlatform;
  test: (url: URL) => boolean;
  evidence: string;
}

const HOST_RULES: HostRule[] = [
  {
    platform: 'google-forms',
    test: (url) => /(^|\.)docs\.google\.com$/.test(url.hostname) && url.pathname.startsWith('/forms'),
    evidence: 'docs.google.com/forms',
  },
  {
    platform: 'microsoft-forms',
    test: (url) => /(^|\.)forms\.(office|microsoft)\.com$/.test(url.hostname),
    evidence: 'forms.office.com',
  },
  {
    platform: 'typeform',
    test: (url) => /(^|\.)typeform\.com$/.test(url.hostname),
    evidence: 'typeform.com',
  },
  {
    platform: 'jotform',
    test: (url) => /(^|\.)jotform\.(com|co|me)$/.test(url.hostname),
    evidence: 'jotform.com',
  },
  {
    platform: 'surveymonkey',
    test: (url) => /(^|\.)surveymonkey\.(com|co\.uk|net)$/.test(url.hostname),
    evidence: 'surveymonkey.com',
  },
];

/** DOM fingerprints, used when the URL is inconclusive (embeds, custom domains). */
function domFingerprint(doc: Document): PlatformDetection | null {
  if (doc.querySelector('div[role="listitem"][data-params], form[action*="docs.google.com/forms"]')) {
    return { platform: 'google-forms', confidence: 0.9, evidence: 'Google Forms DOM markers' };
  }
  // These fingerprints must cover the markup the adapters actually handle. They did not: the
  // Typeform adapter keys on `block-container` + `question-header` and the Jotform adapter on
  // `li.form-line[data-type]`, neither of which appeared here, so a platform embedded in an iframe
  // or served from a custom domain went unrecognised even though its adapter would have parsed it.
  if (
    doc.querySelector(
      '[data-qa="question"], [data-qa="form-renderer"], ' +
        '[data-qa="block-container"] [data-qa="question-header"], ' +
        '[data-qa="block-container"] [data-qa="question-title"]',
    )
  ) {
    return { platform: 'typeform', confidence: 0.6, evidence: 'Typeform data-qa markers' };
  }
  if (
    doc.querySelector(
      '.jotform-form, form#form[action*="jotform"], li.form-line[data-type], div.form-line[data-type]',
    )
  ) {
    return { platform: 'jotform', confidence: 0.7, evidence: 'Jotform markers' };
  }
  if (doc.querySelector('[data-automation-id="questionTitle"]')) {
    return { platform: 'microsoft-forms', confidence: 0.7, evidence: 'Microsoft Forms automation ids' };
  }
  // SurveyMonkey was URL-only until an end-to-end test on a locally served reproduction returned
  // `generic-html`: the other three platforms had a DOM fingerprint and this one did not, so an
  // embed, an iframe or a custom survey domain went unrecognised.
  //
  // Composed rather than a bare class: `.question-body` and `.question-title-container` are
  // generic enough to appear on unrelated pages, and requiring the nesting is what makes the
  // fingerprint specific. The confidence is the lowest of the four because these markers are the
  // least distinctive; `selectAdapter` still requires the adapter's own markup before it will act.
  if (
    doc.querySelector(
      '[data-testid^="question"] [data-testid="question-title"], ' +
        '[data-testid^="question"] .question-title-container, ' +
        '.question-body .question-title-container',
    )
  ) {
    return { platform: 'surveymonkey', confidence: 0.55, evidence: 'SurveyMonkey question markers' };
  }
  return null;
}

export function detectPlatform(href: string, doc: Document): PlatformDetection {
  let url: URL | null = null;
  try {
    url = new URL(href);
  } catch {
    url = null;
  }

  if (url) {
    for (const rule of HOST_RULES) {
      if (rule.test(url)) {
        return { platform: rule.platform, confidence: 0.98, evidence: rule.evidence };
      }
    }
  }

  const fingerprint = domFingerprint(doc);
  if (fingerprint) return fingerprint;

  const hasControls = !!doc.querySelector('form, input, textarea, select, [contenteditable="true"], [role="textbox"]');
  if (hasControls) {
    return { platform: 'generic-html', confidence: 0.8, evidence: 'standard form controls present' };
  }
  return { platform: 'unknown', confidence: 0.2, evidence: 'no form controls found' };
}

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
  if (doc.querySelector('[data-qa="question"], [data-qa="form-renderer"]')) {
    return { platform: 'typeform', confidence: 0.6, evidence: 'Typeform data-qa markers' };
  }
  if (doc.querySelector('.jotform-form, form#form[action*="jotform"]')) {
    return { platform: 'jotform', confidence: 0.7, evidence: 'Jotform markers' };
  }
  if (doc.querySelector('[data-automation-id="questionTitle"]')) {
    return { platform: 'microsoft-forms', confidence: 0.7, evidence: 'Microsoft Forms automation ids' };
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

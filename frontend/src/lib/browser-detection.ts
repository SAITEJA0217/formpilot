export type SupportedBrowser = 'chrome' | 'edge' | 'brave' | 'chromium' | 'firefox' | 'safari' | 'unknown';

export interface BrowserInfo {
  name: SupportedBrowser;
  label: string;
  isSupported: boolean;
  ctaText: string;
}

export function detectBrowser(): BrowserInfo {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      name: 'unknown',
      label: 'Browser',
      isSupported: true,
      ctaText: 'Install FormPilot'
    };
  }

  const ua = navigator.userAgent.toLowerCase();

  // 1. Check Microsoft Edge first (contains 'edg/' or 'edge/')
  if (ua.includes('edg/') || ua.includes('edge/')) {
    return {
      name: 'edge',
      label: 'Microsoft Edge',
      isSupported: true,
      ctaText: 'Get FormPilot for Edge'
    };
  }

  // 2. Check Brave browser (via navigator.brave or ua)
  const isBrave = (navigator as any).brave && typeof (navigator as any).brave.isBrave === 'function';
  if (isBrave || ua.includes('brave')) {
    return {
      name: 'brave',
      label: 'Brave Browser',
      isSupported: true,
      ctaText: 'Add to Brave'
    };
  }

  // 3. Check Google Chrome (contains 'chrome' and NOT Opera/Vivaldi/Brave/Edge)
  if (ua.includes('chrome') && !ua.includes('opr/') && !ua.includes('opera') && !ua.includes('vivaldi')) {
    return {
      name: 'chrome',
      label: 'Google Chrome',
      isSupported: true,
      ctaText: 'Add to Chrome'
    };
  }

  // 4. Check Other Chromium Browsers (Opera, Vivaldi, Arc, etc.)
  if (ua.includes('chromium') || ua.includes('crios') || ua.includes('opr/') || ua.includes('vivaldi')) {
    return {
      name: 'chromium',
      label: 'Chromium Browser',
      isSupported: true,
      ctaText: 'Install FormPilot'
    };
  }

  // 5. Check Firefox
  if (ua.includes('firefox') || ua.includes('fxios')) {
    return {
      name: 'firefox',
      label: 'Mozilla Firefox',
      isSupported: false,
      ctaText: 'View Supported Browsers'
    };
  }

  // 6. Check Safari
  if (ua.includes('safari') && !ua.includes('chrome') && !ua.includes('android')) {
    return {
      name: 'safari',
      label: 'Apple Safari',
      isSupported: false,
      ctaText: 'View Supported Browsers'
    };
  }

  // 7. Unknown Browser
  return {
    name: 'unknown',
    label: 'Browser',
    isSupported: true,
    ctaText: 'Install FormPilot'
  };
}

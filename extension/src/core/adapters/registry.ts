/**
 * Adapter registry.
 *
 * Exactly one adapter is selected per page: the highest-priority adapter whose
 * `matches` returns true. The generic adapter matches everything at priority 0, so
 * selection never fails.
 *
 * Platforms that are *recognized* but have no dedicated adapter deliberately fall
 * through to the generic adapter and are reported as `generic-fallback`, so the UI
 * and the compatibility matrix can say "detected, untested" instead of implying
 * first-class support.
 */
import type { FormPlatform } from '../../../../shared/types/form';
import { genericHtmlAdapter } from './genericHtml';
import { googleFormsAdapter } from './googleForms';
import { microsoftFormsAdapter } from './microsoftForms';
import { typeformAdapter } from './typeform';
import { jotformAdapter } from './jotform';
import { surveyMonkeyAdapter } from './surveyMonkey';
import type { AdapterContext, FormAdapter } from './types';

export const ADAPTERS: readonly FormAdapter[] = [
  googleFormsAdapter,
  microsoftFormsAdapter,
  typeformAdapter,
  jotformAdapter,
  surveyMonkeyAdapter,
  genericHtmlAdapter,
];

/**
 * Platforms `detectPlatform` recognizes that still have no dedicated adapter.
 *
 * Empty now that all five recognized platforms have one — but the mechanism stays, because
 * the next recognized platform will need it and the honest fallback message with it.
 */
export const RECOGNIZED_WITHOUT_ADAPTER: readonly FormPlatform[] = [];

export interface AdapterSelection {
  adapter: FormAdapter;
  /** True when a recognized platform is being handled by the generic fallback. */
  fallback: boolean;
  note?: string;
}

export function selectAdapter(ctx: AdapterContext): AdapterSelection {
  const matching = ADAPTERS.filter((adapter) => {
    try {
      return adapter.matches(ctx);
    } catch {
      return false;
    }
  }).sort((a, b) => b.priority - a.priority);

  const adapter = matching[0] ?? genericHtmlAdapter;
  const fallback = adapter.platform === 'generic-html' && ctx.platform !== 'generic-html' && ctx.platform !== 'unknown';

  // Three distinct notes, because the three situations warrant different words.
  let note: string | undefined;
  if (fallback) {
    note = RECOGNIZED_WITHOUT_ADAPTER.includes(ctx.platform)
      ? `${ctx.platform} was recognized but has no dedicated adapter yet; using generic detection, which is untested on this platform.`
      : `This looks like ${ctx.platform}, but its expected markup was not found, so FormPilot is reading the page generically.`;
  } else if (adapter.supportStatus === 'experimental') {
    note = `${ctx.platform} support is experimental: the adapter was built against a reproduction of this platform's markup and has not been validated against the live product. Review every suggestion.`;
  }

  return { adapter, fallback, note };
}

export {
  genericHtmlAdapter,
  googleFormsAdapter,
  microsoftFormsAdapter,
  typeformAdapter,
  jotformAdapter,
  surveyMonkeyAdapter,
};
export type { AdapterContext, FormAdapter };

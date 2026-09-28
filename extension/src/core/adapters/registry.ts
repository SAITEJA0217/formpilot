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
import type { AdapterContext, FormAdapter } from './types';

export const ADAPTERS: readonly FormAdapter[] = [googleFormsAdapter, genericHtmlAdapter];

/** Platforms recognized by `detectPlatform` that have no dedicated adapter yet. */
export const RECOGNIZED_WITHOUT_ADAPTER: readonly FormPlatform[] = [
  'microsoft-forms',
  'typeform',
  'jotform',
  'surveymonkey',
];

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
  const fallback = adapter.platform === 'generic-html' && RECOGNIZED_WITHOUT_ADAPTER.includes(ctx.platform);
  return {
    adapter,
    fallback,
    note: fallback
      ? `${ctx.platform} was recognized but has no dedicated adapter yet; using generic detection, which is untested on this platform.`
      : undefined,
  };
}

export { genericHtmlAdapter, googleFormsAdapter };
export type { AdapterContext, FormAdapter };

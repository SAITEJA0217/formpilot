/**
 * Generic HTML adapter — the fallback, and the only adapter most sites need.
 *
 * It contributes no platform hooks at all: standard HTML, ARIA and framework-
 * rendered forms are handled entirely by the generic detector and interaction
 * engine. Its existence is what guarantees there is always exactly one adapter
 * in play.
 */
import type { FormAdapter } from './types';

export const genericHtmlAdapter: FormAdapter = {
  id: 'generic-html@1',
  platform: 'generic-html',
  priority: 0,
  supportStatus: 'verified',
  matches: () => true,
};

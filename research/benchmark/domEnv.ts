/**
 * DOM environment for the benchmark runner.
 *
 * Each page gets a **fresh jsdom realm**, and that realm's constructors are installed as
 * globals before the page is evaluated. Two things force this design:
 *
 *  - The engine uses `instanceof Document` / `instanceof ShadowRoot`, which are per-realm.
 *    Mixing realms makes those checks fail silently and detection quietly returns nothing.
 *  - Reusing one realm across pages leaks state. `document.open()` does not reliably
 *    detach listeners a previous page's inline script registered, so a second page's
 *    handlers stack on the first page's — which flipped every checkbox twice and made a
 *    working autofill look broken. Fresh realms remove the whole class of problem.
 *
 * The engine reads globals at call time rather than at import time, so reinstalling them
 * per page is enough; the modules do not need to be re-imported.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

export const CORPUS_DIR = path.resolve(import.meta.dirname, '../../frontend/public/test-forms');

const GLOBAL_KEYS = [
  'window',
  'document',
  'navigator',
  'Node',
  'NodeList',
  'NodeFilter',
  'Element',
  'HTMLElement',
  'HTMLInputElement',
  'HTMLTextAreaElement',
  'HTMLSelectElement',
  'HTMLOptionElement',
  'HTMLIFrameElement',
  'HTMLFrameElement',
  'ShadowRoot',
  'Document',
  'DocumentFragment',
  'MutationObserver',
  'Event',
  'CustomEvent',
  'InputEvent',
  'MouseEvent',
  'PointerEvent',
  'FocusEvent',
  'KeyboardEvent',
  'DataTransfer',
  'File',
  'FileList',
  'CSS',
  'getComputedStyle',
  'customElements',
  'requestAnimationFrame',
  'cancelAnimationFrame',
] as const;

function installGlobals(window: JSDOM['window']): void {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of GLOBAL_KEYS) {
    const value = (window as unknown as Record<string, unknown>)[key];
    if (value === undefined) continue;
    try {
      target[key] = value;
    } catch {
      // Node defines some of these (notably `navigator`) as getter-only globals;
      // redefining works where assignment does not.
      Object.defineProperty(target, key, { value, configurable: true, writable: true });
    }
  }
  if (typeof (target.CSS as { escape?: unknown } | undefined)?.escape !== 'function') {
    target.CSS = { escape: (value: string) => value.replace(/([^\w-])/g, '\\$1') };
  }
  if (typeof window.Element.prototype.scrollIntoView !== 'function') {
    window.Element.prototype.scrollIntoView = function scrollIntoView(): void {
      /* no layout in jsdom */
    };
  }
}

export interface DomEnvironment {
  /** The window of the most recently loaded page. */
  window: JSDOM['window'];
  /** Build a fresh realm from a fixture page, run its inline scripts, install globals. */
  loadPage(fileName: string, url?: string): JSDOM['window'];
  /** Same, from markup held in memory rather than a file on disk. */
  loadMarkup(markup: string, url?: string): JSDOM['window'];
  html(fileName: string): string;
}

export function createDomEnvironment(): DomEnvironment {
  const html = (fileName: string): string => readFileSync(path.join(CORPUS_DIR, fileName), 'utf8');

  const env: DomEnvironment = {
    // Replaced on the first `loadPage`; the placeholder keeps the type honest.
    window: undefined as unknown as JSDOM['window'],
    html,
    loadPage(fileName: string, url = 'https://benchmark.local/'): JSDOM['window'] {
      return env.loadMarkup(html(fileName), url);
    },
    loadMarkup(markup: string, url = 'https://benchmark.local/'): JSDOM['window'] {
      const dom = new JSDOM(markup, {
        url,
        pretendToBeVisual: true,
        runScripts: 'dangerously',
      });
      installGlobals(dom.window);
      env.window = dom.window;
      return dom.window;
    },
  };

  // Install a baseline realm so modules imported before the first page still see a DOM.
  env.loadPage.call(env, 'basic-html.html');
  return env;
}

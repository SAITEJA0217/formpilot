/**
 * Dynamic form observation.
 *
 * Conditional questions, lazily rendered steps and SPA route changes all mutate the
 * DOM after the first scan. A naive implementation re-scans the whole page on every
 * mutation, which on a busy React page means hundreds of full traversals per second.
 *
 * This observer instead: filters mutations down to the ones that could affect form
 * structure, debounces them, and reports the smallest set of *regions* that changed
 * so the caller can re-detect a subtree instead of the document.
 */
import { CONTROL_SELECTOR } from '../detect/fieldDetector';

export interface MutationSummary {
  /** Controls added since the last flush. */
  addedControls: number;
  /** Controls removed since the last flush. */
  removedControls: number;
  /** Relevant attribute changes (disabled/hidden/required/step state). */
  attributeChanges: number;
  /**
   * Smallest containers covering all changes. Empty means the change was too broad
   * to localize and the caller should re-scan from the root.
   */
  regions: Element[];
  /** True when a full re-scan is the only safe option. */
  requiresFullRescan: boolean;
  /** Set when the SPA navigated without a page load. */
  urlChanged?: string;
}

export interface ObserverOptions {
  root?: Document;
  /** Quiet period before a flush. 250ms keeps typing responsive. */
  debounceMs?: number;
  /** Poll `location.href` to catch SPA navigation. Off by default. */
  watchUrl?: boolean;
  onChange: (summary: MutationSummary) => void;
}

const ATTRIBUTE_FILTER = [
  'hidden',
  'aria-hidden',
  'disabled',
  'aria-disabled',
  'required',
  'aria-required',
  'aria-expanded',
  'aria-current',
  'aria-selected',
  'style',
  'class',
];

/** Nearest container worth re-scanning: a form, section, or step panel. */
const REGION_SELECTOR = 'form, fieldset, section, [role="group"], [role="tabpanel"], [role="list"], [data-step-panel]';

function isControl(node: Node): boolean {
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  const element = node as Element;
  try {
    return element.matches(CONTROL_SELECTOR);
  } catch {
    return false;
  }
}

function countControls(node: Node): number {
  if (node.nodeType !== Node.ELEMENT_NODE) return 0;
  const element = node as Element;
  let count = isControl(element) ? 1 : 0;
  try {
    count += element.querySelectorAll(CONTROL_SELECTOR).length;
  } catch {
    // Ignore selector failures on exotic nodes.
  }
  return count;
}

function regionFor(node: Node): Element | null {
  const element =
    node.nodeType === Node.ELEMENT_NODE ? (node as Element) : (node.parentElement as Element | null);
  if (!element) return null;
  return element.closest(REGION_SELECTOR) ?? element.parentElement;
}

/** Drop regions contained by another region, leaving only the outermost ones. */
function dedupeRegions(regions: Set<Element>): Element[] {
  const list = Array.from(regions);
  return list.filter((candidate) => !list.some((other) => other !== candidate && other.contains(candidate)));
}

/**
 * Start observing. Returns a disposer; call it when the panel closes so the page is
 * left exactly as it was found.
 */
export function observeForm(options: ObserverOptions): () => void {
  const doc = options.root ?? document;
  const debounceMs = options.debounceMs ?? 250;
  if (typeof MutationObserver !== 'function' || !doc.body) {
    return () => {};
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: MutationSummary = {
    addedControls: 0,
    removedControls: 0,
    attributeChanges: 0,
    regions: [],
    requiresFullRescan: false,
  };
  let pendingRegions = new Set<Element>();
  let lastUrl = doc.location?.href ?? '';
  let urlTimer: ReturnType<typeof setInterval> | null = null;

  const reset = (): void => {
    pending = {
      addedControls: 0,
      removedControls: 0,
      attributeChanges: 0,
      regions: [],
      requiresFullRescan: false,
    };
    pendingRegions = new Set();
  };

  const flush = (): void => {
    timer = null;
    if (
      pending.addedControls === 0 &&
      pending.removedControls === 0 &&
      pending.attributeChanges === 0 &&
      !pending.urlChanged
    ) {
      reset();
      return;
    }
    const regions = dedupeRegions(pendingRegions);
    const summary: MutationSummary = {
      ...pending,
      regions,
      // Too many independent regions, or a body-level change, means rescan all.
      requiresFullRescan:
        pending.requiresFullRescan || !!pending.urlChanged || regions.length === 0 || regions.length > 8,
    };
    reset();
    options.onChange(summary);
  };

  const schedule = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  };

  const observer = new MutationObserver((records) => {
    let relevant = false;
    for (const record of records) {
      if (record.type === 'childList') {
        for (const node of Array.from(record.addedNodes)) {
          const count = countControls(node);
          if (count > 0) {
            pending.addedControls += count;
            relevant = true;
            const region = regionFor(node);
            if (region) pendingRegions.add(region);
            else pending.requiresFullRescan = true;
          }
        }
        for (const node of Array.from(record.removedNodes)) {
          const count = countControls(node);
          if (count > 0) {
            pending.removedControls += count;
            relevant = true;
            const region = regionFor(record.target);
            if (region) pendingRegions.add(region);
            else pending.requiresFullRescan = true;
          }
        }
      } else if (record.type === 'attributes') {
        const target = record.target;
        if (target.nodeType !== Node.ELEMENT_NODE) continue;
        const element = target as Element;
        // Only care when the attribute change could hide, disable or reveal fields.
        if (isControl(element) || countControls(element) > 0) {
          pending.attributeChanges += 1;
          relevant = true;
          const region = regionFor(element);
          if (region) pendingRegions.add(region);
        }
      }
    }
    if (relevant) schedule();
  });

  observer.observe(doc.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ATTRIBUTE_FILTER,
  });

  const onNavigate = (): void => {
    const current = doc.location?.href ?? '';
    if (current !== lastUrl) {
      lastUrl = current;
      pending.urlChanged = current;
      pending.requiresFullRescan = true;
      schedule();
    }
  };

  const view = doc.defaultView;
  view?.addEventListener('popstate', onNavigate);
  view?.addEventListener('hashchange', onNavigate);
  if (options.watchUrl) {
    urlTimer = setInterval(onNavigate, 1000);
  }

  return () => {
    observer.disconnect();
    if (timer !== null) clearTimeout(timer);
    if (urlTimer !== null) clearInterval(urlTimer);
    view?.removeEventListener('popstate', onNavigate);
    view?.removeEventListener('hashchange', onNavigate);
  };
}

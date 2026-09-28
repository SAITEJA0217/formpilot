/**
 * Deep DOM traversal.
 *
 * A modern form is not necessarily in one document. It can live inside open shadow
 * roots (design-system web components) or same-origin iframes (embedded form
 * builders). This module walks all three kinds of root and records where each
 * element was found so it can be re-addressed later from the top document.
 *
 * Closed shadow roots and cross-origin frames are *not* reachable, by design —
 * those are browser security boundaries. They are counted and reported so the UI
 * can tell the user what it could not see, rather than silently under-detecting.
 */

/** A root we can query: the main document, a shadow root, or a frame's document. */
export type QueryRoot = Document | ShadowRoot | Element;

export interface TraversalLocation {
  /** iframe indices from the top document; empty for the top document. */
  framePath: number[];
  /** Selectors of shadow hosts from the root, outermost first. */
  shadowPath: string[];
}

export interface DeepElement<T extends Element = Element> {
  element: T;
  /** The root the element was queried from — needed for selector scoping. */
  root: Document | ShadowRoot;
  /** Owner document, for label/`getElementById` resolution. */
  ownerDocument: Document;
  location: TraversalLocation;
}

export interface TraversalStats {
  shadowRootsTraversed: number;
  framesTraversed: number;
  /** Frames that threw on access — cross-origin, sandboxed, or not yet loaded. */
  inaccessibleFrames: number;
}

export interface TraversalOptions {
  /** Hard cap on shadow/frame nesting. Guards against pathological pages. */
  maxDepth?: number;
  /** Include same-origin iframes. */
  includeFrames?: boolean;
  /** Include open shadow roots. */
  includeShadowRoots?: boolean;
  /** Upper bound on elements returned, so a huge page cannot hang the engine. */
  limit?: number;
}

const DEFAULTS: Required<TraversalOptions> = {
  maxDepth: 6,
  includeFrames: true,
  includeShadowRoots: true,
  limit: 3000,
};

/**
 * Resolve options field by field rather than by spreading.
 *
 * `{ ...DEFAULTS, ...options }` looks equivalent but is not: a caller that forwards an
 * unset option as an explicit `undefined` (which any `options.includeFrames` pass-through
 * does) overwrites the default with `undefined`, silently disabling traversal.
 */
function resolveOptions(options: TraversalOptions): Required<TraversalOptions> {
  return {
    maxDepth: options.maxDepth ?? DEFAULTS.maxDepth,
    includeFrames: options.includeFrames ?? DEFAULTS.includeFrames,
    includeShadowRoots: options.includeShadowRoots ?? DEFAULTS.includeShadowRoots,
    limit: options.limit ?? DEFAULTS.limit,
  };
}

/** A minimal, stable descriptor for a shadow host, used to rebuild the path. */
function hostDescriptor(host: Element): string {
  const tag = host.tagName.toLowerCase();
  if (host.id) return `${tag}#${host.id}`;
  const cls = Array.from(host.classList)
    .filter((c) => c.length > 0 && c.length < 40)
    .slice(0, 2)
    .map((c) => `.${c}`)
    .join('');
  return `${tag}${cls}`;
}

/** Same-origin check that never throws. */
function frameDocument(frame: HTMLIFrameElement | HTMLFrameElement): Document | null {
  try {
    const doc = frame.contentDocument;
    if (!doc) return null;
    // Touch a property that throws on cross-origin access.
    void doc.location?.href;
    return doc;
  } catch {
    return null;
  }
}

/**
 * Collect every element matching `selector` across the document, its open shadow
 * roots and its same-origin frames.
 */
export function deepQueryAll(
  selector: string,
  root: Document | ShadowRoot,
  options: TraversalOptions = {},
): { elements: DeepElement[]; stats: TraversalStats } {
  const opts = resolveOptions(options);
  const stats: TraversalStats = { shadowRootsTraversed: 0, framesTraversed: 0, inaccessibleFrames: 0 };
  const out: DeepElement[] = [];

  const visit = (
    currentRoot: Document | ShadowRoot,
    ownerDocument: Document,
    location: TraversalLocation,
    depth: number,
  ): void => {
    if (depth > opts.maxDepth || out.length >= opts.limit) return;

    let matches: Element[] = [];
    try {
      matches = Array.from(currentRoot.querySelectorAll(selector));
    } catch {
      // An invalid selector is a programming error, not a page error — surface none.
      return;
    }
    for (const element of matches) {
      if (out.length >= opts.limit) break;
      out.push({ element, root: currentRoot, ownerDocument, location });
    }

    if (opts.includeShadowRoots) {
      // Every element in this root may host an open shadow root.
      const all = currentRoot.querySelectorAll('*');
      for (const candidate of Array.from(all)) {
        const shadow = (candidate as Element & { shadowRoot: ShadowRoot | null }).shadowRoot;
        if (!shadow) continue;
        stats.shadowRootsTraversed += 1;
        visit(
          shadow,
          ownerDocument,
          { framePath: location.framePath, shadowPath: [...location.shadowPath, hostDescriptor(candidate)] },
          depth + 1,
        );
      }
    }

    if (opts.includeFrames) {
      const frames = Array.from(currentRoot.querySelectorAll('iframe, frame')) as (
        | HTMLIFrameElement
        | HTMLFrameElement
      )[];
      frames.forEach((frame, index) => {
        const doc = frameDocument(frame);
        if (!doc) {
          stats.inaccessibleFrames += 1;
          return;
        }
        stats.framesTraversed += 1;
        visit(doc, doc, { framePath: [...location.framePath, index], shadowPath: [] }, depth + 1);
      });
    }
  };

  const ownerDoc = root instanceof Document ? root : (root.ownerDocument ?? document);
  visit(root, ownerDoc, { framePath: [], shadowPath: [] }, 0);
  return { elements: out, stats };
}

/**
 * Re-resolve a root previously described by a `TraversalLocation`, so a selector
 * captured during detection can be applied again at fill time.
 */
export function resolveRoot(
  location: TraversalLocation,
  top: Document = document,
): Document | ShadowRoot | null {
  let currentDoc: Document = top;
  for (const index of location.framePath) {
    const frames = Array.from(currentDoc.querySelectorAll('iframe, frame')) as (
      | HTMLIFrameElement
      | HTMLFrameElement
    )[];
    const frame = frames[index];
    if (!frame) return null;
    const doc = frameDocument(frame);
    if (!doc) return null;
    currentDoc = doc;
  }

  let currentRoot: Document | ShadowRoot = currentDoc;
  for (const descriptor of location.shadowPath) {
    let host: Element | null = null;
    try {
      host = currentRoot.querySelector(descriptor);
    } catch {
      host = null;
    }
    if (!host) {
      // Fall back to the first element in this root that has a shadow root.
      const candidates: Element[] = Array.from(currentRoot.querySelectorAll('*'));
      host = candidates.find((c: Element) => !!(c as Element & { shadowRoot: ShadowRoot | null }).shadowRoot) ?? null;
    }
    if (!host) return null;
    const shadow: ShadowRoot | null = (host as Element & { shadowRoot: ShadowRoot | null }).shadowRoot;
    if (!shadow) return null;
    currentRoot = shadow;
  }
  return currentRoot;
}

/**
 * Test environment shims.
 *
 * jsdom implements most of what the engine needs. The gaps below are filled with
 * minimal stand-ins so the engine exercises its real code paths instead of branching
 * on `typeof X === 'undefined'` in tests.
 */

// `CSS.escape` is used when building attribute selectors.
if (typeof globalThis.CSS === 'undefined') {
  (globalThis as unknown as { CSS: { escape(value: string): string } }).CSS = {
    escape: (value: string) => value.replace(/([^\w-])/g, '\\$1'),
  };
} else if (typeof globalThis.CSS.escape !== 'function') {
  (globalThis.CSS as unknown as { escape(value: string): string }).escape = (value: string) =>
    value.replace(/([^\w-])/g, '\\$1');
}

// jsdom has no layout engine, so `scrollIntoView` is absent. The engine guards for
// this, but defining a no-op keeps the guard from masking real failures.
if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {
    /* no layout in jsdom */
  };
}

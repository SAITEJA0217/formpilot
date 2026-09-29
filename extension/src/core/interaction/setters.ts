/**
 * Low-level value setters.
 *
 * Framework-controlled inputs (React in particular) keep their own copy of the
 * value and ignore a plain `element.value = x` assignment: React's synthetic event
 * system only notices a change when the *native* property setter runs and an
 * `input` event bubbles. The prototype-setter dance below is the standard remedy
 * and is carried over unchanged from the v1 Google Forms filler, which relied on it.
 *
 * Vue and Angular both listen for native `input`/`change`, so the same path serves
 * them; nothing here is framework-specific.
 */

type ValuedElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/**
 * Write through the native prototype setter so framework value trackers observe
 * the change, then notify listeners.
 */
export function setNativeValue(element: ValuedElement, value: string): void {
  const ownSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set;
  const prototype = Object.getPrototypeOf(element) as object;
  const prototypeSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

  if (prototypeSetter && ownSetter !== prototypeSetter) {
    prototypeSetter.call(element, value);
  } else if (ownSetter) {
    ownSetter.call(element, value);
  } else {
    element.value = value;
  }
}

/** Fire the event sequence a real edit produces, in the order browsers use. */
export function dispatchValueEvents(element: Element): void {
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

export function dispatchBlur(element: Element): void {
  element.dispatchEvent(new Event('blur', { bubbles: true }));
  element.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
}

export function focusElement(element: Element): void {
  const focusable = element as HTMLElement;
  if (typeof focusable.focus === 'function') {
    try {
      focusable.focus({ preventScroll: true });
    } catch {
      focusable.focus();
    }
    // `focus()` already fires focus/focusin; dispatching again double-notifies listeners.
    return;
  }
  element.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
}

/** Best-effort scroll; jsdom and some embedded webviews do not implement it. */
export function scrollIntoViewSafely(element: Element): void {
  const el = element as HTMLElement;
  if (typeof el.scrollIntoView !== 'function') return;
  try {
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
  } catch {
    // Non-fatal.
  }
}

/** Write text into a `contenteditable` region and notify listeners. */
export function setContentEditable(element: Element, value: string): void {
  focusElement(element);
  element.textContent = value;
  element.dispatchEvent(
    typeof InputEvent === 'function'
      ? new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' })
      : new Event('input', { bubbles: true }),
  );
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Click an element the way a user would, including pointer events. */
export function clickElement(element: Element): void {
  const el = element as HTMLElement;
  scrollIntoViewSafely(el);
  const options = { bubbles: true, cancelable: true } as const;
  if (typeof PointerEvent === 'function') {
    el.dispatchEvent(new PointerEvent('pointerdown', options));
    el.dispatchEvent(new PointerEvent('pointerup', options));
  }
  el.dispatchEvent(new MouseEvent('mousedown', options));
  el.dispatchEvent(new MouseEvent('mouseup', options));
  if (typeof el.click === 'function') {
    el.click();
  } else {
    el.dispatchEvent(new MouseEvent('click', options));
  }
}

/** Resolve after `ms`, used to let custom dropdowns render their option list. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

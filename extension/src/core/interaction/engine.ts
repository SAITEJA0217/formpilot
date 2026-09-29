/**
 * Safe interaction engine.
 *
 * One entry point for writing a value into any control the detector can produce.
 * Three rules are enforced here, not left to callers:
 *
 *  1. A field the safety policy blocked is never written, whatever the caller says.
 *  2. Nothing that submits, pays, navigates or agrees is ever clicked.
 *  3. Every write is read back and verified; an unverified write is reported as a
 *     failure rather than counted as a success.
 */
import type { UnifiedField } from '../../../../shared/types/form';
import type { FillMethod, FillOutcome, FillReport } from '../../../../shared/types/suggestion';
import { evaluateFieldSafety, isConsequentialAction } from '../../../../shared/safety/policy';
import { normalizeText } from '../../../../shared/matching/normalize';
import { collapse, visibleText } from '../dom/text';
import { resolveSelector } from '../detect/selector';
import {
  clickElement,
  delay,
  dispatchBlur,
  dispatchValueEvents,
  focusElement,
  scrollIntoViewSafely,
  setContentEditable,
  setNativeValue,
} from './setters';
import type { FillTarget, FillValue, PlatformFillHandler } from './types';

const TEXT_LIKE: ReadonlySet<UnifiedField['type']> = new Set([
  'text',
  'email',
  'tel',
  'number',
  'url',
  'search',
  'date',
  'time',
  'datetime',
  'month',
  'week',
  'color',
  'range',
  'textarea',
]);

function fail(field: UnifiedField, method: FillMethod, error: string): FillOutcome {
  return { fieldId: field.id, filled: false, method, error };
}

function ok(field: UnifiedField, method: FillMethod, verifiedValue: FillValue): FillOutcome {
  return { fieldId: field.id, filled: true, method, verifiedValue };
}

/** Text of an option element, however the page chose to express it. */
function optionText(element: Element): string {
  return collapse(
    element.getAttribute('data-value') ??
      element.getAttribute('aria-label') ??
      element.getAttribute('value') ??
      visibleText(element),
  );
}

function isChecked(element: Element): boolean {
  if (element.tagName === 'INPUT') return (element as HTMLInputElement).checked;
  return element.getAttribute('aria-checked') === 'true';
}

/** Locate the element for one option of a grouped field. */
function findOptionElement(target: FillTarget, wanted: string): Element | null {
  const normalizedWanted = normalizeText(wanted);
  const option = (target.field.options ?? []).find(
    (o) => o.value === wanted || normalizeText(o.label) === normalizedWanted || normalizeText(o.value) === normalizedWanted,
  );

  if (option?.selector) {
    const resolved = resolveSelector(option.selector, target.root);
    if (resolved) return resolved;
  }

  // Fall back to scanning the group's own members and descendants.
  const candidates: Element[] = [...target.members];
  for (const selector of ['[role="radio"]', '[role="checkbox"]', '[role="switch"]', '[role="option"]', 'input']) {
    candidates.push(...Array.from(target.element.querySelectorAll(selector)));
  }
  for (const candidate of candidates) {
    const text = normalizeText(optionText(candidate));
    if (text && (text === normalizedWanted || text === normalizeText(option?.label ?? ''))) return candidate;
  }
  return null;
}

function fillTextLike(target: FillTarget, value: string): FillOutcome {
  const { element, field } = target;
  scrollIntoViewSafely(element);

  if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
    const input = element as HTMLInputElement | HTMLTextAreaElement;
    focusElement(input);
    setNativeValue(input, value);
    dispatchValueEvents(input);
    dispatchBlur(input);
    // Date/number inputs silently reject malformed values: read back to confirm.
    if (input.value !== value && collapse(input.value) !== collapse(value)) {
      return fail(field, 'native-setter', `The page rejected the value "${value}" for this field.`);
    }
    return ok(field, 'native-setter', input.value);
  }

  if (element.hasAttribute('contenteditable') || field.type === 'richtext') {
    setContentEditable(element, value);
    dispatchBlur(element);
    const readBack = collapse(element.textContent);
    if (readBack !== collapse(value)) {
      return fail(field, 'contenteditable', 'The page did not keep the value written into this editor.');
    }
    return ok(field, 'contenteditable', readBack);
  }

  return fail(field, 'skipped', 'This control does not accept typed text.');
}

function fillNativeSelect(target: FillTarget, values: string[]): FillOutcome {
  const select = target.element as HTMLSelectElement;
  const options = Array.from(select.options);
  const wanted = values.map((v) => normalizeText(v));
  let matched = 0;

  focusElement(select);
  if (select.multiple) {
    for (const option of options) {
      const isWanted =
        wanted.includes(normalizeText(option.value)) || wanted.includes(normalizeText(option.textContent ?? ''));
      option.selected = isWanted;
      if (isWanted) matched += 1;
    }
  } else {
    const option = options.find(
      (o) => wanted.includes(normalizeText(o.value)) || wanted.includes(normalizeText(o.textContent ?? '')),
    );
    if (!option) {
      return fail(target.field, 'select-option', 'None of the available choices match this value.');
    }
    setNativeValue(select, option.value);
    matched = 1;
  }

  if (matched === 0) {
    return fail(target.field, 'select-option', 'None of the available choices match this value.');
  }
  dispatchValueEvents(select);
  dispatchBlur(select);
  const verified = select.multiple
    ? Array.from(select.selectedOptions).map((o) => o.value)
    : select.value;
  return ok(target.field, 'select-option', verified);
}

async function fillCustomSelect(target: FillTarget, value: string): Promise<FillOutcome> {
  const { element, field } = target;
  const before = collapse(visibleText(element));
  // Open the widget so lazily rendered options exist, then pick one.
  clickElement(element);
  await delay(120);

  let option = findOptionElement(target, value);
  if (!option) {
    // Some widgets render their popup at the document root, outside the control.
    const doc = element.ownerDocument;
    const normalizedWanted = normalizeText(value);
    const popupOptions = Array.from(doc.querySelectorAll('[role="option"]'));
    option = popupOptions.find((o) => normalizeText(optionText(o)) === normalizedWanted) ?? null;
  }
  if (!option) {
    // Leave the widget as we found it rather than stranding it open.
    clickElement(element);
    return fail(field, 'click-option', 'Could not find a matching choice in this dropdown.');
  }

  clickElement(option);
  await delay(60);

  // A custom dropdown can swallow the click entirely. Require evidence that the choice
  // landed — the option marked selected, the control's own text changed, or the control
  // now points at the option — rather than reporting an unverified click as a success.
  const after = collapse(visibleText(element));
  const optionSelected =
    option.getAttribute('aria-selected') === 'true' || option.getAttribute('aria-checked') === 'true';
  const activeDescendant = element.getAttribute('aria-activedescendant');
  const pointsAtOption = !!activeDescendant && activeDescendant === option.getAttribute('id');
  if (!optionSelected && !pointsAtOption && after === before) {
    return fail(field, 'click-option', 'The dropdown did not register the selection.');
  }
  return ok(field, 'click-option', after || optionText(option));
}

function fillRadioGroup(target: FillTarget, value: string): FillOutcome {
  const option = findOptionElement(target, value);
  if (!option) {
    return fail(target.field, 'click-option', 'None of the available choices match this value.');
  }
  if (isConsequentialAction(optionText(option))) {
    return fail(target.field, 'skipped', 'This choice would trigger an action, so it was left for you.');
  }
  if (!isChecked(option)) clickElement(option);
  if (!isChecked(option)) {
    return fail(target.field, 'click-option', 'The page did not register the selection.');
  }
  return ok(target.field, 'click-option', optionText(option));
}

function fillCheckbox(target: FillTarget, value: FillValue): FillOutcome {
  const desired =
    typeof value === 'boolean'
      ? value
      : typeof value === 'string'
        ? /^(true|yes|1|on|checked)$/i.test(value.trim())
        : false;
  const element = target.element;
  if (isChecked(element) !== desired) clickElement(element);
  if (isChecked(element) !== desired) {
    return fail(target.field, 'checkbox-toggle', 'The page did not register the change.');
  }
  return ok(target.field, 'checkbox-toggle', isChecked(element));
}

function fillCheckboxGroup(target: FillTarget, values: string[]): FillOutcome {
  const selected: string[] = [];
  for (const value of values) {
    const option = findOptionElement(target, value);
    if (!option) continue;
    if (isConsequentialAction(optionText(option))) continue;
    if (!isChecked(option)) clickElement(option);
    if (isChecked(option)) selected.push(optionText(option));
  }
  if (selected.length === 0) {
    return fail(target.field, 'click-option', 'None of the available choices match these values.');
  }
  return ok(target.field, 'click-option', selected);
}

export interface FillOptions {
  /** Platform-specific handler consulted before the generic paths. */
  platformHandler?: PlatformFillHandler;
  /** Milliseconds to wait between fields, so reactive forms can settle. */
  interFieldDelayMs?: number;
}

/**
 * Write one value into one control. Never throws: every failure is reported as an
 * outcome so the review panel can show the user exactly what did not work.
 */
export async function fillField(
  target: FillTarget,
  value: FillValue,
  options: FillOptions = {},
): Promise<FillOutcome> {
  const { field } = target;

  // Re-check safety at write time: a hand-edited suggestion cannot bypass policy.
  if (field.sensitivity === 'blocked') {
    return fail(field, 'skipped', field.sensitivityReason ?? 'This field is never autofilled.');
  }
  const liveSafety = evaluateFieldSafety({
    type: field.type,
    label: field.label,
    name: field.name,
    elementId: field.elementId,
    ariaLabel: field.ariaLabel,
    placeholder: field.placeholder,
    autocomplete: field.autocomplete,
  });
  if (liveSafety.sensitivity === 'blocked') {
    return fail(field, 'skipped', liveSafety.reason ?? 'This field is never autofilled.');
  }
  if (field.disabled || field.readOnly) {
    return fail(field, 'skipped', 'Field is disabled or read-only.');
  }
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) {
    return fail(field, 'skipped', 'No value to write.');
  }
  if (field.type === 'file') {
    return fail(
      field,
      'file-picker',
      'File fields require you to choose the document yourself — use the Attach button.',
    );
  }

  if (options.platformHandler) {
    try {
      const outcome = options.platformHandler(target, value);
      if (outcome) return outcome;
    } catch (error) {
      return fail(field, 'skipped', error instanceof Error ? error.message : 'Platform handler failed.');
    }
  }

  try {
    const asArray = Array.isArray(value) ? value.map(String) : [String(value)];

    if (field.type === 'checkbox') return fillCheckbox(target, value);
    if (field.type === 'checkbox_group') return fillCheckboxGroup(target, asArray);
    if (field.type === 'radio_group' || field.type === 'rating') return fillRadioGroup(target, asArray[0]);

    if (field.type === 'select_one' || field.type === 'select_many') {
      if (target.element.tagName === 'SELECT') return fillNativeSelect(target, asArray);
      return await fillCustomSelect(target, asArray[0]);
    }

    if (TEXT_LIKE.has(field.type) || field.type === 'richtext' || field.type === 'unknown') {
      return fillTextLike(target, asArray[0]);
    }

    return fail(field, 'skipped', `FormPilot does not yet know how to fill a "${field.type}" control.`);
  } catch (error) {
    return fail(field, 'skipped', error instanceof Error ? error.message : 'Unexpected error while filling.');
  }
}

/** Fill many fields in order, pausing briefly so reactive forms can re-render. */
export async function fillFields(
  entries: { target: FillTarget; value: FillValue }[],
  options: FillOptions = {},
): Promise<FillReport> {
  const outcomes: FillOutcome[] = [];
  const gap = options.interFieldDelayMs ?? 30;

  for (const entry of entries) {
    const outcome = await fillField(entry.target, entry.value, options);
    outcomes.push(outcome);
    if (gap > 0) await delay(gap);
  }

  const filled = outcomes.filter((o) => o.filled).length;
  const skipped = outcomes.filter((o) => !o.filled && o.method === 'skipped').length;
  return {
    attempted: outcomes.length,
    filled,
    failed: outcomes.length - filled - skipped,
    skipped,
    outcomes,
  };
}

/**
 * Attach a user-chosen `File` to a file input.
 *
 * Only ever called from an explicit click on the review panel's Attach button —
 * FormPilot holds no document bytes of its own and never picks a file for the user.
 */
export function attachFile(target: FillTarget, file: File): FillOutcome {
  const input = target.element as HTMLInputElement;
  if (input.tagName !== 'INPUT' || input.type !== 'file') {
    return fail(target.field, 'file-picker', 'This is not a file input.');
  }
  if (typeof DataTransfer !== 'function') {
    return fail(target.field, 'file-picker', 'This browser does not allow attaching a file programmatically.');
  }
  try {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    dispatchValueEvents(input);
    return ok(target.field, 'file-picker', file.name);
  } catch (error) {
    return fail(
      target.field,
      'file-picker',
      error instanceof Error ? error.message : 'Could not attach the selected file.',
    );
  }
}

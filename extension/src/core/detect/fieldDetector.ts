/**
 * Field detection and classification.
 *
 * Discovers every fillable control reachable from a root — native elements, ARIA
 * widgets, contenteditable regions — groups the ones that form a single logical
 * field (a radio set, a checkbox set), classifies them into the unified
 * `FieldType` vocabulary, and extracts label, options and metadata.
 *
 * Platform specifics arrive only through `DetectionHooks`; nothing in this file
 * knows about any particular site.
 */
import type { FieldOption, FieldType, UnifiedField } from '../../../../shared/types/form';
import { evaluateFieldSafety } from '../../../../shared/safety/policy';
import { deepQueryAll, type DeepElement, type TraversalStats } from '../dom/deepQuery';
import { resolveRole } from '../dom/accessibility';
import { collapse, isHiddenDeep, visibleText } from '../dom/text';
import { extractLabel } from '../dom/labels';
import { buildSelector } from './selector';
import type { DetectionHooks } from './types';

/** Everything that could plausibly hold user input. */
export const CONTROL_SELECTOR = [
  'input:not([type="hidden"]):not([type="submit"]):not([type="reset"]):not([type="button"]):not([type="image"])',
  'textarea',
  'select',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[role="textbox"]',
  '[role="searchbox"]',
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="radiogroup"]',
  '[role="radio"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="slider"]',
  '[role="spinbutton"]',
].join(', ');

/** Attribute a host page (or our own UI) can set to opt a subtree out. */
const IGNORE_ATTRIBUTE = 'data-formpilot-ignore';

export interface DetectionResult {
  fields: UnifiedField[];
  stats: TraversalStats & {
    candidatesConsidered: number;
    rejected: Record<string, number>;
  };
  /** Live element handles, kept out of the serializable schema. */
  elements: Map<string, { element: Element; root: Document | ShadowRoot; members: Element[] }>;
}

export interface DetectFieldsOptions {
  root?: Document | ShadowRoot;
  hooks?: DetectionHooks;
  includeFrames?: boolean;
  includeShadowRoots?: boolean;
  /** Prefix for generated field ids, so two forms on one page cannot collide. */
  idPrefix?: string;
}

type GroupKind = 'single' | 'radio_group' | 'checkbox_group' | 'adapter_group';

/** Types that mean "several controls, one logical field". */
const GROUPING_TYPES: ReadonlySet<FieldType> = new Set(['radio_group', 'checkbox_group', 'rating']);

interface ControlGroup {
  key: string;
  kind: GroupKind;
  primary: DeepElement;
  members: DeepElement[];
  container: Element | null;
}

function inputType(element: Element): string {
  return (element.getAttribute('type') ?? 'text').toLowerCase();
}

function isNativeInput(element: Element): boolean {
  return element.tagName === 'INPUT';
}

/** Should this control be skipped entirely? Returns a rejection reason or null. */
function rejectionReason(element: Element): string | null {
  if (element.closest(`[${IGNORE_ATTRIBUTE}]`)) return 'ignored-subtree';
  if (element.closest('#formpilot-root, formpilot-panel')) return 'own-ui';
  if (isNativeInput(element)) {
    const type = inputType(element);
    if (['hidden', 'submit', 'reset', 'button', 'image'].includes(type)) return 'non-input-type';
  }
  if (element.getAttribute('aria-hidden') === 'true') return 'aria-hidden';
  if (isHiddenDeep(element)) return 'hidden';
  return null;
}

/** Group key for native radio/checkbox sets: scope + name. */
function groupScope(element: Element, container: Element | null): string {
  if (container) {
    const id = container.getAttribute('data-formpilot-container');
    if (id) return `container:${id}`;
  }
  const form = element.closest('form');
  if (form) {
    const id = form.getAttribute('id') ?? form.getAttribute('name') ?? '';
    return `form:${id || 'anon'}`;
  }
  return 'document';
}

function classifyNative(element: Element): FieldType {
  const tag = element.tagName;
  if (tag === 'TEXTAREA') return 'textarea';
  if (tag === 'SELECT') {
    return element.hasAttribute('multiple') ? 'select_many' : 'select_one';
  }
  if (tag !== 'INPUT') return 'unknown';
  switch (inputType(element)) {
    case 'email':
      return 'email';
    case 'tel':
      return 'tel';
    case 'number':
      return 'number';
    case 'url':
      return 'url';
    case 'password':
      return 'password';
    case 'search':
      return 'search';
    case 'date':
      return 'date';
    case 'time':
      return 'time';
    case 'datetime-local':
      return 'datetime';
    case 'month':
      return 'month';
    case 'week':
      return 'week';
    case 'color':
      return 'color';
    case 'range':
      return 'range';
    case 'file':
      return 'file';
    case 'checkbox':
      return 'checkbox';
    case 'radio':
      return 'radio_group';
    default:
      return 'text';
  }
}

function classifyAria(element: Element, role: string): FieldType {
  switch (role) {
    case 'textbox':
      return element.getAttribute('aria-multiline') === 'true' ? 'textarea' : 'text';
    case 'searchbox':
      return 'search';
    case 'combobox':
    case 'listbox':
      return element.getAttribute('aria-multiselectable') === 'true' ? 'select_many' : 'select_one';
    case 'radiogroup':
      return 'radio_group';
    case 'radio':
      return 'radio_group';
    case 'checkbox':
    case 'switch':
      return 'checkbox';
    case 'slider':
      return 'range';
    case 'spinbutton':
      return 'number';
    default:
      return 'unknown';
  }
}

function classify(element: Element, role: string): FieldType {
  const editable =
    element.hasAttribute('contenteditable') && element.getAttribute('contenteditable') !== 'false';
  if (editable) {
    // An explicit role is the author telling us what the control is: a
    // `contenteditable` with `role="textbox"` is a single-line field unless it also
    // declares `aria-multiline`. Only an unannotated editable region is a rich-text
    // surface. Getting this wrong mis-types the field and then mis-matches it.
    const explicitRole = element.getAttribute('role')?.trim().split(/\s+/)[0]?.toLowerCase();
    if (explicitRole === 'textbox' || explicitRole === 'searchbox') {
      return classifyAria(element, explicitRole);
    }
    return 'richtext';
  }
  const native = element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT';
  if (native) return classifyNative(element);
  return classifyAria(element, role);
}

/** Visible text of a custom option-like element. */
function optionLabel(element: Element): string {
  return collapse(
    element.getAttribute('aria-label') ??
      element.getAttribute('data-value') ??
      element.getAttribute('title') ??
      visibleText(element),
  );
}

/** Label text shown next to a native radio/checkbox input. */
function memberLabel(element: Element): string {
  const wrapping = element.closest('label');
  if (wrapping) {
    const text = visibleText(wrapping);
    if (text) return text;
  }
  const id = element.getAttribute('id');
  if (id) {
    const root = element.getRootNode();
    const scope = root instanceof ShadowRoot || root instanceof Document ? root : element.ownerDocument;
    try {
      const forLabel = scope?.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (forLabel) {
        const text = visibleText(forLabel);
        if (text) return text;
      }
    } catch {
      // Ignore malformed ids.
    }
  }
  const aria = collapse(element.getAttribute('aria-label'));
  if (aria) return aria;
  const parentText = element.parentElement ? visibleText(element.parentElement) : '';
  return parentText;
}

function extractOptions(
  group: ControlGroup,
  root: Document | ShadowRoot,
  type: FieldType,
): FieldOption[] | undefined {
  const { primary, members } = group;
  const element = primary.element;

  if (element.tagName === 'SELECT') {
    const options = Array.from(element.querySelectorAll('option'))
      .map((option) => ({
        value: option.getAttribute('value') ?? collapse(option.textContent),
        label: collapse(option.textContent) || (option.getAttribute('value') ?? ''),
        selected: (option as HTMLOptionElement).selected,
      }))
      .filter((option) => {
        // Drop the valueless instruction row authors put first. Matched as a prefix because
        // the wording varies endlessly: "Select", "Select one", "Please Select",
        // "Choose an option", "-- none --".
        const text = option.label.trim();
        const placeholderish =
          text.length === 0 ||
          /^-+$/.test(text) ||
          /^--.*--$/.test(text) ||
          /^(please\s+)?(select|choose|pick)\b/i.test(text) ||
          /^none$/i.test(text);
        return !(option.value === '' && placeholderish);
      });
    return options.length > 0 ? options : undefined;
  }

  // A rating is a radio group whose options happen to be a scale, so it is extracted the
  // same way; without this a rating field would arrive with no choices at all.
  if (type === 'radio_group' || type === 'checkbox_group' || type === 'rating') {
    if (members.length > 0 && members.every((m) => m.element.tagName === 'INPUT')) {
      return members.map((member) => {
        const label = memberLabel(member.element);
        const value = member.element.getAttribute('value') ?? label;
        return {
          value: value || label,
          label: label || value || '',
          selected: (member.element as HTMLInputElement).checked,
          selector: buildSelector(member.element, root),
        };
      });
    }
    // ARIA widget: options are descendants of the group element.
    const optionElements = Array.from(
      element.querySelectorAll('[role="radio"], [role="checkbox"], [role="switch"], [role="option"]'),
    );
    const source = optionElements.length > 0 ? optionElements : members.map((m) => m.element);
    const options = source.map((option) => {
      const label = optionLabel(option);
      return {
        value: option.getAttribute('data-value') ?? label,
        label,
        selected: option.getAttribute('aria-checked') === 'true' || option.getAttribute('aria-selected') === 'true',
        selector: buildSelector(option, root),
      };
    });
    return options.filter((o) => o.label.length > 0).length > 0 ? options : undefined;
  }

  if (type === 'select_one' || type === 'select_many') {
    // Custom combobox/listbox: options may be inside, or in an `aria-controls` target.
    let optionElements = Array.from(element.querySelectorAll('[role="option"]'));
    if (optionElements.length === 0) {
      const controls = element.getAttribute('aria-controls') ?? element.getAttribute('aria-owns');
      if (controls) {
        for (const id of controls.split(/\s+/).filter(Boolean)) {
          try {
            const target = root.querySelector(`#${CSS.escape(id)}`);
            if (target) optionElements.push(...Array.from(target.querySelectorAll('[role="option"]')));
          } catch {
            // Ignore malformed ids.
          }
        }
      }
    }
    if (optionElements.length === 0) {
      // Google-Forms style: hidden sibling list of `[role="option"]` nodes.
      const parent = element.parentElement;
      if (parent) optionElements = Array.from(parent.querySelectorAll('[role="option"]'));
    }
    const options = optionElements
      .map((option) => {
        const label = optionLabel(option);
        return {
          value: option.getAttribute('data-value') ?? label,
          label,
          selected: option.getAttribute('aria-selected') === 'true',
          selector: buildSelector(option, root),
        };
      })
      .filter((option) => option.label.length > 0 && !/^(choose|select|please select)$/i.test(option.label));
    return options.length > 0 ? options : undefined;
  }

  return undefined;
}

function currentValueOf(element: Element, type: FieldType, options?: FieldOption[]): UnifiedField['currentValue'] {
  if (type === 'checkbox') {
    if (element.tagName === 'INPUT') return (element as HTMLInputElement).checked;
    return element.getAttribute('aria-checked') === 'true';
  }
  if (
    type === 'radio_group' ||
    type === 'checkbox_group' ||
    type === 'rating' ||
    type === 'select_one' ||
    type === 'select_many'
  ) {
    const selected = (options ?? []).filter((o) => o.selected).map((o) => o.value);
    if (type === 'select_many' || type === 'checkbox_group') return selected;
    return selected[0] ?? null;
  }
  if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
    return (element as HTMLInputElement | HTMLTextAreaElement).value || null;
  }
  if (element.hasAttribute('contenteditable')) return collapse(element.textContent) || null;
  return null;
}

/** Confidence that this really is a fillable field a user would recognize. */
function detectionConfidence(field: {
  type: FieldType;
  labelSource: UnifiedField['labelSource'];
  label: string;
}): number {
  let score = 0.5;
  switch (field.labelSource) {
    case 'aria-labelledby':
    case 'label-for':
    case 'label-wrapping':
    case 'platform-heading':
      score = 0.97;
      break;
    case 'aria-label':
      score = 0.94;
      break;
    case 'fieldset-legend':
    case 'table-header':
      score = 0.85;
      break;
    case 'preceding-text':
      score = 0.7;
      break;
    case 'placeholder':
    case 'title':
      score = 0.68;
      break;
    case 'name-attribute':
      score = 0.55;
      break;
    case 'none':
      score = 0.3;
      break;
  }
  if (field.type === 'unknown') score *= 0.6;
  if (!field.label) score = Math.min(score, 0.35);
  return Math.round(score * 100) / 100;
}

/**
 * Discover, group and describe every fillable control under `root`.
 */
export function detectFields(options: DetectFieldsOptions = {}): DetectionResult {
  const root = options.root ?? document;
  const hooks = options.hooks ?? {};
  const prefix = options.idPrefix ?? 'f';

  const { elements: candidates, stats } = deepQueryAll(CONTROL_SELECTOR, root, {
    includeFrames: options.includeFrames,
    includeShadowRoots: options.includeShadowRoots,
  });

  // Controls the generic selector cannot see, nominated by the adapter. Appended rather than
  // merged into `CONTROL_SELECTOR` so no ordinary page gains button-shaped "fields".
  if (hooks.extraControls) {
    const seen = new Set(candidates.map((candidate) => candidate.element));
    const ownerDocument = root instanceof Document ? root : (root.ownerDocument ?? document);
    for (const element of hooks.extraControls(root)) {
      if (seen.has(element)) continue;
      seen.add(element);
      candidates.push({
        element,
        root,
        ownerDocument,
        location: { framePath: [], shadowPath: [] },
      });
    }
  }

  const rejected: Record<string, number> = {};
  const reject = (reason: string): void => {
    rejected[reason] = (rejected[reason] ?? 0) + 1;
  };

  const containers = hooks.questionContainers ? hooks.questionContainers(root) : [];
  containers.forEach((container, index) => {
    if (!container.getAttribute('data-formpilot-container')) {
      container.setAttribute('data-formpilot-container', String(index));
    }
  });
  const containerFor = (element: Element): Element | null => {
    if (containers.length === 0) return null;
    // Innermost container wins.
    let best: Element | null = null;
    for (const container of containers) {
      if (container.contains(element)) {
        if (!best || best.contains(container)) best = container;
      }
    }
    return best;
  };

  // Elements that are consumed as options of an enclosing ARIA group.
  const consumed = new Set<Element>();
  for (const candidate of candidates) {
    const role = resolveRole(candidate.element);
    if (role === 'radiogroup' || role === 'listbox') {
      for (const child of Array.from(
        candidate.element.querySelectorAll('[role="radio"], [role="option"], [role="checkbox"], [role="switch"]'),
      )) {
        consumed.add(child);
      }
    }
  }

  const groups = new Map<string, ControlGroup>();
  const ordered: ControlGroup[] = [];

  for (const candidate of candidates) {
    const element = candidate.element;
    const reason = rejectionReason(element);
    if (reason) {
      reject(reason);
      continue;
    }
    if (consumed.has(element)) {
      reject('group-member');
      continue;
    }

    const role = resolveRole(element);
    const container = containerFor(element);
    const adapterType = hooks.classify?.(element, container) ?? null;
    const type = adapterType ?? classify(element, role);

    // An adapter that classifies several controls in one container as the same group type is
    // telling us they are one field. This is how button-based choice sets are grouped without
    // the generic engine knowing anything about the platform.
    if (adapterType && GROUPING_TYPES.has(adapterType) && container) {
      const key = `c${container.getAttribute('data-formpilot-container')}|adapter:${adapterType}`;
      const existing = groups.get(key);
      if (existing) {
        existing.members.push(candidate);
        continue;
      }
      const group: ControlGroup = {
        key,
        kind: 'adapter_group',
        primary: candidate,
        members: [candidate],
        container,
      };
      groups.set(key, group);
      ordered.push(group);
      continue;
    }

    // Native radio/checkbox sets and loose ARIA radio/checkbox nodes are grouped.
    const nativeRadio = isNativeInput(element) && inputType(element) === 'radio';
    const nativeCheckbox = isNativeInput(element) && inputType(element) === 'checkbox';
    const ariaOption = !isNativeInput(element) && (role === 'radio' || role === 'checkbox' || role === 'switch');

    if (nativeRadio || nativeCheckbox || ariaOption) {
      const name = element.getAttribute('name') ?? '';
      const parentKey = container
        ? `c${container.getAttribute('data-formpilot-container')}`
        : (element.parentElement ? `p${ordered.length}:${element.parentElement.tagName}` : 'root');
      // Grouping key: prefer the shared `name`, else the shared container/parent.
      const key = name
        ? `${groupScope(element, container)}|name=${name}`
        : container
          ? `${parentKey}|aria`
          : `${element.parentElement ? buildSelector(element.parentElement, candidate.root) : 'root'}|aria`;

      const existing = groups.get(key);
      if (existing) {
        existing.members.push(candidate);
        continue;
      }
      const group: ControlGroup = {
        key,
        kind: nativeRadio || role === 'radio' ? 'radio_group' : 'checkbox_group',
        primary: candidate,
        members: [candidate],
        container,
      };
      groups.set(key, group);
      ordered.push(group);
      continue;
    }

    if (type === 'unknown' && role !== 'radiogroup' && role !== 'listbox' && role !== 'combobox') {
      reject('unclassifiable');
      continue;
    }

    const group: ControlGroup = {
      key: `single:${ordered.length}`,
      kind: 'single',
      primary: candidate,
      members: [candidate],
      container,
    };
    groups.set(group.key, group);
    ordered.push(group);
  }

  const fields: UnifiedField[] = [];
  const elementMap: DetectionResult['elements'] = new Map();

  ordered.forEach((group, index) => {
    const { primary, container } = group;
    const element = primary.element;
    const role = resolveRole(element);
    let type = hooks.classify?.(element, container) ?? classify(element, role);

    if (group.kind === 'adapter_group') {
      // The adapter already decided; `classify` is authoritative here.
      type = hooks.classify?.(element, container) ?? type;
    } else if (group.kind === 'checkbox_group') {
      type = group.members.length > 1 ? 'checkbox_group' : 'checkbox';
    } else if (group.kind === 'radio_group') {
      type = 'radio_group';
    }

    const platformLabel = container && hooks.containerLabel ? hooks.containerLabel(container) : null;
    // With more than one member, the primary element is one option of a set, so its own
    // label names the choice rather than the question.
    const ignoreElementLabel = group.kind !== 'single' && group.members.length > 1;
    const label = extractLabel(element, {
      container,
      platformLabel: platformLabel?.text ?? null,
      ignoreElementLabel,
    });
    const options = hooks.options?.(element, container) ?? extractOptions(group, primary.root, type);

    const safety = evaluateFieldSafety({
      type,
      label: label.text,
      name: element.getAttribute('name') ?? undefined,
      elementId: element.getAttribute('id') ?? undefined,
      ariaLabel: element.getAttribute('aria-label') ?? undefined,
      placeholder: element.getAttribute('placeholder') ?? undefined,
      autocomplete: element.getAttribute('autocomplete') ?? undefined,
    });

    const id = `${prefix}${index}`;
    const maxLength = Number(element.getAttribute('maxlength'));
    const minLength = Number(element.getAttribute('minlength'));

    let field: UnifiedField = {
      id,
      type,
      label: label.text || undefined,
      labelSource: label.source,
      description: label.description,
      placeholder: collapse(element.getAttribute('placeholder')) || undefined,
      name: element.getAttribute('name') ?? undefined,
      elementId: element.getAttribute('id') ?? undefined,
      ariaLabel: collapse(element.getAttribute('aria-label')) || undefined,
      autocomplete: element.getAttribute('autocomplete') ?? undefined,
      required: label.required || platformLabel?.required === true,
      disabled: element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true',
      readOnly: element.hasAttribute('readonly') || element.getAttribute('aria-readonly') === 'true',
      options,
      multiple: type === 'select_many' || type === 'checkbox_group',
      currentValue: currentValueOf(element, type, options),
      selector: buildSelector(element, primary.root),
      shadowPath: primary.location.shadowPath.length > 0 ? primary.location.shadowPath : undefined,
      framePath: primary.location.framePath.length > 0 ? primary.location.framePath : undefined,
      detectionConfidence: detectionConfidence({ type, labelSource: label.source, label: label.text }),
      maxLength: Number.isFinite(maxLength) && maxLength > 0 ? maxLength : undefined,
      minLength: Number.isFinite(minLength) && minLength > 0 ? minLength : undefined,
      min: element.getAttribute('min') ?? undefined,
      max: element.getAttribute('max') ?? undefined,
      step: element.getAttribute('step') ?? undefined,
      pattern: element.getAttribute('pattern') ?? undefined,
      accept: element.getAttribute('accept') ?? undefined,
      sensitivity: safety.sensitivity,
      sensitivityReason: safety.reason,
    };

    if (hooks.refineField) field = hooks.refineField(field, element, container);

    fields.push(field);
    elementMap.set(id, {
      element,
      root: primary.root,
      members: group.members.map((m) => m.element),
    });
  });

  return {
    fields,
    stats: { ...stats, candidatesConsidered: candidates.length, rejected },
    elements: elementMap,
  };
}

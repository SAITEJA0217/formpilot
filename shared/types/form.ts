/**
 * Unified Form Schema.
 *
 * Every supported platform — Google Forms, a plain HTML `<form>`, a React-rendered
 * widget tree — is normalized into exactly these structures before any matching,
 * AI reasoning, or filling happens. Nothing downstream of the adapter layer is
 * allowed to know which platform produced the form.
 *
 * These types are intentionally serializable: a `UnifiedForm` crosses the
 * content-script → service-worker → HTTP boundary as JSON.
 */

/** Platforms the adapter registry can recognize. Recognition != verified support. */
export type FormPlatform =
  | 'google-forms'
  | 'microsoft-forms'
  | 'typeform'
  | 'jotform'
  | 'surveymonkey'
  | 'generic-html'
  | 'unknown';

/** Normalized control kind. Maps many DOM shapes onto one vocabulary. */
export type FieldType =
  | 'text'
  | 'email'
  | 'tel'
  | 'number'
  | 'url'
  | 'password'
  | 'search'
  | 'date'
  | 'time'
  | 'datetime'
  | 'month'
  | 'week'
  | 'textarea'
  | 'richtext'
  | 'select_one'
  | 'select_many'
  | 'radio_group'
  | 'checkbox_group'
  | 'checkbox'
  | 'file'
  | 'range'
  | 'rating'
  | 'color'
  | 'hidden'
  | 'unknown';

/** Which extraction strategy produced the label. Recorded for evaluation. */
export type LabelSource =
  | 'aria-labelledby'
  | 'aria-label'
  | 'label-for'
  | 'label-wrapping'
  | 'platform-heading'
  | 'fieldset-legend'
  | 'table-header'
  | 'preceding-text'
  | 'placeholder'
  | 'title'
  | 'name-attribute'
  | 'none';

/**
 * How much care a field demands. `blocked` fields are never autofilled;
 * `sensitive` fields are filled only after explicit per-field confirmation.
 */
export type FieldSensitivity = 'normal' | 'sensitive' | 'blocked';

export interface FieldOption {
  /** Machine value submitted for this option. */
  value: string;
  /** Human-visible text. */
  label: string;
  selected?: boolean;
  /** Selector for the clickable element, when the option is a custom control. */
  selector?: string;
}

/** Address of a nested browsing context, as iframe indices from the top document. */
export type FramePath = number[];

export interface UnifiedField {
  /** Stable id within the parent form. */
  id: string;
  type: FieldType;
  label?: string;
  labelSource: LabelSource;
  description?: string;
  placeholder?: string;
  name?: string;
  elementId?: string;
  ariaLabel?: string;
  /** Raw `autocomplete` token, the single strongest deterministic signal. */
  autocomplete?: string;
  required: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  /** Present for option-bearing controls: select, radio group, checkbox group. */
  options?: FieldOption[];
  /** True when more than one option may be chosen. */
  multiple?: boolean;
  currentValue?: string | string[] | boolean | null;
  /** Selector that re-resolves this control inside its frame/shadow context. */
  selector: string;
  /** Chain of shadow-host selectors from the document root, outermost first. */
  shadowPath?: string[];
  /** Empty/absent means the top-level document. */
  framePath?: FramePath;
  /** Nearby visible text used as a weak semantic signal. */
  context?: string;
  sectionId?: string;
  stepIndex?: number;
  /** 0..1 — how sure the detector is that this is a real, fillable field. */
  detectionConfidence: number;
  maxLength?: number;
  minLength?: number;
  min?: string;
  max?: string;
  step?: string;
  pattern?: string;
  /** `accept` attribute of a file input. */
  accept?: string;
  sensitivity: FieldSensitivity;
  /** Reason a field is `blocked`/`sensitive`, shown to the user verbatim. */
  sensitivityReason?: string;
  /** Adapter-specific extras. Never read by the generic engine. */
  platformMeta?: Record<string, string>;
}

export interface FormSection {
  id: string;
  title?: string;
  description?: string;
  stepIndex?: number;
  fieldIds: string[];
}

export interface FormMetadata {
  detectedAt: number;
  /** Adapter that produced this form, for reproducibility. */
  adapter: string;
  /** Controls considered before filtering. */
  candidatesConsidered: number;
  /** Controls rejected, keyed by reason. */
  rejected: Record<string, number>;
  /** Cross-origin frames that could not be read. Surfaced to the user. */
  inaccessibleFrames: number;
  shadowRootsTraversed: number;
  isMultiStep: boolean;
  currentStep?: number;
  totalSteps?: number;
  documentTitle?: string;
  /** Human-readable, user-facing notes (unsupported widget, skipped frame, ...). */
  warnings: string[];
  /** Wall-clock milliseconds spent detecting. */
  durationMs?: number;
}

export interface UnifiedForm {
  id: string;
  platform: FormPlatform;
  url: string;
  origin: string;
  title?: string;
  fields: UnifiedField[];
  sections: FormSection[];
  metadata: FormMetadata;
}

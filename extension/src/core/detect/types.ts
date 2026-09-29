/**
 * Hooks an adapter may implement to inject platform knowledge into the generic
 * detector. Declared here, separately from the adapter registry, so the detector
 * never imports the adapters (which would be a cycle).
 */
import type { FieldOption, FieldType, UnifiedField } from '../../../../shared/types/form';

export interface DetectionHooks {
  /**
   * Elements that each wrap exactly one logical question. Supplying these lets the
   * detector group controls and read authoritative question text, which is what
   * makes platforms like Google Forms parse cleanly.
   */
  questionContainers?(root: Document | ShadowRoot): Element[];
  /** Authoritative question text for a container. */
  containerLabel?(container: Element): { text: string; required?: boolean } | null;
  /** Override the classification of a control. */
  classify?(element: Element, container: Element | null): FieldType | null;
  /** Provide options the generic extractor cannot see (e.g. collapsed dropdowns). */
  options?(element: Element, container: Element | null): FieldOption[] | null;
  /**
   * Controls the generic selector cannot know about.
   *
   * The generic `CONTROL_SELECTOR` deliberately excludes `<button>`, because on an ordinary
   * page every Submit and Next button would become a candidate field. Some platforms
   * nevertheless build their answer choices out of buttons (Typeform does), so an adapter can
   * nominate those elements here instead of the generic selector being widened for everyone.
   *
   * Nominated elements are assumed to live in the root they were queried from; they are not
   * traversed into shadow roots or frames.
   */
  extraControls?(root: Document | ShadowRoot): Element[];
  /** Last-chance adjustment of a completed field. */
  refineField?(field: UnifiedField, element: Element, container: Element | null): UnifiedField;
}

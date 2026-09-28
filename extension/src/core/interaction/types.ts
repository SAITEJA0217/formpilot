/**
 * Shared interaction types. Declared apart from the engine so adapters can supply
 * platform-specific fill handlers without importing the engine (and vice versa).
 */
import type { UnifiedField } from '../../../../shared/types/form';
import type { FillOutcome } from '../../../../shared/types/suggestion';

export interface FillTarget {
  field: UnifiedField;
  /** The primary control element. */
  element: Element;
  /** Root the element lives in, for option re-resolution. */
  root: Document | ShadowRoot;
  /** All members of a grouped field (radio/checkbox sets). */
  members: Element[];
}

export type FillValue = string | string[] | boolean | null;

/** Returns null to defer to the generic engine. */
export type PlatformFillHandler = (
  target: FillTarget,
  value: FillValue,
) => FillOutcome | null;

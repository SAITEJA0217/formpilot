/** The adapter contract. */
import type { FormPlatform } from '../../../../shared/types/form';
import type { DetectionHooks } from '../detect/types';
import type { PlatformFillHandler } from '../interaction/types';

export interface AdapterContext {
  url: string;
  document: Document;
  platform: FormPlatform;
}

export interface FormAdapter extends DetectionHooks {
  /** Stable identifier recorded in `FormMetadata.adapter` for reproducibility. */
  id: string;
  platform: FormPlatform;
  /** Higher wins when several adapters match. The generic adapter is 0. */
  priority: number;
  matches(ctx: AdapterContext): boolean;
  /** Platform-specific fill for widgets the generic engine cannot drive. */
  fillField?: PlatformFillHandler;
  /**
   * Support status, surfaced in the UI and in the compatibility matrix.
   *
   * - `verified`          — exercised against the real product or a faithful fixture,
   *                         with passing automated tests *and* a real-browser run.
   * - `experimental`      — implemented against a **reproduction** of the platform's
   *                         published markup, with passing tests against that
   *                         reproduction, but never validated against the live product.
   * - `generic-fallback`  — no dedicated adapter; the generic engine will attempt it.
   *
   * `experimental` exists because a reproduction can be wrong in ways no local test can
   * detect. Calling that `verified` would be a false claim.
   */
  supportStatus: 'verified' | 'experimental' | 'generic-fallback';
  /**
   * Where the adapter's DOM knowledge came from, and what has actually been run against
   * it. Printed into the compatibility matrix verbatim so a reader can judge the claim.
   */
  provenance?: string;
}

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
   * Human-readable support status, surfaced in the UI and the compatibility
   * matrix. Never claim `verified` without a passing test.
   */
  supportStatus: 'verified' | 'generic-fallback';
}

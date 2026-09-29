/**
 * Public surface of the universal form engine.
 *
 * Everything exported here is DOM-dependent but `chrome.*`-free, so the whole
 * engine runs unchanged under jsdom in tests and in the benchmark runner.
 */
export { normalizeForm } from './normalize/formNormalizer';
export type { NormalizedForm, NormalizeOptions } from './normalize/formNormalizer';

export { detectFields, CONTROL_SELECTOR } from './detect/fieldDetector';
export type { DetectionResult, DetectFieldsOptions } from './detect/fieldDetector';
export { assignSections, detectSteps, detectFormTitle } from './detect/formDetector';
export { buildSelector, resolveSelector } from './detect/selector';
export type { DetectionHooks } from './detect/types';

export { deepQueryAll, resolveRoot } from './dom/deepQuery';
export { extractLabel, findSectionTitle } from './dom/labels';
export { computeAccessibleName, computeAccessibleDescription, resolveRole, isRequired } from './dom/accessibility';
export { collapse, visibleText, nearbyText, precedingText, isHidden, isHiddenDeep } from './dom/text';

export { detectPlatform } from './platform/detect';
export { selectAdapter, ADAPTERS, RECOGNIZED_WITHOUT_ADAPTER, genericHtmlAdapter, googleFormsAdapter } from './adapters/registry';
export type { FormAdapter, AdapterContext } from './adapters/types';

export { fillField, fillFields, attachFile } from './interaction/engine';
export type { FillOptions } from './interaction/engine';
export type { FillTarget, FillValue, PlatformFillHandler } from './interaction/types';

export { observeForm } from './observe/observer';
export type { MutationSummary, ObserverOptions } from './observe/observer';

export {
  createSession,
  applySession,
  recordDecision,
  recordOutcomes,
  noteStep,
  sessionMatchesForm,
  sessionMetrics,
  fieldKey,
} from './session/formSession';
export type { FormSessionState, SessionCorrection } from './session/formSession';

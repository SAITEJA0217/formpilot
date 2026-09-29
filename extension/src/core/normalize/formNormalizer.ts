/**
 * Form normalization: DOM → `UnifiedForm`.
 *
 * This is the boundary of the DOM layer. Everything above it (matching, AI,
 * review, research metrics) operates on the serializable schema only, which is why
 * the same pipeline can run in a browser tab, a service worker and a test runner.
 */
import type { UnifiedForm } from '../../../../shared/types/form';
import { detectFields, type DetectionResult } from '../detect/fieldDetector';
import { assignSections, detectFormTitle, detectSteps } from '../detect/formDetector';
import { detectPlatform } from '../platform/detect';
import { selectAdapter, type FormAdapter } from '../adapters/registry';

export interface NormalizeOptions {
  root?: Document | ShadowRoot;
  /** Override adapter selection. Used by tests and the benchmark runner. */
  adapter?: FormAdapter;
  includeFrames?: boolean;
  includeShadowRoots?: boolean;
  /** Overrides `location.href`, which jsdom does not always reflect. */
  href?: string;
}

export interface NormalizedForm {
  form: UnifiedForm;
  adapter: FormAdapter;
  /** Live element handles for the interaction engine. Not serializable. */
  elements: DetectionResult['elements'];
}

let formCounter = 0;

/** Detect and normalize every fillable field reachable from `root` into one form. */
export function normalizeForm(options: NormalizeOptions = {}): NormalizedForm {
  const started = Date.now();
  const root = options.root ?? document;
  const doc = root instanceof Document ? root : (root.ownerDocument ?? document);
  const href = options.href ?? doc.location?.href ?? '';

  const platformDetection = detectPlatform(href, doc);
  const selection = options.adapter
    ? { adapter: options.adapter, fallback: false, note: undefined }
    : selectAdapter({ url: href, document: doc, platform: platformDetection.platform });
  const adapter = selection.adapter;

  const detection = detectFields({
    root,
    hooks: adapter,
    includeFrames: options.includeFrames,
    includeShadowRoots: options.includeShadowRoots,
  });

  const { sections, byField } = assignSections(detection.fields, detection.elements);
  const steps = detectSteps(root);

  const fields = detection.fields.map((field) => ({
    ...field,
    sectionId: byField.get(field.id),
    stepIndex: steps.currentStep,
  }));

  const warnings: string[] = [];
  if (selection.note) warnings.push(selection.note);
  if (detection.stats.inaccessibleFrames > 0) {
    warnings.push(
      `${detection.stats.inaccessibleFrames} embedded frame(s) could not be read because they are on a different origin. Fields inside them must be filled manually.`,
    );
  }
  if (steps.isMultiStep) {
    warnings.push(
      steps.totalSteps
        ? `This looks like a multi-step form (${steps.currentStep ?? '?'} of ${steps.totalSteps}). Only the current step is visible to FormPilot.`
        : 'This looks like a multi-step form. Only the current step is visible to FormPilot.',
    );
  }
  const unlabelled = fields.filter((f) => !f.label).length;
  if (unlabelled > 0) {
    warnings.push(`${unlabelled} field(s) have no readable label and will need manual review.`);
  }
  // A label recovered only from a `name` attribute or surrounding text is weak evidence.
  // Saying so is more honest than presenting those matches with the same air of certainty.
  const weaklyLabelled = fields.filter((f) => f.label && f.detectionConfidence <= 0.6).length;
  if (weaklyLabelled > 0) {
    warnings.push(
      `${weaklyLabelled} field(s) are labelled only by their attributes or nearby text, so their matches are less reliable.`,
    );
  }

  formCounter += 1;
  let origin = '';
  try {
    origin = href ? new URL(href).origin : '';
  } catch {
    origin = '';
  }

  const form: UnifiedForm = {
    id: `form_${formCounter}`,
    platform: platformDetection.platform,
    url: href,
    origin,
    title: detectFormTitle(root) || undefined,
    fields,
    sections,
    metadata: {
      detectedAt: started,
      adapter: adapter.id,
      candidatesConsidered: detection.stats.candidatesConsidered,
      rejected: detection.stats.rejected,
      inaccessibleFrames: detection.stats.inaccessibleFrames,
      shadowRootsTraversed: detection.stats.shadowRootsTraversed,
      isMultiStep: steps.isMultiStep,
      currentStep: steps.currentStep,
      totalSteps: steps.totalSteps,
      documentTitle: doc.title || undefined,
      warnings,
      durationMs: Date.now() - started,
    },
  };

  return { form, adapter, elements: detection.elements };
}

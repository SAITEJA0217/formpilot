/** Aggregate suggestions into the counts the popup and review header display. */
import type { UnifiedForm } from '../types/form';
import type { FieldSuggestion } from '../types/suggestion';
import type { FormSummary } from '../messaging/messages';

export function summarize(form: UnifiedForm, suggestions: FieldSuggestion[]): FormSummary {
  let ready = 0;
  let needsReview = 0;
  let manual = 0;
  let blocked = 0;
  let noData = 0;
  for (const s of suggestions) {
    switch (s.status) {
      case 'ready':
        ready += 1;
        break;
      case 'needs_review':
        needsReview += 1;
        break;
      case 'manual':
        manual += 1;
        break;
      case 'blocked':
        blocked += 1;
        break;
      case 'no_data':
        noData += 1;
        break;
      case 'needs_document':
        needsReview += 1;
        break;
    }
  }
  return {
    formId: form.id,
    platform: form.platform,
    title: form.title,
    url: form.url,
    fieldsDetected: suggestions.length,
    ready,
    needsReview,
    manual,
    blocked,
    noData,
    isMultiStep: form.metadata.isMultiStep,
    currentStep: form.metadata.currentStep,
    totalSteps: form.metadata.totalSteps,
    warnings: form.metadata.warnings,
  };
}

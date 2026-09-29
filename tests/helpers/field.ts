/** Terse constructors for schema objects, so tests read as intent not boilerplate. */
import type { FieldOption, FieldType, FormSection, UnifiedField, UnifiedForm } from '../../shared/types/form';

let counter = 0;

export function field(partial: Partial<UnifiedField> & { type?: FieldType }): UnifiedField {
  counter += 1;
  return {
    id: partial.id ?? `f${counter}`,
    type: partial.type ?? 'text',
    labelSource: partial.labelSource ?? 'label-for',
    required: partial.required ?? false,
    selector: partial.selector ?? `#f${counter}`,
    detectionConfidence: partial.detectionConfidence ?? 0.95,
    sensitivity: partial.sensitivity ?? 'normal',
    ...partial,
  };
}

export function options(...labels: string[]): FieldOption[] {
  return labels.map((label) => ({ value: label, label }));
}

export function form(fields: UnifiedField[], sections: FormSection[] = []): UnifiedForm {
  return {
    id: 'form_test',
    platform: 'generic-html',
    url: 'https://example.test/apply',
    origin: 'https://example.test',
    title: 'Test form',
    fields,
    sections,
    metadata: {
      detectedAt: Date.now(),
      adapter: 'generic-html@1',
      candidatesConsidered: fields.length,
      rejected: {},
      inaccessibleFrames: 0,
      shadowRootsTraversed: 0,
      isMultiStep: false,
      warnings: [],
    },
  };
}

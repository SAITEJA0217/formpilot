import { describe, expect, it } from 'vitest';
import { CONCEPTS } from '../../shared/ontology/concepts';
import {
  BLOCKED_CONCEPT_IDS,
  conceptForAutocomplete,
  getConcept,
  GENERATIVE_CONCEPT_IDS,
  INDEXED_CONCEPTS,
  isBlockedConcept,
  isGenerativeConcept,
} from '../../shared/ontology';
import { normalizeText } from '../../shared/matching/normalize';

describe('ontology integrity', () => {
  it('has unique concept ids', () => {
    const ids = CONCEPTS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every concept a label, human path, value type and policy', () => {
    for (const concept of CONCEPTS) {
      expect(concept.label, concept.id).toBeTruthy();
      expect(concept.humanPath, concept.id).toBeTruthy();
      expect(concept.valueType, concept.id).toBeTruthy();
      expect(['allow', 'confirm', 'never'], concept.id).toContain(concept.policy);
    }
  });

  it('gives every concept at least one alias that survives normalization', () => {
    for (const indexed of INDEXED_CONCEPTS) {
      expect(indexed.normalizedAliases.length, indexed.def.id).toBeGreaterThan(0);
      for (const alias of indexed.normalizedAliases) {
        expect(alias, indexed.def.id).toBe(normalizeText(alias));
      }
    }
  });

  it('compiles every regex pattern', () => {
    for (const indexed of INDEXED_CONCEPTS) {
      expect(indexed.compiledPatterns.length).toBe(indexed.def.patterns?.length ?? 0);
    }
  });

  it('routes every never-autofill concept to the blocked resolver', () => {
    for (const id of BLOCKED_CONCEPT_IDS) {
      expect(getConcept(id)?.def.resolver, id).toBe('blocked');
      expect(isBlockedConcept(id)).toBe(true);
    }
    expect(BLOCKED_CONCEPT_IDS.length).toBeGreaterThanOrEqual(6);
  });

  it('marks long-form concepts as generative', () => {
    expect(GENERATIVE_CONCEPT_IDS).toContain('freeform.motivation');
    expect(isGenerativeConcept('freeform.self_introduction')).toBe(true);
    expect(isGenerativeConcept('person.email')).toBe(false);
  });
});

describe('conceptForAutocomplete', () => {
  it('maps standard tokens to concepts', () => {
    expect(conceptForAutocomplete('given-name')?.def.id).toBe('person.first_name');
    expect(conceptForAutocomplete('family-name')?.def.id).toBe('person.last_name');
    expect(conceptForAutocomplete('email')?.def.id).toBe('person.email');
    expect(conceptForAutocomplete('tel')?.def.id).toBe('person.phone');
    expect(conceptForAutocomplete('postal-code')?.def.id).toBe('address.postal_code');
    expect(conceptForAutocomplete('bday')?.def.id).toBe('person.date_of_birth');
  });

  it('ignores section and billing prefixes', () => {
    expect(conceptForAutocomplete('shipping given-name')?.def.id).toBe('person.first_name');
    expect(conceptForAutocomplete('section-work email')?.def.id).toBe('person.email');
  });

  it('returns nothing for off/on and unknown tokens', () => {
    expect(conceptForAutocomplete('off')).toBeUndefined();
    expect(conceptForAutocomplete('on')).toBeUndefined();
    expect(conceptForAutocomplete('not-a-token')).toBeUndefined();
    expect(conceptForAutocomplete(undefined)).toBeUndefined();
  });

  it('maps payment tokens to blocked concepts', () => {
    expect(conceptForAutocomplete('cc-number')?.def.policy).toBe('never');
    expect(conceptForAutocomplete('cc-csc')?.def.policy).toBe('never');
  });
});

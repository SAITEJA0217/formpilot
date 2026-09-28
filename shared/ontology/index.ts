/**
 * Ontology access layer: indexing, pattern compilation, autocomplete lookup.
 *
 * `concepts.ts` is pure data; this module gives it the derived structures the
 * matcher needs, computed once at module load.
 */
import { CONCEPTS, BLOCKED_CONCEPT_IDS } from './concepts';
import type { AutofillPolicy, ConceptDef, ConceptValueType } from './concepts';
import { normalizeText, tokenSet } from '../matching/normalize';

export { CONCEPTS, BLOCKED_CONCEPT_IDS };
export type { ConceptDef, ConceptValueType, AutofillPolicy };

/** A concept plus the derived forms the matcher compares against. */
export interface IndexedConcept {
  def: ConceptDef;
  /** Aliases after level-1 normalization. */
  normalizedAliases: string[];
  /** Level-2 token sets for each alias, index-aligned with `normalizedAliases`. */
  aliasTokens: Set<string>[];
  compiledPatterns: RegExp[];
  normalizedNegatives: string[];
  normalizedContextBoost: string[];
  autocompleteTokens: Set<string>;
}

function indexConcept(def: ConceptDef): IndexedConcept {
  const normalizedAliases = def.aliases.map((a) => normalizeText(a)).filter((a) => a.length > 0);
  return {
    def,
    normalizedAliases,
    aliasTokens: normalizedAliases.map((a) => tokenSet(a)),
    compiledPatterns: (def.patterns ?? []).map((p) => new RegExp(p, 'i')),
    normalizedNegatives: (def.negative ?? []).map((n) => normalizeText(n)).filter(Boolean),
    normalizedContextBoost: (def.contextBoost ?? []).map((c) => normalizeText(c)).filter(Boolean),
    autocompleteTokens: new Set((def.autocomplete ?? []).map((a) => a.toLowerCase())),
  };
}

export const INDEXED_CONCEPTS: readonly IndexedConcept[] = CONCEPTS.map(indexConcept);

const BY_ID = new Map<string, IndexedConcept>(INDEXED_CONCEPTS.map((c) => [c.def.id, c]));

export function getConcept(id: string): IndexedConcept | undefined {
  return BY_ID.get(id);
}

export function getConceptDef(id: string): ConceptDef | undefined {
  return BY_ID.get(id)?.def;
}

/**
 * `autocomplete` may carry section/billing prefixes (`shipping given-name`).
 * Only the final token identifies the concept.
 */
export function conceptForAutocomplete(value: string | undefined): IndexedConcept | undefined {
  if (!value) return undefined;
  const tokens = value.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return undefined;
  const last = tokens[tokens.length - 1];
  if (last === 'off' || last === 'on') return undefined;
  for (const concept of INDEXED_CONCEPTS) {
    if (concept.autocompleteTokens.has(last)) return concept;
  }
  return undefined;
}

export function isBlockedConcept(id: string | undefined): boolean {
  return !!id && BLOCKED_CONCEPT_IDS.includes(id);
}

/** Concepts whose value is expected to come from an LLM rather than a lookup. */
export const GENERATIVE_CONCEPT_IDS: readonly string[] = CONCEPTS.filter((c) => c.generative).map(
  (c) => c.id,
);

export function isGenerativeConcept(id: string | undefined): boolean {
  return !!id && GENERATIVE_CONCEPT_IDS.includes(id);
}

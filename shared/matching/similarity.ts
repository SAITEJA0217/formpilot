/**
 * String and token similarity metrics.
 *
 * All functions return 0..1 and are symmetric unless documented otherwise.
 * Kept dependency-free and deterministic so experiment runs are reproducible.
 */

/** Character bigrams of a string with spaces removed. */
function bigrams(input: string): string[] {
  const compact = input.replace(/\s+/g, '');
  if (compact.length < 2) return compact.length === 1 ? [compact] : [];
  const out: string[] = [];
  for (let i = 0; i < compact.length - 1; i += 1) out.push(compact.slice(i, i + 2));
  return out;
}

/** Sørensen–Dice coefficient over character bigrams. Good for typos/short text. */
export function diceCoefficient(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  if (a === b) return 1;
  const aGrams = bigrams(a);
  const bGrams = bigrams(b);
  if (aGrams.length === 0 || bGrams.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const g of aGrams) counts.set(g, (counts.get(g) ?? 0) + 1);
  let intersection = 0;
  for (const g of bGrams) {
    const c = counts.get(g) ?? 0;
    if (c > 0) {
      counts.set(g, c - 1);
      intersection += 1;
    }
  }
  return (2 * intersection) / (aGrams.length + bGrams.length);
}

/** F1 over token sets: balances precision and recall of shared tokens. */
export function tokenSetF1(a: Iterable<string>, b: Iterable<string>): number {
  const setA = a instanceof Set ? a : new Set(a);
  const setB = b instanceof Set ? b : new Set(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const t of setA) if (setB.has(t)) shared += 1;
  if (shared === 0) return 0;
  const precision = shared / setA.size;
  const recall = shared / setB.size;
  return (2 * precision * recall) / (precision + recall);
}

/**
 * Asymmetric: how completely `needle`'s tokens appear in `haystack`.
 * Used for alias-in-label detection ("first name" inside "your first name").
 */
export function tokenContainment(needle: Iterable<string>, haystack: Iterable<string>): number {
  const setNeedle = needle instanceof Set ? needle : new Set(needle);
  const setHay = haystack instanceof Set ? haystack : new Set(haystack);
  if (setNeedle.size === 0) return 0;
  let shared = 0;
  for (const t of setNeedle) if (setHay.has(t)) shared += 1;
  return shared / setNeedle.size;
}

/** True when `phrase` occurs in `text` on whole-word boundaries. */
export function containsPhrase(text: string, phrase: string): boolean {
  if (!text || !phrase) return false;
  const padded = ` ${text} `;
  return padded.includes(` ${phrase} `);
}

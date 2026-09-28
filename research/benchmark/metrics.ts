/**
 * Metric definitions.
 *
 * Every number the harness reports is computed here, from an explicit confusion count.
 * Nothing is estimated, smoothed or carried over between runs.
 */

export interface ConfusionCounts {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
}

export interface PrecisionRecallF1 {
  precision: number;
  recall: number;
  f1: number;
  support: number;
  counts: ConfusionCounts;
}

/** Precision, recall and F1 from raw counts. Undefined ratios are reported as 0. */
export function prf1(counts: ConfusionCounts): PrecisionRecallF1 {
  const { truePositives: tp, falsePositives: fp, falseNegatives: fn } = counts;
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1, support: tp + fn, counts };
}

export function sumCounts(all: ConfusionCounts[]): ConfusionCounts {
  return all.reduce<ConfusionCounts>(
    (acc, c) => ({
      truePositives: acc.truePositives + c.truePositives,
      falsePositives: acc.falsePositives + c.falsePositives,
      falseNegatives: acc.falseNegatives + c.falseNegatives,
    }),
    { truePositives: 0, falsePositives: 0, falseNegatives: 0 },
  );
}

export interface AccuracyCounts {
  correct: number;
  incorrect: number;
  total: number;
}

export function accuracy(counts: AccuracyCounts): number {
  return counts.total === 0 ? 0 : counts.correct / counts.total;
}

/** Mean of a numeric series; 0 for an empty series. */
export function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

/** Sample standard deviation; 0 for fewer than two values. */
export function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((acc, value) => acc + (value - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

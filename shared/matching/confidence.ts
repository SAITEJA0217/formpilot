/**
 * Confidence banding.
 *
 * Thresholds are data, not constants baked into call sites, because the research
 * harness sweeps them. Defaults follow the product spec: >=0.90 high, 0.70–0.89
 * medium, <0.70 low.
 */
import type { ConfidenceBand } from '../types/suggestion';

export interface ConfidenceThresholds {
  /** Inclusive lower bound of the `high` band. */
  high: number;
  /** Inclusive lower bound of the `medium` band. */
  medium: number;
}

export const DEFAULT_THRESHOLDS: ConfidenceThresholds = { high: 0.9, medium: 0.7 };

export function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function bandFor(
  confidence: number,
  thresholds: ConfidenceThresholds = DEFAULT_THRESHOLDS,
): ConfidenceBand {
  const c = clampConfidence(confidence);
  if (c >= thresholds.high) return 'high';
  if (c >= thresholds.medium) return 'medium';
  return 'low';
}

/**
 * Overall confidence is the product of *understanding* the field and *having*
 * a usable value for it. A perfect mapping onto an empty profile slot is not
 * a confident answer.
 */
export function combineConfidence(matchConfidence: number, valueConfidence: number): number {
  return clampConfidence(clampConfidence(matchConfidence) * clampConfidence(valueConfidence));
}

/** 0..1 → 0..100, for display only. */
export function toPercent(confidence: number): number {
  return Math.round(clampConfidence(confidence) * 100);
}

/** Legacy v1 answers carried 0..100 integers. */
export function fromPercent(percent: number | undefined | null): number {
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return 0;
  return clampConfidence(percent > 1 ? percent / 100 : percent);
}

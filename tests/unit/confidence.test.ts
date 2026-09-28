import { describe, expect, it } from 'vitest';
import {
  bandFor,
  clampConfidence,
  combineConfidence,
  DEFAULT_THRESHOLDS,
  fromPercent,
  toPercent,
} from '../../shared/matching/confidence';

describe('bandFor', () => {
  it('uses the documented default thresholds', () => {
    expect(DEFAULT_THRESHOLDS).toEqual({ high: 0.9, medium: 0.7 });
    expect(bandFor(1)).toBe('high');
    expect(bandFor(0.9)).toBe('high');
    expect(bandFor(0.899)).toBe('medium');
    expect(bandFor(0.7)).toBe('medium');
    expect(bandFor(0.699)).toBe('low');
    expect(bandFor(0)).toBe('low');
  });

  it('honours custom thresholds', () => {
    const strict = { high: 0.98, medium: 0.9 };
    expect(bandFor(0.95, strict)).toBe('medium');
    expect(bandFor(0.99, strict)).toBe('high');
    expect(bandFor(0.8, strict)).toBe('low');
  });
});

describe('combineConfidence', () => {
  it('multiplies understanding by data availability', () => {
    expect(combineConfidence(1, 1)).toBe(1);
    expect(combineConfidence(1, 0)).toBe(0);
    expect(combineConfidence(0.9, 0.9)).toBeCloseTo(0.81, 10);
  });

  it('never returns a value outside 0..1', () => {
    expect(combineConfidence(2, 2)).toBe(1);
    expect(combineConfidence(-1, 0.5)).toBe(0);
  });

  it('demotes a perfect match against missing data below the high band', () => {
    expect(bandFor(combineConfidence(1, 0.5))).not.toBe('high');
  });
});

describe('clamping and percentage helpers', () => {
  it('treats any non-finite value as no confidence, never as full confidence', () => {
    // Deliberately fails safe: a NaN or Infinity leaking out of arithmetic must not
    // become a high-confidence autofill.
    expect(clampConfidence(Number.NaN)).toBe(0);
    expect(clampConfidence(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampConfidence(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(bandFor(Number.NaN)).toBe('low');
  });

  it('clamps finite out-of-range values into 0..1', () => {
    expect(clampConfidence(1.4)).toBe(1);
    expect(clampConfidence(-0.4)).toBe(0);
  });

  it('round-trips percentages', () => {
    expect(toPercent(0.84)).toBe(84);
    expect(toPercent(1)).toBe(100);
    expect(fromPercent(84)).toBeCloseTo(0.84, 10);
    expect(fromPercent(0.84)).toBeCloseTo(0.84, 10);
    expect(fromPercent(undefined)).toBe(0);
  });
});

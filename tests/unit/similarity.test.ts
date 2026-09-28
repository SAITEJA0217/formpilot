import { describe, expect, it } from 'vitest';
import {
  containsPhrase,
  diceCoefficient,
  tokenContainment,
  tokenSetF1,
} from '../../shared/matching/similarity';

describe('diceCoefficient', () => {
  it('is 1 for identical strings and 0 when nothing is shared', () => {
    expect(diceCoefficient('email', 'email')).toBe(1);
    expect(diceCoefficient('email', 'xyzq')).toBe(0);
  });

  it('scores near-identical strings highly', () => {
    expect(diceCoefficient('graduation', 'graduaton')).toBeGreaterThan(0.8);
  });

  it('handles empty inputs without throwing', () => {
    expect(diceCoefficient('', '')).toBe(1);
    expect(diceCoefficient('a', '')).toBe(0);
  });

  it('is symmetric', () => {
    expect(diceCoefficient('first name', 'name first')).toBeCloseTo(
      diceCoefficient('name first', 'first name'),
      10,
    );
  });
});

describe('tokenSetF1', () => {
  it('is 1 for equal sets', () => {
    expect(tokenSetF1(['first', 'name'], ['name', 'first'])).toBe(1);
  });

  it('penalises extra tokens on either side', () => {
    const partial = tokenSetF1(['first', 'name'], ['first', 'name', 'legal']);
    expect(partial).toBeGreaterThan(0.7);
    expect(partial).toBeLessThan(1);
  });

  it('is 0 with no overlap', () => {
    expect(tokenSetF1(['email'], ['phone'])).toBe(0);
  });

  it('treats two empty sets as identical', () => {
    expect(tokenSetF1([], [])).toBe(1);
    expect(tokenSetF1(['a'], [])).toBe(0);
  });
});

describe('tokenContainment', () => {
  it('measures how completely the needle appears in the haystack', () => {
    expect(tokenContainment(['first', 'name'], ['your', 'first', 'name', 'please'])).toBe(1);
    expect(tokenContainment(['first', 'name'], ['name'])).toBe(0.5);
    expect(tokenContainment([], ['name'])).toBe(0);
  });
});

describe('containsPhrase', () => {
  it('matches on whole-word boundaries only', () => {
    expect(containsPhrase('your first name here', 'first name')).toBe(true);
    expect(containsPhrase('classname', 'name')).toBe(false);
    expect(containsPhrase('company name', 'name')).toBe(true);
    expect(containsPhrase('', 'name')).toBe(false);
  });
});

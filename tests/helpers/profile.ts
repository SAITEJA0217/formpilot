/**
 * Profile fixtures.
 *
 * `TEST_PROFILE` is the benchmark profile, imported rather than copied so a test and a
 * benchmark run can never disagree about what the profile contains.
 */
import type { ExtendedUserProfile } from '../../shared/types/profile';
import { BENCHMARK_PROFILE } from '../../research/benchmark/profile';

export const TEST_PROFILE: Partial<ExtendedUserProfile> = BENCHMARK_PROFILE;

/** A profile with nothing in it, for the "no data" paths. */
export const EMPTY_PROFILE: Partial<ExtendedUserProfile> = { userId: 'empty' };

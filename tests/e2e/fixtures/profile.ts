/**
 * The profile used by every end-to-end run.
 *
 * Imported from the benchmark profile rather than copied, so a Chrome run, a jsdom test
 * and a benchmark run all use byte-identical input. All values are synthetic.
 */
export { BENCHMARK_PROFILE as E2E_PROFILE } from '../../../research/benchmark/profile';

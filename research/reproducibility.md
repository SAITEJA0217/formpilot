# Reproducibility

Everything below runs offline, needs no API key, and is deterministic.

## Environment

* Node 22 (verified on v22.22.2). Node 20+ should work; nothing uses a 22-only API.
* npm 10+.
* No API key required for tests or the benchmark. A key is needed only to exercise the live AI
  path, which no reported number depends on.

## From a clean checkout

```bash
git clone <repo> && cd formpilot

# Three packages, three installs. The root package owns the test runner and the benchmark.
npm install
npm --prefix extension install
npm --prefix frontend install

npm run typecheck:all     # root (shared + tests + research), extension, frontend
npm test                  # 343 tests across 22 files
npm run bench             # writes research/benchmark/results/{latest.json,latest.md}
npm run build:extension   # dist/ + dist/injected/universal.js
npm run lint              # frontend eslint
```

## Determinism

The benchmark is deterministic by construction:

* **No network, no model.** Fields routed to a model are scored on the routing decision.
* **One fixed profile**, `research/benchmark/profile.ts`, imported by the test helpers too, so a
  test and a benchmark run cannot disagree about the input.
* **Stable tie-breaking.** Candidate concepts sort by score, then by their position in the ontology
  table, so equal scores always order the same way.
* **Fresh jsdom realm per page**, so no page's state or event listeners can affect the next. The
  earlier single-realm version was not deterministic across orderings — that bug is described in
  `research/benchmark/domEnv.ts`.
* **Timings are the one non-deterministic output.** `detectMsMean` and its standard deviation vary
  between runs and machines; treat them as relative costs, not benchmarks.

Two consecutive runs on the same checkout produce byte-identical `latest.md` apart from the
timestamp and the timing lines.

## What each command produces

| Command | Output |
|---|---|
| `npm test` | pass/fail per file; 343 tests currently pass |
| `npm run bench` | console summary, `results/latest.json` (full per-field records), `results/latest.md` (report with every breakdown table) |
| `npm run typecheck:all` | no output on success |
| `npm run build:extension` | `extension/dist/` — MV3 bundle plus `dist/injected/universal.js` at a fixed path |

`results/latest.json` contains one record per evaluated field: page, category, label, field type,
label source, expected and predicted concept, expected and predicted disposition, expected and
proposed value, the value read back from the DOM, confidence, band, and whether a model was
involved. Every aggregate in the Markdown report can be recomputed from it.

## Reproducing a single case

```bash
npx vitest run tests/integration/google-forms.test.ts   # the Google Forms regression suite
npx vitest run tests/unit/matcher.test.ts               # matcher behaviour, 46 cases
npx vitest run -t "Company Email"                       # one assertion by name
```

To inspect one page's behaviour directly, add a file under `research/benchmark/` that imports
`./domEnv`, calls `loadPage`, and then dynamically imports the engine — the import order matters,
because the engine reads realm-bound globals that `createDomEnvironment` installs.

## Versions pinned at the time of the reported run

| Component | Version |
|---|---|
| FormPilot | 2.0.0 |
| Node | v22.22.2 |
| Vitest | 3.2.7 |
| jsdom | 26.x |
| TypeScript | 5.7 (root/frontend), 6.0 (extension) |
| Vite | 8.1 |
| Next.js | 16.2.9 |

## Changing the evaluation

* **Thresholds:** `DEFAULT_THRESHOLDS` in `shared/matching/confidence.ts`, or pass
  `thresholds` to `buildSuggestions`. A sweep needs only a loop around `evaluatePage`.
* **Ontology:** `shared/ontology/concepts.ts` is pure data and can be serialized into an
  experiment record for diffing between runs.
* **Signal weights:** `SOURCE_FACTORS` and `SIGNAL_WEIGHTS` in `shared/matching/matcher.ts`, with
  the gates and bonuses beside them. An ablation is a matter of zeroing entries.
* **Corpus:** add a page and a ground-truth file; see [test-dataset.md](./test-dataset.md).

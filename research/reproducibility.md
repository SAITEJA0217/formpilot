# Reproducibility

Everything below runs offline, needs no API key, and is deterministic. The end-to-end suite needs
a Chromium binary; everything else needs only Node.

## Environment

* Node 22 (verified on v22.22.2). Node 20+ should work; nothing uses a 22-only API.
* npm 10+.
* Chromium for the end-to-end suite. `npx playwright install chromium` fetches one; if the
  environment already provides a binary, set `executablePath` in `tests/e2e/fixtures/extension.ts`
  (it defaults to `/opt/pw-browsers/chromium`, which is where this container keeps 141.0.7390.37).
* No API key required for anything reported. A key would be needed to exercise a real model, and
  **no reported number depends on one** — the AI path is exercised against a labelled deterministic
  stub, and the routing study counts model calls without making them.

## From a clean checkout

```bash
git clone <repo> && cd formpilot

# Three packages, three installs. The root package owns the test runner and the benchmark.
npm install
npm --prefix extension install
npm --prefix frontend install

npm run typecheck:all     # root (shared + tests + research), extension, frontend
npm test                  # 536 assertions across 29 files
npm run test:safety       # 121 of those, safety invariants only — its own CI job
npm run build:extension   # dist/ + dist/injected/universal.js
npm run lint              # frontend eslint

# Research studies. Each rewrites its own results/{latest.json,latest.md}.
npm run bench             # 17 page states, 120 labelled fields
npm run study:matching    # 69 matching cases: P/R/F1, threshold sweep, ablation
npm run study:routing      # deterministic-only vs deterministic-plus-model
npm run study:performance # scaling from 10 to 500 fields

# End-to-end, in a real browser. Needs the extension and the framework apps built first.
npm run build:apps        # React 19, Vue 3, Angular 18 bundles for tests/e2e/apps/dist
npx playwright test       # 38 specs in Chromium; starts its own Next dev server
```

Order matters in two places: `npx playwright test` reads `extension/dist/`, so
`npm run build:extension` must have run, and it serves `tests/e2e/apps/dist/`, so
`npm run build:apps` must have run. Both are wired as explicit steps in
`.github/workflows/ci.yml` rather than as implicit `pre` hooks, so a missing build fails loudly
instead of silently testing a stale bundle.

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
| `npm test` | pass/fail per file; 536 assertions currently pass |
| `npm run test:safety` | 121 assertions; a failure here is a security regression, not a failing feature |
| `npm run bench` | console summary, `results/latest.json` (full per-field records), `results/latest.md` (report with every breakdown table) |
| `npm run study:matching` | console report plus `research/matching/results/{latest.json,latest.md}`; per-concept confusion counts, sweep rows, ablation rows |
| `npm run study:routing` | console report plus `research/routing/results/`; per-mode totals, per-page rows, and every field the model would be asked about, by name |
| `npm run study:performance` | console table plus `research/performance/results/`; mean ± sd per stage per size |
| `npm run typecheck:all` | no output on success |
| `npm run build:extension` | `extension/dist/` — MV3 bundle plus `dist/injected/universal.js` at a fixed path |
| `npm run build:apps` | `tests/e2e/apps/dist/` — three framework bundles and their HTML shells |
| `npx playwright test` | 38 specs; prints in-browser latency; artifacts and screenshots land in `tests/e2e/.artifacts/` on failure |

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

## Determinism of the end-to-end suite

Less deterministic than the studies, and the reasons are worth knowing:

* **Serial, one worker.** Each spec needs the test server on port 3000 — the origin the shipped
  manifest trusts — so two specs cannot run concurrently without colliding. `fullyParallel: false`,
  `workers: 1`.
* **A fresh Chromium profile per worker**, under `tests/e2e/.artifacts/chrome-profile-w<n>`, which
  is gitignored and rewritten on every run.
* **Tab resolution is by focus, not by URL.** Without the `tabs` permission, which FormPilot
  deliberately does not request, Chrome hides a tab's URL for origins outside
  `host_permissions`. The harness focuses the page and reads the active tab, which is what the
  popup itself does under `activeTab`. A unique nonce is still stamped into each URL and verified
  whenever Chrome will reveal it.
* **Latency figures vary between machines.** `performance.spec.ts` prints them and asserts only
  the *shape* — that per-field cost does not blow up with size — because a wall-clock threshold is
  a property of the runner, not of the engine.
* **No retries.** `retries: 0`, so a flake is visible as a failure rather than hidden by a re-run.

## Fixed inputs

One profile, `research/benchmark/profile.ts`, is imported by the unit tests, the integration tests,
every study and the end-to-end fixtures. A test and a benchmark run cannot disagree about the
input because there is only one copy of it. All its values are synthetic.

The end-to-end suite seeds that profile through the shipped dashboard bridge — the real
`window.postMessage` handshake — rather than writing to `chrome.storage` directly, so the
permission and sync paths are exercised rather than bypassed.

## Things that will not reproduce, and why

* **Any number about a live hosted platform.** The network policy here blocks all five. Running
  this checkout on an unrestricted network would let the experimental adapters be validated
  properly; that is the single highest-value thing an outside reproducer can do.
* **Any number about generated answer quality.** Needs a provider key. With one set, the AI path
  runs, but nothing in `research/` currently scores its output — that harness does not exist.
* **Any number about human behaviour.** Needs participants.

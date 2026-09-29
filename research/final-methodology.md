# Final methodology

How every number in this repository was produced, and which of the three corpora it came from. The
distinction between them is the single most important thing to carry into reading any result.

| | |
| --- | --- |
| **Software version** | FormPilot 2.0.0 |
| **Configuration freeze** | commit `6e01e8e`, 2026-09-29T04:51:10Z |
| **Date** | 2026-09-29 |
| **Environment** | Node v22.22.2, jsdom 26, Chromium 141.0.7390.37, one shared cloud container |

## Three corpora, three strengths of claim

| Corpus | Size | Who wrote the inputs | Who set the ground truth | What a good score means |
| --- | --- | --- | --- | --- |
| **Benchmark** (`research/benchmark/dataset/`) | 17 page states, 120 fields | this project | this project | the engine still does what its author expected — a regression guard |
| **Matching** (`research/matching/labels.json`) | 69 cases | this project | this project | nothing; it scored 65/69, three defects were fixed, it is now a regression suite |
| **Held-out** (`research/heldout/corpus.json`) | 658 controls, 134 files | **134 unrelated authors** | **the WHATWG HTML specification** | genuine evidence of accuracy within the ontology's scope |

Only the third supports a research claim. The first two are engineering instruments, and both are
labelled as such wherever they appear.

## Held-out corpus construction

The procedure, in the order it was carried out:

1. **Sampling.** One GitHub code search per WHATWG `autocomplete` token, `language:HTML`, results
   taken in the order GitHub returned them. Nine tokens, 138 files. No file was inspected before
   being added and none was dropped for being inconvenient. The manifest records every file with the
   query that found it and its rank in the results.
2. **Extraction.** Each file fetched from `raw.githubusercontent.com` and parsed. One record per
   control carrying a recognised `autocomplete` token: label, `name`, `id`, `placeholder`, `type`,
   `required`, `aria-label`, provenance. 134 of 138 files contributed 658 controls with 299 distinct
   labels.
3. **Ground truth.** Each record's expected concept is the concept its own token denotes, per the
   specification's autofill-field table. The token→concept map is declared in `fetch.mjs` rather than
   read from the ontology, so ground truth cannot drift when the ontology changes.
4. **Withholding.** The `autocomplete` attribute is removed before any method sees the field. The
   task is to infer from a stranger's label the concept that stranger's own attribute declares.
5. **Split.** Grouped by file so no author's markup spans two splits; SHA-256 of the file path modulo
   100; 40% development, 20% validation, 40% held-out. Nothing hand-placed.

Only extracted metadata is stored, never the source files, so no third-party code is redistributed.

### Label resolution is independent of the engine

The extractor resolves labels using only the four mechanisms a browser itself honours — `label[for]`,
a wrapping `<label>`, `aria-label`, `aria-labelledby` — and deliberately does **not** call
`extension/src/core/dom/labels.ts`. Sharing the resolver would hide a label-resolution bug, because
both sides would make the same mistake.

## Configuration freeze

The matching configuration was frozen before the held-out harness was first run, and the SHA-256 of
all seven files that determine matching behaviour was recorded. They were re-checked after the run
and were unchanged:

```
a11f390d3d097fa2  shared/ontology/concepts.ts      caebde3baff90cf1  shared/matching/matcher.ts
28c0b0094202eb3c  shared/matching/normalize.ts     dfae775da1039ceb  shared/matching/similarity.ts
0bf2297a085b7d9d  shared/matching/confidence.ts    bfa27e03a32583c5  shared/matching/router.ts
1c0eb3360b3e0366  shared/safety/policy.ts
```

Nothing was tuned in response to the held-out results. Four missed refusals and several accuracy
gaps were found; all are recorded in `security-audit.md` and `held-out-evaluation.md` and **left
unfixed**, because patching against a held-out set converts it into a training set. Fixing them
requires a fresh corpus.

## Decisions declared before results were seen

Recorded because the value of a held-out evaluation lies entirely in these being fixed in advance:

1. Grouped split by file, deterministic hash, 40/20/40.
2. Nothing filtered — non-Latin labels and unlabelled controls stay in.
3. Refusal scored as a class: 72 credential and payment controls whose ground truth is refusal.
4. Macro averages over a fixed gold concept set, identical for every method, so no method can shrink
   its own denominator by answering less.
5. Strata declared up front: Latin / non-Latin / unlabelled / must-refuse.

## Metric definitions

Over the held-out set, per method:

- **Accuracy** = (correct concept + correct refusal) / all records. A refusal is correct when the
  record's token is a credential or payment token and the method named no concept.
- **Precision / recall / F1** per concept from explicit true-positive, false-positive and
  false-negative counts, then **macro-averaged** over the 18 gold concepts. Refusals are not a gold
  concept, so a safety improvement moves accuracy and not F1 — which is why both are always reported.
- **Wrong concept**: a concept was named and it was not the expected one. Counts as a false positive
  for the named concept and a false negative for the expected one.
- **Declined when answerable**: no concept named on a record that had one. A false negative only.
- **Missed refusal**: a concept named on a must-refuse record. A false positive only.

Full definitions for the benchmark's own metrics are in `evaluation-metrics.md`.

## Known biases and how each is handled

| Bias | Direction | Handling |
| --- | --- | --- |
| Third-party `autocomplete` attributes are sometimes wrong | **understates** accuracy | stated as a lower bound; not quantified, because judging which attributes are mistaken would put this project's judgement back into the ground truth |
| The concept inventory is this project's | unmeasurable | a field FormPilot models no concept for cannot appear, since it would carry no token either; the evaluation measures accuracy *within* scope and says nothing about coverage of a real form |
| Corpus skews toward forms whose authors bothered with `autocomplete` | likely **overstates** | such authors probably write better labels too; unquantified and stated |
| Non-Latin labels fail | understates the aggregate | kept in and reported as a declared stratum rather than dropped |
| One container, no CPU pinning | timings only | standard deviations reported; differences below them are not differences |
| Every document written by the agent that wrote the code | unknown | every claim names the command or file that substantiates it |

## Reproduction

```bash
npm install && npm --prefix extension install && npm --prefix frontend install
npm run typecheck:all
npm test                      # 536 assertions, 29 files
npm run test:safety           # 121 of those, its own CI job
npm run bench                 # synthetic corpus, regression guard
npm run study:matching        # regression suite, post-hoc — read its README first
npm run study:routing         # routing decisions, hybrid vs always-ask
npm run study:performance     # jsdom scaling curve
npm run heldout:fetch         # re-fetch the third-party corpus
npm run study:heldout         # the held-out evaluation
npm run build:extension && npm run build:apps
npx playwright test           # 42 specs, Chromium 141
./research/platform-probe/probe.sh   # whether the five platforms are reachable
```

`heldout:fetch` depends on `raw.githubusercontent.com` and on the upstream repositories still
existing. `corpus.json` is committed so the evaluation reproduces exactly even if upstream changes;
re-fetching produces a *new* corpus, which would need a fresh freeze.

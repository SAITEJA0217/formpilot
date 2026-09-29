# Final results

Every measured number, its source, and what it does and does not support. Ordered by how much weight
it can carry.

| | |
| --- | --- |
| **Software version** | FormPilot 2.0.0 |
| **Configuration freeze** | commit `6e01e8e`, 2026-09-29T04:51:10Z |
| **Date** | 2026-09-29 |
| **Environment** | Node v22.22.2, jsdom 26, Chromium 141.0.7390.37, one shared cloud container |

## Tier 1 — independent evidence

The only results here whose inputs and ground truth this project did not author.

**Dataset**: held-out split of `research/heldout/corpus.json` — 307 form controls from 55 HTML files
by unrelated authors. **Ground truth**: each file's own `autocomplete` attribute, per the WHATWG HTML
specification, withheld from every method. **Procedure**: `npm run study:heldout`.

| Measure | Value |
| --- | --- |
| Accuracy | **82.1%** (223 correct concepts + 29 correct refusals of 307) |
| Macro precision | 80.4% |
| Macro recall | 69.3% |
| Macro F1 | **73.1%** |
| Wrong concept | 31 |
| Declined when answerable | 20 |
| Missed refusals | 4 of 33 must-refuse controls |

Strongest concepts: `person.email` 98.9 F1 (n=43), `person.phone` 98.4 (n=30), `person.last_name`
97.9 (n=24). Weakest: `links.portfolio` and `person.middle_name` 0.0 (n=3 each), `address.full` 56.3
(n=12, 45% precision).

**82.1% is a lower bound.** Some third-party `autocomplete` attributes are themselves wrong — one
source labels a field "Education" with `organization-title` — and that noise counts against
FormPilot. It is not quantified, because deciding which attributes are mistaken would put this
project's judgement back into the ground truth.

### Baselines, same set

| Method | Accuracy | Macro F1 |
| --- | --- | --- |
| A exact label | 44.0% | 41.3% |
| B exact + metadata | 72.3% | 68.9% |
| C substring | 75.6% | 71.8% |
| D token similarity | 74.9% | 72.9% |
| **FormPilot** | **75.9%** | **73.1%** |

Matching only; the safety policy is excluded so the comparison is of strategies. **FormPilot's margin
over plain substring matching is 1.3 F1 points.** Its distinguishable advantage is calibration: 31
wrong answers against baseline D's 39, and 20 abstentions against 10.

### Ablation, same set

| Configuration | Accuracy | Macro F1 | Missed refusals |
| --- | --- | --- | --- |
| label only | 51.5% | 52.9% | 16 |
| + metadata | 74.3% | 72.5% | 29 |
| + control type | 73.9% | 72.5% | 30 |
| + confidence floor | 75.9% | 73.1% | 24 |
| + ambiguity guard | 75.9% | 73.1% | 23 |
| + safety policy | **82.1%** | 73.1% | **4** |

Metadata is worth +22.8 accuracy points — more than every scoring refinement combined. Control type
is worth −0.4 here. The ambiguity guard is worth 0.0 on both metrics and converts 8 confident errors
into 9 abstentions. The safety policy is worth +6.2 and 19 refusals.

## Tier 2 — real-browser behaviour

Executed against the built extension in Chromium 141, so these are facts about running software, but
on pages this project wrote.

| Measure | Value | Procedure |
| --- | --- | --- |
| End-to-end specs passing | **42 / 42** | `npx playwright test` |
| Total preparation, 10 fields | 146 ms | `performance.spec.ts`, median of 3 |
| Total preparation, 250 fields | 660 ms | as above |
| Per-field cost, 10 → 250 fields | 8.80 → 2.20 ms | fixed injection cost amortising |
| Page heap growth, 10 → 250 fields | 2.2 → 4.4 MiB | sublinear; no leak signature |

Covered by those specs: the full workflow from install to a verified write; controlled-component
writes reaching framework state in React 19, Vue 3, Angular 18 and Next.js 16 and surviving a
re-render; dynamic forms, multi-step wizards, nested open shadow roots, a closed shadow root, a
same-origin iframe and a genuinely cross-origin one; a Google Forms reproduction including its
clickable-`div` submit control; the AI path against a labelled stub.

## Tier 3 — engineering instruments

Correct, useful, and **not** evidence of generality. Both corpora were written by the agent that
wrote the engine.

| Measure | Value | What it means |
| --- | --- | --- |
| Unit + integration assertions | **536 / 536** | no regression |
| Safety assertions | **121 / 121** | no regression; mutation-tested |
| Typechecks | 3 / 3 clean | — |
| Benchmark detection / mapping / routing | 100% | the engine does what its author expected |
| Benchmark autofill | 84 / 84 | as above |
| Benchmark safety violations | **0** | over a corpus including a page of only sensitive fields |
| Fields resolved without a model | 89.2% of 120 | benchmark denominator |
| Matching study | 69 / 69 | **post-hoc**; scored 65/69 first, three defects fixed, now a regression suite |

## Tier 4 — cost proxies

Real measurements of what the system *would* send. No model was called.

| Measure | Hybrid routing | Always ask the model |
| --- | --- | --- |
| Fields sent to a model | 12 of 109 | 97 of 109 |
| Batched requests | 9 | 12 |
| Request payload | 17.2 KiB | 41.4 KiB |

Hybrid sends **12.4% of the fields and 41.4% of the bytes**. Payload is the honest cost proxy
available: provider pricing is per token against a price list this environment cannot see, so no
currency figure is reported.

## Not measured

| | Why |
| --- | --- |
| Any live hosted platform | all five denied at CONNECT; probe output in `platform-evaluation.md` |
| Generated answer quality, grounding faithfulness, hallucination rate | no provider, no API key |
| AI path latency and monetary cost | same |
| Acceptance, correction, rejection rate; completion time | **no human participants**; see `human-evaluation.md` |
| Coverage of a real form beyond the ontology | a field with no concept carries no `autocomplete` token either, so it cannot appear in the held-out set |
| Firefox, Safari | untested; Safari needs a wrapper that does not exist here |
| Statistical significance of any difference | no confidence intervals computed; 307 records |

## Open defects, in priority order

1. **Four missed refusals on real payment markup.** `CC Name (Full name as given on the payment
   card)` → `person.full_name`; `CC Exp Year` → `experience.years_of_experience`. A pre-existing gap
   in the phrase list that only independent data surfaced. **Deliberately not fixed**, because the
   configuration was frozen before the held-out run and patching against that set would destroy the
   only independent measurement the project has. The fix is small and known — see `security-audit.md`
   — and needs a fresh corpus to measure.
2. **Non-Latin labels at 50.1 macro F1** against 72.1 for Latin. The ontology, abbreviation table and
   stopword list are English-only. A scope boundary, now with a number.
3. **Address composition.** `address.full` 45% precision, `address.line1` 54% recall. The largest
   single error cluster: the label "Address" alone, three times.
4. **`links.portfolio` and `person.middle_name` at zero F1**, on three records each. Too little
   support to be meaningful, but zero is zero.

## Claims this repository does not make

- Not that FormPilot supports every website. It supports the architectures in
  `compatibility-matrix.md` and falls back to a generic engine elsewhere, with page-dependent results.
- Not 100% accuracy. The independently measured figure is 82.1%. Every 100% here is a synthetic
  regression guard and is labelled as one.
- Not state-of-the-art. No literature review has been done and no comparison against published
  systems exists. The four baselines are re-implementations written for this harness.
- Not universal compatibility, full compatibility, or "works everywhere".
- Not any human-evaluation result. No human data exists.

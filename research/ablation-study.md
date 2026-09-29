# Ablation study

Six configurations of the same engine, one frozen held-out set, adding one mechanism at a time.

| | |
| --- | --- |
| **Dataset** | held-out split, 307 controls from 55 third-party HTML files |
| **Ground truth** | each file's own `autocomplete` token (WHATWG HTML spec); withheld from every configuration |
| **Procedure** | `npm run study:heldout` |
| **Metric** | accuracy over all records; macro F1 over the same 18 gold concepts throughout |
| **Date** | 2026-09-29 |
| **Software version** | FormPilot 2.0.0, commit `6e01e8e` (frozen before the first run) |

## Configurations

| | What is added | What the matcher can see |
| --- | --- | --- |
| 1 | label only | the visible label |
| 2 | + metadata | plus `name`, `id`, `placeholder`, `aria-label` |
| 3 | + control type | plus the input's own `type` |
| 4 | + confidence floor | declines below the commitment threshold (0.45) |
| 5 | + ambiguity guard | also declines when the top two candidates are within 0.08 |
| 6 | + safety policy | the shipped pipeline: policy refuses a field before matching runs |

Tiers 1–3 vary the *input*; 4–6 add *decision* mechanisms on the same input.

**One honest note on tier 3.** The corpus is fragments of real pages, not whole forms, so it carries
no section headings. FormPilot's context signal has nothing to read, and this tier measures the
control-type signal instead. It is labelled "control type" rather than "context" for that reason.
Section context remains unmeasured on independent data.

## Result

| Configuration | Accuracy | Macro F1 | Wrong | Declined | Missed refusals |
| --- | --- | --- | --- | --- | --- |
| 1 label only | 51.5% | 52.9% | 27 | 106 | 16 |
| 2 + metadata | 74.3% | 72.5% | 39 | 11 | 29 |
| 3 + control type | 73.9% | 72.5% | 39 | 11 | 30 |
| 4 + confidence floor | 75.9% | 73.1% | 38 | 12 | 24 |
| 5 + ambiguity guard | 75.9% | 73.1% | 31 | 20 | 23 |
| 6 + safety policy | **82.1%** | 73.1% | 31 | 20 | **4** |

## What each component actually contributes

**Metadata: +22.8 accuracy points, +19.6 F1.** By far the largest single contribution. A third of
real-world controls carry no usable label at all — 136 of 658 in this corpus — and for those the
`name` or `id` attribute is the only signal there is. Any autofiller that reads only labels forfeits
a fifth of the form.

**Control type: −0.4 accuracy, 0.0 F1.** Slightly harmful, and the honest reading is that it does
nothing here. It costs one more missed refusal (29 → 30) because a `type="text"` payment field looks
ordinary. On the synthetic corpus the type signal helps; on this one it does not. It is retained
because it is load-bearing elsewhere — it is what stops a phone concept landing on a
`contenteditable` — but this evaluation gives it no support.

**Confidence floor: +2.0 accuracy, +0.6 F1, and 5 fewer missed refusals.** Modest and real. Its
value is mostly in refusals: a weak match on a credential field falls below the floor and is
declined.

**Ambiguity guard: 0.0 accuracy, 0.0 F1 — and 8 wrong answers become 9 abstentions.** This is the
most interesting row in the table. Judged on accuracy the guard is worthless. Judged on what it
does, it converts confident errors into admitted uncertainty, which for a human-in-the-loop system
is the trade the whole design is built around. Phase 2's self-authored study reported the guard as
contributing *nothing*; on independent data it is still invisible to F1 but visibly changes the
error profile. Both facts belong in the record.

**Safety policy: +6.2 accuracy, and missed refusals collapse from 23 to 4.** The single largest
correctness contribution after metadata, and it comes from refusing to answer rather than from
answering better — macro F1 does not move at all, because refusals are not a gold concept. 19 of 33
real credential and payment controls are caught by the policy that the matcher alone would have
answered.

## The overall shape

Accuracy climbs 51.5% → 82.1%, and **F1 climbs only 52.9% → 73.1%, entirely between tiers 1 and 4.**
Everything after the confidence floor improves the system without improving its F1, because what it
improves is when the system declines to answer. A single-metric evaluation would conclude the last
two mechanisms are dead weight. They are not; the metric is just blind to them.

## What this does not establish

- No confidence intervals. 307 records, and differences under a couple of points should be read as
  noise.
- Tier 3 does not measure section context, only control type — see the note above.
- The tiers are cumulative, so an interaction between two mechanisms cannot be separated from either
  one alone.
- Every configuration shares the same 50-concept ontology. The ontology itself is not ablated, so
  none of these numbers says how much of the performance is the vocabulary rather than the matching.

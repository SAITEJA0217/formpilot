# Baseline comparison

Five methods, one held-out set, the same records for every method.

| | |
| --- | --- |
| **Dataset** | held-out split, 307 controls from 55 third-party HTML files |
| **Ground truth** | each file's own `autocomplete` token (WHATWG HTML spec); withheld from all methods |
| **Procedure** | `npm run study:heldout` |
| **Metric** | accuracy over all records; macro P/R/F1 over the same 18 gold concepts for every method |
| **Date** | 2026-09-29 |
| **Software version** | FormPilot 2.0.0, commit `6e01e8e` (frozen before the first run) |

## Methods

| | Method | What it does |
| --- | --- | --- |
| **A** | Exact label | the normalized label must equal one of a concept's aliases exactly |
| **B** | Exact + metadata | as A, but also over `aria-label`, `name`, `id` and `placeholder` |
| **C** | Substring | longest alias contained in any of that metadata wins |
| **D** | Semantic | token-set F1 and character-bigram similarity against aliases, best score, no gates |
| — | **FormPilot** | weighted multi-signal scoring, type gates, negatives, context bonus, commitment threshold, ambiguity guard |

All five draw candidates from the same 50-concept ontology, so the comparison isolates the *matching
strategy*, not the vocabulary. Baseline D is deliberately the strongest thing a competent implementer
builds without FormPilot's machinery — it is the one FormPilot has to beat to justify its complexity.

## Result

| Method | Accuracy | Macro P | Macro R | Macro F1 | Wrong | Declined | Missed refusals |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A exact label | 44.0% | 76.4% | 29.4% | 41.3% | 7 | 157 | 8 |
| B exact + metadata | 72.3% | 83.3% | 60.9% | 68.9% | 13 | 56 | 16 |
| C substring | 75.6% | 79.6% | 68.2% | 71.8% | 31 | 24 | 20 |
| D semantic | 74.9% | 78.5% | 70.4% | 72.9% | 39 | 10 | 28 |
| **FormPilot (full)** | **75.9%** | 80.4% | 69.3% | **73.1%** | 31 | 20 | 23 |

The safety policy is excluded from this table so the comparison is of matching alone. With it in
front — the shipped configuration — FormPilot's accuracy is 82.1% and missed refusals fall from 23
to 4. No baseline has an equivalent, which is itself a finding: a matcher with no refusal layer
names a concept for real password and payment fields.

## Reading this honestly

**FormPilot wins, by 1.3 F1 points over a substring baseline and 0.2 over a token-similarity one.**

That is a much smaller margin than the self-authored corpus implies, where the same comparison put
FormPilot at 100% macro F1 and the substring baseline at 98.6%. On labels written by strangers the
elaborate machinery buys very little raw accuracy over simple string containment.

Three observations that matter more than the ranking:

1. **Exact matching is not viable.** Baseline A declines 157 of 307 answerable fields — it is
   precise (76.4%) and nearly useless (29.4% recall). Real labels are not alias lists.

2. **Metadata is where the signal is, not sophistication.** Going from A to B — the same exact-match
   rule, just also reading `name`, `id` and `placeholder` — moves accuracy from 44.0% to 72.3%. That
   single change is worth more than every scoring refinement combined.

3. **FormPilot's real advantage is calibration, not accuracy.** Compare it to baseline D: nearly the
   same F1, but 31 wrong answers instead of 39 and 20 abstentions instead of 10. It converts eight
   confident errors into eight admissions of uncertainty. For a system whose output a human reviews
   before it is written, that trade is the point — a wrong answer presented confidently costs more
   than a blank field. The F1 column cannot see that difference, which is why `wrong` and `declined`
   are reported beside it.

## What this does not establish

- Not a comparison against published systems. A, B, C and D are re-implementations written for this
  harness, not other people's software. No literature review has been done and no
  state-of-the-art claim is made or supported.
- Not a claim that 1.3 F1 points is significant. 307 records, and no confidence intervals are
  computed. A difference this small on a sample this size should be treated as "comparable", not as
  "better".
- Not a measure of anything outside the ontology's scope. A field whose meaning FormPilot models no
  concept for cannot appear in this evaluation, because it would carry no `autocomplete` token
  either.

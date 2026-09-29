# Held-out evaluation v2

The independent measurement taken **after** the payment-field safety fix, on a corpus disjoint from
v1.

| | |
| --- | --- |
| **Dataset** | 467 form controls from 105 third-party HTML files (`research/heldout-v2/corpus.json`) |
| **Held-out split** | 109 controls from 30 files |
| **Ground truth** | each file's own `autocomplete` attribute, per the WHATWG HTML specification |
| **Procedure** | `npm run heldout-v2:fetch` then `npm run study:heldout-v2` |
| **Metrics** | accuracy, macro P/R/F1, abstention rate, incorrect-fill rate, safety-refusal rate; 95% Wilson intervals |
| **Date** | corpus fetched and evaluated 2026-09-29 |
| **Software version** | FormPilot 2.0.0, configuration frozen at commit `62eb9c0` |

## Why a second evaluation exists

v1 exposed four payment-field safety misses. Fixing them made v1 a **training set for that fix**, so
re-scoring v1 afterwards measures whether the patch worked — it does, 4 misses to 0 — and says
nothing about generalisation. That re-score is kept as
`research/heldout/results/post-safety-fix-rescore.*` and is explicitly labelled not independent.

v2 is the independent post-fix number. It is disjoint from v1 by construction: every v1 source file
was excluded before fetching, and the two corpora share **zero files**.

## Test population

Do not read the headline without this section.

| | v1 | v2 |
| --- | --- | --- |
| Controls | 658 | 467 |
| Files | 134 | 105 |
| Held-out controls | 307 | 109 |
| Must-refuse share of held-out | 10.7% | **41.3%** |
| Non-Latin labels in held-out | 21 | 0 |
| Unlabelled in held-out | 80 | 15 |

**v2 is deliberately payment- and credential-heavy.** Token families were chosen so the safety fix
is measured against markup it has never seen: `cc-number`, `cc-csc`, `cc-name`, `cc-exp*`,
`one-time-code`, `new-password` and `current-password` together supply 166 of 467 controls. That is
the point of the second evaluation, and it means **v2 accuracy is not comparable to v1's as a
like-for-like figure.** Different population, different base rates. A system that refuses well scores
higher on v2 than on v1 for reasons that have nothing to do with getting better at mapping.

The held-out split is 109 controls rather than ~190 because the split is grouped by *file* and one
source (`nhsbsa/apply-healthy-start-vouchers`) contributes 23 near-identical prototype versions that
all land in the same bucket. Grouping is the right choice — it stops one author's markup spanning two
splits — and the smaller split is its honest cost. The confidence intervals below reflect it.

### Sources new in v2

W3C WCAG technique pages, CiviForm (a government benefits application platform), Chromium's
`badssl.com`, DuckDuckGo's privacy test pages, Mastercard's card-autofill demo, PayPal's Fastlane
sample application, Google's PWA e-commerce demo, Mozilla's credit-card autofill fixtures, UK
government service prototypes from NHS BSA, DWP and Defra, `code4romania/redirectioneaza`, plus a
long tail of independent projects.

Every record carries the SHA-256 of its source file as fetched, so a later run can prove it read the
same bytes even if upstream has moved on.

## Configuration freeze

Frozen at commit `62eb9c0`, 2026-09-29T05:46:19Z, **before** the harness was first run. SHA-256
prefixes of every file that determines matching behaviour, recorded at freeze and re-checked
afterwards — all seven unchanged:

```
a11f390d3d097fa2  shared/ontology/concepts.ts
caebde3baff90cf1  shared/matching/matcher.ts
c7b52bce64c29e72  shared/matching/normalize.ts
dfae775da1039ceb  shared/matching/similarity.ts
0bf2297a085b7d9d  shared/matching/confidence.ts
bfa27e03a32583c5  shared/matching/router.ts
1bf6fb49f75d2a9e  shared/safety/policy.ts
```

Nothing was tuned in response to these results.

## Result — held-out split, shipped pipeline

109 controls, 30 files.

| Metric | Value | 95% CI |
| --- | --- | --- |
| Accuracy | **93.6%** | [87.3%, 96.9%] |
| Macro precision | 78.9% | — |
| Macro recall | 70.5% | — |
| Macro F1 | **72.8%** | — |
| Abstention rate | 46.8% | [37.7%, 56.1%] |
| **Incorrect-fill rate** | **0.9%** | [0.2%, 5.0%] |
| **Safety-refusal rate** | **45 / 45** | [92.1%, 100.0%] |

Counts: 57 correct concepts, 1 wrong concept, 6 abstentions on answerable fields, 45 correct
refusals, **0 missed refusals**, 0 at auto-accept confidence.

**The safety fix is independently validated.** 45 of 45 payment, password and one-time-code controls
were refused on markup the fix has never seen. The interval's lower bound is 92.1% — that is what 45
observations support, and the point estimate should not be quoted without it.

**Incorrect-fill of 0.9%** is the rate that matters most for a human-in-the-loop system: how often
FormPilot puts something wrong in front of a reviewer. One record in 109, with an interval reaching
5.0%.

**Abstention of 46.8% is not a failure.** 41.3% of this split must be refused, and refusing is an
abstention. On the answerable subset alone, abstention is 9.4%.

### By stratum

| Stratum | n | Accuracy | 95% CI | Abstention | Incorrect-fill |
| --- | --- | --- | --- | --- | --- |
| all held-out | 109 | 93.6% | [87.3%, 96.9%] | 46.8% | 0.9% |
| must-refuse | 45 | 100.0% | [92.1%, 100.0%] | 100.0% | 0.0% |
| answerable | 64 | 89.1% | [79.1%, 94.6%] | 9.4% | 1.6% |
| Latin labels | 94 | 93.6% | [86.8%, 97.0%] | 41.5% | 1.1% |
| no label (name/id only) | 15 | 86.7% | [62.1%, 96.3%] | 73.3% | 6.7% |

The no-label stratum's interval spans 34 points on 15 records. It is reported for completeness, not
as a measurement.

### Every error

| Expected | Got | Label |
| --- | --- | --- |
| `address.state` | `person.full_name` | `({{ input_name }})` |
| `address.state` | abstained | `County (optional):` |
| `address.state` | abstained | `Endereço:` |
| `person.phone` | abstained | `Telefone:` |
| `person.email` | abstained | `Confirm Email` |
| `person.middle_name` | abstained | `Name:` |
| `person.middle_name` | abstained | `(q)` |

Worth reading individually, because seven errors is few enough to inspect:

- **`{{ input_name }}`** is an un-rendered template placeholder. The corpus contains server-side
  template files, not only rendered HTML. This is ground-truth noise, and it is the only
  wrong-concept error in the split.
- **`County (optional):`** is the UK term for a state or province. A real ontology gap.
- **`Endereço:`, `Telefone:`** are Portuguese. The ontology is English-only, which
  `limitations.md` has always said; v2's held-out split happens to contain no non-Latin *script*
  labels but does contain non-English Latin ones.
- **`Confirm Email`** is a confirmation field. Abstaining is arguably correct behaviour scored as an
  error, because the ground-truth attribute says `email`.
- **`Name:`** with `autocomplete="additional-name"` — the author used a bare "Name" label for a
  middle-name field. Abstaining is defensible.

## Baselines — same held-out set, matching only

The safety policy is excluded here so the comparison is of matching strategies.

| Method | Accuracy | Macro F1 | Abstention | Incorrect-fill | Missed refusals |
| --- | --- | --- | --- | --- | --- |
| A exact label | 63.3% | 61.5% | 40.4% | 19.3% | 20 |
| B substring | 62.4% | 66.5% | 26.6% | 26.6% | 28 |
| C metadata | 64.2% | 68.1% | 19.3% | 30.3% | 30 |
| D semantic | 58.7% | 71.1% | 5.5% | 40.4% | 40 |
| **FormPilot (match only)** | 64.2% | **71.2%** | 17.4% | 30.3% | 32 |
| **FormPilot (full system)** | **93.6%** | 72.8% | 46.8% | **0.9%** | **0** |

Two findings, and the second is the important one.

**Matching alone, FormPilot is level with a substring-over-metadata baseline** — 64.2% accuracy for
both, 71.2 against 68.1 macro F1. This echoes v1, where the margin over substring was 1.3 F1 points.
On third-party labels the elaborate multi-signal matcher is worth little raw accuracy over simple
string containment.

**The refusal layer is where the system earns its keep.** Every matching baseline names a concept for
20–40 of the 45 controls that must be refused. Baseline D, the best on macro F1, is the worst on
safety: 40 missed refusals and a 40.4% incorrect-fill rate. A matcher optimised for coverage is
actively dangerous on a payment form, and F1 cannot see it.

## Ablation — same held-out set

| Configuration | Accuracy | Macro F1 | Abstention | Incorrect-fill | Missed refusals |
| --- | --- | --- | --- | --- | --- |
| 1 label only | 61.5% | 67.9% | 21.1% | 30.3% | 31 |
| 2 + name/id | 56.9% | 67.8% | 5.5% | 42.2% | 40 |
| 3 + control type | 56.9% | 67.8% | 5.5% | 42.2% | 40 |
| 4 + semantic gates | 63.3% | 69.8% | 14.7% | 33.0% | 33 |
| 5 + confidence calibration | 64.2% | 71.2% | 17.4% | 30.3% | 32 |
| 6 **full system** | **93.6%** | 72.8% | 46.8% | **0.9%** | **0** |

**Adding `name`/`id` costs 4.6 accuracy points here, and on v1 it gained 22.8.** That reversal is the
most interesting result in this document. On ordinary application forms the `name` attribute is often
the only signal a poorly-labelled field has, so reading it is worth a great deal. On a payment form
the same attribute — `cc-number`, `cc-csc` — makes the matcher *more confident about a concept it
should refuse*, so incorrect-fill rises from 30.3% to 42.2%. More signal on a field you should not
answer produces a more confident wrong answer.

**The safety policy is worth +29.4 accuracy points and takes incorrect-fill from 30.3% to 0.9%**,
while macro F1 moves 1.6 points. Refusals are not a gold concept, so F1 is nearly blind to the
single largest contribution in the system. Any evaluation of an autofiller that reports F1 alone
will conclude the safety layer does almost nothing.

## One harness correction, disclosed

The first v2 run reported 44/45 refusals and one miss: a field labelled `verification input` mapped
to `auth.otp`. That was a **harness bug, not a product defect**. `shared/matching/router.ts` routes a
field to `blocked` when its matched concept declares `policy: 'never'`, which `auth.otp` does — the
shipped pipeline refuses exactly that field for exactly that reason, and the harness was only
checking `evaluateFieldSafety`.

The harness now counts a `policy: 'never'` concept as a refusal, which is what the product does. The
correction was made **after** seeing the results and it improves the numbers, so it is recorded here
rather than folded in silently. It changes the measurement to match the product; it does not change
the product to match the measurement, which is the distinction the freeze exists to protect.

## What this supports

- The payment-field safety fix generalises: 45 of 45 credential and payment controls refused on a
  disjoint corpus, 95% CI [92.1%, 100%].
- FormPilot's incorrect-fill rate on third-party markup is 0.9%, 95% CI [0.2%, 5.0%].
- The refusal layer, not the matcher, is what makes the system safe on real payment forms.

## What this does not support

- **Not a like-for-like improvement over v1's 82.1%.** Different corpus, different population, a much
  higher must-refuse share. Comparing the two headline numbers is invalid and neither document does.
- **Not 100% anything.** The safety-refusal rate is 45 of 45 with a lower bound of 92.1%; overall
  accuracy is 93.6%.
- **Not evidence of universal compatibility.** 109 held-out controls from 30 files, within one
  ontology's scope.
- **Not a claim about coverage.** A field whose meaning FormPilot models no concept for cannot appear
  here, because it would carry no `autocomplete` token either.
- **Not state-of-the-art.** The baselines are re-implementations written for this harness. No
  literature review has been done.

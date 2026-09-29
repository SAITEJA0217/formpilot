# Held-out evaluation

The first evaluation in this repository whose ground truth this project did not author.

| | |
| --- | --- |
| **Dataset** | 658 form controls from 134 third-party HTML files (`research/heldout/corpus.json`) |
| **Held-out split** | 307 controls from 55 files |
| **Ground truth** | each file's own `autocomplete` attribute, per the WHATWG HTML specification |
| **Procedure** | `npm run heldout:fetch` then `npm run study:heldout` |
| **Metric** | accuracy over all records; macro P/R/F1 over a fixed gold concept set |
| **Date** | corpus fetched 2026-09-29; evaluated 2026-09-29 |
| **Software version** | FormPilot 2.0.0, configuration frozen at commit `6e01e8e` |

## Why this is different from every earlier number

The benchmark corpus in `research/benchmark/dataset/` was written by the same agent that wrote the
engine. A perfect score on it means the engine does what its author expected — a regression guard,
not evidence of generality. `research/matching/` has the same problem and a worse one: it scored
65/69 on its first run, three ontology defects were fixed in response, and it is now a regression
suite rather than a measurement.

This dataset removes the author from both sides:

- **The labels were written by 134 unrelated authors.** They were found by GitHub code search over
  WHATWG `autocomplete` tokens, taking results in the order GitHub returned them. No file was
  inspected before being added and none was dropped for being inconvenient.
- **The ground truth is not a judgement.** Each record's expected concept is the concept its own
  `autocomplete` token denotes, and the specification fixes what each token means. The token is
  withheld from every method under test.

So the task is: *given a label a stranger wrote, infer the concept that stranger's own attribute
declares.*

## Sources

The corpus spans production applications, government design systems, vendor examples,
accessibility references and a long tail of independent projects. Notable contributors:

| Source | What it is |
| --- | --- |
| `mozilla/form-fill-examples` | Mozilla's own autofill test corpus, 4 files |
| `stripe/elements-examples` | Stripe's published checkout examples |
| `Nova-Scotia-Digital-Service/service-pattern-library` | Canadian provincial government design system |
| `wet-boew/wet-boew-dist` | Government of Canada Web Experience Toolkit, English and French |
| `waic/wcag21` | WCAG 2.1 "identify input purpose" reference form |
| `ericwbailey/accessible-html-content-patterns` | accessibility reference patterns |
| `liberapay/liberapay.com` | a production application's identity form |
| `LAB-MI/deplacement-covid-19` | French government COVID movement certificate |
| `Office-of-Digital-Services/California-State-Digital-Strategy` | US state government |
| `ics-creative/160304_form_autocompletetype` | Japanese-language autocomplete demonstration |
| `alsacreations/KNACSS`, `electerious/formbase`, `thoughtbot/roux` | CSS frameworks' form examples |
| ~120 further repositories | independent projects, student work, small products |

Only extracted metadata is stored — label, `name`, `id`, `placeholder`, `type`, `required`,
`aria-label` and the `autocomplete` token — never the source files, so no third-party code is
redistributed. `provenance` on every record traces it to its origin.

## Configuration freeze

Frozen at commit `6e01e8e` **before** the harness was first run. SHA-256 prefixes of every file
that determines matching behaviour, recorded at freeze and re-checked after the run:

```
a11f390d3d097fa2  shared/ontology/concepts.ts
caebde3baff90cf1  shared/matching/matcher.ts
28c0b0094202eb3c  shared/matching/normalize.ts
dfae775da1039ceb  shared/matching/similarity.ts
0bf2297a085b7d9d  shared/matching/confidence.ts
bfa27e03a32583c5  shared/matching/router.ts
1c0eb3360b3e0366  shared/safety/policy.ts
```

All seven were unchanged after the run. **Nothing was tuned in response to these results**, and the
defects the evaluation exposed are written down below rather than fixed, because fixing them against
this set would destroy the only held-out measurement the project has.

## Decisions declared before the first run

1. **Grouped split by file**, so no author's markup appears in two splits. The split is a SHA-256
   of the file path modulo 100 — nothing is hand-placed.
2. **40 / 20 / 40** across development, validation and held-out.
3. **Nothing is filtered.** Non-Latin labels stay in, even though `limitations.md` already records
   that the ontology is English-only and they will therefore fail. Dropping them would inflate the
   headline.
4. **Unlabelled controls stay in.** 136 records carry no label at all, only a `name`, `id` or
   `placeholder`.
5. **Refusal is scored as a class.** 72 records carry a password, one-time-code or payment-card
   token; ground truth for them is refusal, and naming any concept is an error.

## Result — held-out set, shipped pipeline

307 controls, 55 files.

| Metric | Value |
| --- | --- |
| Accuracy | **82.1%** (223 correct concepts + 29 correct refusals of 307) |
| Macro precision | **80.4%** |
| Macro recall | **69.3%** |
| Macro F1 | **73.1%** |
| Wrong concept | 31 |
| Declined when answerable (false negatives) | 20 |
| Missed refusal (false positives on must-refuse) | 4 |

Macro averages are over the 18 gold concepts the corpus uses, the same denominator for every method,
so no method can improve its own average by answering less.

### By declared stratum

| Stratum | n | Accuracy | Macro F1 |
| --- | --- | --- | --- |
| all held-out | 307 | 82.1% | 73.1% |
| Latin labels | 206 | 81.1% | 72.1% |
| non-Latin labels | 21 | 81.0% | **50.1%** |
| no label (name/id only) | 80 | 85.0% | 75.5% |
| must-refuse controls | 33 | 87.9% | n/a |

The non-Latin F1 of 50.1% against 72.1% for Latin labels is the first *number* attached to a
limitation the documentation had only asserted.

### Per concept

| Concept | Support | P | R | F1 |
| --- | --- | --- | --- | --- |
| `person.email` | 43 | 97.7% | 100.0% | 98.9% |
| `person.phone` | 30 | 96.8% | 100.0% | 98.4% |
| `person.last_name` | 24 | 100.0% | 95.8% | 97.9% |
| `address.postal_code` | 18 | 100.0% | 88.9% | 94.1% |
| `person.first_name` | 23 | 95.5% | 91.3% | 93.3% |
| `person.full_name` | 28 | 76.5% | 92.9% | 83.9% |
| `address.country` | 7 | 100.0% | 71.4% | 83.3% |
| `person.date_of_birth` | 7 | 100.0% | 71.4% | 83.3% |
| `address.line2` | 5 | 100.0% | 80.0% | 88.9% |
| `address.city` | 19 | 85.7% | 63.2% | 72.7% |
| `experience.company` | 12 | 80.0% | 66.7% | 72.7% |
| `address.state` | 11 | 100.0% | 54.5% | 70.6% |
| `address.line1` | 13 | 70.0% | 53.8% | 60.9% |
| `experience.job_title` | 14 | 100.0% | 42.9% | 60.0% |
| `address.full` | 12 | 45.0% | 75.0% | 56.3% |
| `person.gender` | 2 | 100.0% | 100.0% | 100.0% |
| `links.portfolio` | 3 | **0.0%** | **0.0%** | **0.0%** |
| `person.middle_name` | 3 | **0.0%** | **0.0%** | **0.0%** |

Contact fields are near-perfect. Address composition and job title are weak. Two concepts fail
entirely, both on tiny support.

## Defects this exposed, recorded and not fixed

### 1. Four missed refusals on real payment markup — highest priority

| Label as written by the third party | Mapped to |
| --- | --- |
| `CC Name (Full name as given on the payment card)` | `person.full_name` |
| `CC Exp Year` | `experience.years_of_experience` |

These are genuine pre-existing gaps in `shared/safety/policy.ts`, and only independent data could
surface them: the phrase list covers `cc-name` as an `autocomplete` token and `card number` as
text, but not a field whose visible label begins "CC ". The defect is bounded — nothing is
submitted, and the review panel shows every suggestion — but a plausible high-confidence mapping to
`person.full_name` could be pre-accepted.

**The fix is a phrase-list addition (`cc name`, `cc exp`, `cc csc`, `cc type`, and a `\bcc\b`
pattern) plus tests.** It is not applied here because the freeze forbids tuning against this set.
Applying it requires a fresh held-out corpus to measure against.

### 2. Non-Latin labels

50.1% macro F1. The ontology, the abbreviation table and the stopword list are English-only, which
`limitations.md` has always stated. Japanese, Russian and Czech labels in the corpus fail as
expected. This is a scope boundary, not a bug.

### 3. Address composition

`address.full` carries 45% precision and `address.line1` 54% recall: the engine confuses a whole
address with its first line. Phase 2 added ontology negatives that improved this on the synthetic
corpus; on third-party markup the confusion is still the single largest error cluster
(`address.line1 → address.full`, 3 occurrences of the label "Address" alone).

### 4. `links.portfolio` and `person.middle_name` at zero

Three records each. `URL` and `Additional Name` — both the spec's own terminology — map to nothing
and to `person.full_name` respectively. Support is too small for the F1 to be meaningful, but zero
is zero.

## A caveat that cuts the other way

**Some third-party `autocomplete` attributes are simply wrong**, and the harness has no way to tell
an author's mistake from FormPilot's. The clearest case: a field labelled `Education` carries
`autocomplete="organization-title"` in one source, so FormPilot is scored wrong for reading it as
education rather than as a job title. Three of the 31 wrong-concept errors are that one label.

Quantifying this would mean deciding which third-party attributes are mistaken, which puts this
project's judgement back into the ground truth — the exact thing the design avoids. So it is left
unquantified, with the consequence stated plainly: **82.1% is a lower bound on accuracy against
author intent.**

## What this result does and does not support

**Supports:** that FormPilot maps contact fields written by strangers to the right concept at
93–99% F1; that it refuses 88% of real credential and payment controls it has never seen; that its
accuracy on independent data is around 82%, not the 100% its own corpus reports.

**Does not support:** any claim of universal compatibility; any claim about live hosted platforms
(none is reachable — see `platform-evaluation.md`); any claim about generated answer quality (no
provider is reachable); any claim about how a person responds to the suggestions
(see `human-evaluation.md`).

**One structural caveat remains even here.** The *labels* are independent and the *ground truth* is
spec-defined, but the **concept inventory** is this project's. A field whose meaning FormPilot has
no concept for cannot appear in this evaluation at all, because there would be no `autocomplete`
token for it either. The evaluation therefore measures accuracy *within the ontology's scope*, and
says nothing about how much of a real form falls outside it.

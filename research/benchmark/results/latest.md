# FormPilot benchmark results

Generated: 2026-09-28T17:30:58.827Z
Runtime: node v22.22.2, jsdom. **No language model was called**: fields the router
defers to a model are scored on the routing decision only.

Dataset: 12 page states, 85 labelled fields.
Ground truth: `research/benchmark/dataset/*.json` (hand-written from the fixture markup).
Reproduce with `npm run bench`.

## Headline numbers

| Metric | Value | Counts |
|---|---|---|
| Field detection precision | 100.0% | TP 85 / FP 0 |
| Field detection recall | 100.0% | TP 85 / FN 0 |
| Field detection F1 | 100.0% | — |
| Concept mapping precision | 100.0% | TP 74 / FP 0 |
| Concept mapping recall | 100.0% | TP 74 / FN 0 |
| Concept mapping F1 | 100.0% | — |
| Concept mapping accuracy | 100.0% | 74/74 |
| Routing decision accuracy | 100.0% | — |
| Autofill success rate | 100.0% | 56 correct / 0 wrong / 0 missed |
| Safety violations | 0 | none |

## Efficiency

| Metric | Value |
|---|---|
| Detection time per page (mean) | 81.61 ms (sd 62.99) |
| Matching time per page (mean) | 38.83 ms |
| Model calls required (total) | 7 |
| Fields needing a model | 9 of 85 |
| Fields resolved without a model | 89.4% |

## Human-in-the-loop burden

| Status | Fields | Share |
|---|---|---|
| ready | 47 | 55.3% |
| needsReview | 21 | 24.7% |
| manual | 7 | 8.2% |
| blocked | 10 | 11.8% |
| noData | 0 | 0.0% |

Automation rate (pre-accepted, high confidence): **55.3%**.
Review burden: **32.9%**.
Acceptance, correction and override rates require human participants; this harness does not
estimate them.

## By category

| Category | Pages | Fields | Det. P | Det. R | Det. F1 | Mapping acc. | Autofill | Safety violations |
|---|---|---|---|---|---|---|---|---|
| Ambiguous labels | 1 | 12 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 0 |
| ARIA widgets | 1 | 7 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 0 |
| Generic HTML | 2 | 25 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 0 |
| Dynamic | 2 | 6 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 0 |
| Google Forms | 1 | 12 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 0 |
| Multi-step | 3 | 9 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 0 |
| Safety | 1 | 10 | 100.0% | 100.0% | 100.0% | 100.0% | n/a | 0 |
| Shadow DOM | 1 | 4 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 0 |

## By field type

| Field type | Fields | Mapping acc. | Value acc. |
|---|---|---|---|
| text | 43 | 100.0% | 100.0% |
| radio_group | 6 | 100.0% | 100.0% |
| textarea | 5 | 100.0% | n/a |
| select_one | 5 | 100.0% | 100.0% |
| email | 4 | 100.0% | 100.0% |
| url | 4 | 100.0% | 100.0% |
| checkbox | 4 | 100.0% | n/a |
| checkbox_group | 3 | 100.0% | 100.0% |
| tel | 3 | 100.0% | 100.0% |
| file | 3 | 100.0% | n/a |
| date | 2 | 100.0% | 100.0% |
| number | 1 | 100.0% | 100.0% |
| time | 1 | n/a | n/a |
| password | 1 | 100.0% | n/a |

## By label source

| Label source | Fields | Mapping acc. | Mean confidence |
|---|---|---|---|
| label-for | 48 | 100.0% | 0.713 |
| platform-heading | 12 | 100.0% | 0.524 |
| preceding-text | 8 | 100.0% | 0.364 |
| aria-labelledby | 6 | 100.0% | 0.719 |
| label-wrapping | 4 | 100.0% | 0 |
| placeholder | 2 | 100.0% | 0.465 |
| name-attribute | 2 | 100.0% | 0.95 |
| aria-label | 2 | 100.0% | 0.97 |
| fieldset-legend | 1 | 100.0% | 0.912 |

## Per page

| Page | Platform | Adapter | Det. F1 | Mapping acc. | Routing acc. | Autofill | Detect ms |
|---|---|---|---|---|---|---|---|
| ambiguous-labels.html | generic-html | generic-html@1 | 100.0% | 100.0% | 100.0% | 6/6 | 181.03 |
| aria-widgets.html | generic-html | generic-html@1 | 100.0% | 100.0% | 100.0% | 6/6 | 100.34 |
| basic-html.html | generic-html | generic-html@1 | 100.0% | 100.0% | 100.0% | 8/8 | 60.12 |
| complex-html.html | generic-html | generic-html@1 | 100.0% | 100.0% | 100.0% | 14/14 | 148.97 |
| dynamic-form.html#employed | generic-html | generic-html@1 | 100.0% | 100.0% | 100.0% | 3/3 | 29.03 |
| dynamic-form.html#initial | generic-html | generic-html@1 | 100.0% | 100.0% | 100.0% | 1/1 | 17.09 |
| google-forms-mock.html | google-forms | google-forms@2 | 100.0% | 100.0% | 100.0% | 7/7 | 202.79 |
| multi-step.html#step-1 | generic-html | generic-html@1 | 100.0% | 100.0% | 100.0% | 3/3 | 50.62 |
| multi-step.html#step-2 | generic-html | generic-html@1 | 100.0% | 100.0% | 100.0% | 4/4 | 61.64 |
| multi-step.html#step-4-documents | generic-html | generic-html@1 | 100.0% | 100.0% | 100.0% | n/a | 35.02 |
| sensitive-fields.html | generic-html | generic-html@1 | 100.0% | 100.0% | 100.0% | n/a | 66.06 |
| shadow-dom.html | generic-html | generic-html@1 | 100.0% | 100.0% | 100.0% | 4/4 | 26.62 |

## Disagreements with ground truth (0)

None.

## Excluded from this run

- `iframe-form.html` — jsdom does not load iframe `src` documents, so an offline run
  would measure nothing. Frame traversal is covered by `tests/integration/shadow-iframe.test.ts`
  with synthetic frames; the page itself needs manual browser verification.
- Microsoft Forms, Typeform, Jotform and SurveyMonkey — recognised by platform detection but
  with no dedicated adapter and no fixture, so there is nothing to measure yet.

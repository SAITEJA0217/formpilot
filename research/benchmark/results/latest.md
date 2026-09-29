# FormPilot benchmark results

Generated: 2026-09-29T04:11:57.633Z
Runtime: node v22.22.2, jsdom. **No language model was called**: fields the router
defers to a model are scored on the routing decision only.

Dataset: 17 page states, 120 labelled fields.
Ground truth: `research/benchmark/dataset/*.json` (hand-written from the fixture markup).
Reproduce with `npm run bench`.

## Headline numbers

| Metric | Value | Counts |
|---|---|---|
| Field detection precision | 100.0% | TP 120 / FP 0 |
| Field detection recall | 100.0% | TP 120 / FN 0 |
| Field detection F1 | 100.0% | — |
| Concept mapping precision | 100.0% | TP 106 / FP 0 |
| Concept mapping recall | 100.0% | TP 106 / FN 0 |
| Concept mapping F1 | 100.0% | — |
| Concept mapping accuracy | 100.0% | 106/106 |
| Routing decision accuracy | 100.0% | — |
| Autofill success rate | 100.0% | 84 correct / 0 wrong / 0 missed |
| Safety violations | 0 | none |

## Efficiency

| Metric | Value |
|---|---|
| Detection time per page (mean) | 61.01 ms (sd 48.64) |
| Matching time per page (mean) | 24.82 ms |
| Model calls required (total) | 10 |
| Fields needing a model | 13 of 120 |
| Fields resolved without a model | 89.2% |

## Human-in-the-loop burden

| Status | Fields | Share |
|---|---|---|
| ready | 62 | 51.7% |
| needsReview | 39 | 32.5% |
| manual | 9 | 7.5% |
| blocked | 10 | 8.3% |
| noData | 0 | 0.0% |

Automation rate (pre-accepted, high confidence): **51.7%**.
Review burden: **40.0%**.
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
| Jotform (experimental) | 1 | 15 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 0 |
| Microsoft Forms (experimental) | 1 | 10 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 0 |
| Multi-step | 3 | 9 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 0 |
| Safety | 1 | 10 | 100.0% | 100.0% | 100.0% | 100.0% | n/a | 0 |
| Shadow DOM | 1 | 4 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 0 |
| SurveyMonkey (experimental) | 1 | 8 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 0 |
| Typeform (experimental) | 2 | 2 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 0 |

## By field type

| Field type | Fields | Mapping acc. | Value acc. |
|---|---|---|---|
| text | 57 | 100.0% | 100.0% |
| radio_group | 12 | 100.0% | 100.0% |
| textarea | 8 | 100.0% | n/a |
| select_one | 8 | 100.0% | 100.0% |
| checkbox_group | 6 | 100.0% | 100.0% |
| email | 5 | 100.0% | 100.0% |
| tel | 4 | 100.0% | 100.0% |
| date | 4 | 100.0% | 100.0% |
| url | 4 | 100.0% | 100.0% |
| file | 4 | 100.0% | n/a |
| checkbox | 4 | 100.0% | n/a |
| number | 1 | 100.0% | 100.0% |
| time | 1 | n/a | n/a |
| rating | 1 | n/a | n/a |
| password | 1 | 100.0% | n/a |

## By label source

| Label source | Fields | Mapping acc. | Mean confidence |
|---|---|---|---|
| label-for | 48 | 100.0% | 0.713 |
| platform-heading | 47 | 100.0% | 0.663 |
| preceding-text | 8 | 100.0% | 0.349 |
| aria-labelledby | 6 | 100.0% | 0.719 |
| label-wrapping | 4 | 100.0% | 0 |
| placeholder | 2 | 100.0% | 0.465 |
| name-attribute | 2 | 100.0% | 0.95 |
| aria-label | 2 | 100.0% | 0.97 |
| fieldset-legend | 1 | 100.0% | 0.912 |

## Per page

| Page | Platform | Adapter | Det. F1 | Mapping acc. | Routing acc. | Autofill | Detect ms |
|---|---|---|---|---|---|---|---|
| ambiguous-labels.html | generic-html | generic-html@1 | 100.0% | 100.0% | 100.0% | 6/6 | 149.83 |
| aria-widgets.html | generic-html | generic-html@1 | 100.0% | 100.0% | 100.0% | 6/6 | 69.36 |
| basic-html.html | generic-html | generic-html@1 | 100.0% | 100.0% | 100.0% | 8/8 | 44.89 |
| complex-html.html | generic-html | generic-html@1 | 100.0% | 100.0% | 100.0% | 14/14 | 125.82 |
| dynamic-form.html#employed | generic-html | generic-html@1 | 100.0% | 100.0% | 100.0% | 3/3 | 21.71 |
| dynamic-form.html#initial | generic-html | generic-html@1 | 100.0% | 100.0% | 100.0% | 1/1 | 14.54 |
| google-forms-mock.html | google-forms | google-forms@2 | 100.0% | 100.0% | 100.0% | 7/7 | 124.38 |
| jotform-mock.html | jotform | jotform@1-experimental | 100.0% | 100.0% | 100.0% | 13/13 | 148.46 |
| microsoft-forms-mock.html | microsoft-forms | microsoft-forms@1-experimental | 100.0% | 100.0% | 100.0% | 8/8 | 70.22 |
| multi-step.html#step-1 | generic-html | generic-html@1 | 100.0% | 100.0% | 100.0% | 3/3 | 29.57 |
| multi-step.html#step-2 | generic-html | generic-html@1 | 100.0% | 100.0% | 100.0% | 4/4 | 35.94 |
| multi-step.html#step-4-documents | generic-html | generic-html@1 | 100.0% | 100.0% | 100.0% | n/a | 26.75 |
| sensitive-fields.html | generic-html | generic-html@1 | 100.0% | 100.0% | 100.0% | n/a | 33.53 |
| shadow-dom.html | generic-html | generic-html@1 | 100.0% | 100.0% | 100.0% | 4/4 | 14.86 |
| surveymonkey-mock.html | surveymonkey | surveymonkey@1-experimental | 100.0% | 100.0% | 100.0% | 5/5 | 88.83 |
| typeform-mock.html#block-1-short-text | typeform | typeform@1-experimental | 100.0% | 100.0% | 100.0% | 1/1 | 14.63 |
| typeform-mock.html#block-4-choice | typeform | typeform@1-experimental | 100.0% | 100.0% | 100.0% | 1/1 | 23.92 |

## Disagreements with ground truth (0)

None.

## Excluded from this run

- `iframe-form.html` — jsdom does not load iframe `src` documents, so an offline run
  would measure nothing. Frame traversal is covered by `tests/integration/shadow-iframe.test.ts`
  with synthetic frames; the page itself needs manual browser verification.
- Microsoft Forms, Typeform, Jotform and SurveyMonkey — recognised by platform detection but
  with no dedicated adapter and no fixture, so there is nothing to measure yet.

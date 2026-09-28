# Compatibility matrix

**Populated only from runs that actually happened.** A platform appears as supported only where
there is a passing automated test *and* a benchmark row for it. Everything else says so plainly.

Legend: **verified** = automated test + benchmark row · **generic fallback, untested** = the
generic engine will attempt it, nothing has measured whether it works · **not implemented** = no
code path exists · **manual only** = exercised by hand in a browser, no automated coverage.

Source of the verified rows: `research/benchmark/results/latest.json`
(run `2026-09-28T17:15Z`, 12 page states, 85 labelled fields) and `npm test` (343 tests).

## Form architectures

| Architecture | Detection | Mapping | Autofill | Dynamic updates | Tested | Evidence |
|---|---|---|---|---|---|---|
| Generic HTML (`label[for]`, `autocomplete`) | verified 100% | verified 100% | verified 8/8 | verified | yes | `basic-html.html` |
| Complex HTML (fieldsets, table layout, selects, groups, file) | verified 100% | verified 100% | verified 14/14 | verified | yes | `complex-html.html` |
| ARIA widgets (no native inputs, contenteditable, custom listbox) | verified 100% | verified 100% | verified 6/6 | verified | yes | `aria-widgets.html` |
| Ambiguous / poorly labelled forms | verified 100% | verified 100% | verified 6/6 | n/a | yes | `ambiguous-labels.html` |
| Dynamic / conditional fields | verified 100% | verified 100% | verified 4/4 | verified | yes | `dynamic-form.html` (2 states) |
| Multi-step wizards | verified 100% | verified 100% | verified 7/7 | verified | yes | `multi-step.html` (3 states) |
| Open Shadow DOM (incl. nested) | verified 100% | verified 100% | verified 4/4 | verified | yes | `shadow-dom.html` |
| Closed Shadow DOM | correctly unreachable | n/a | n/a | n/a | yes | asserted in tests; browser security boundary |
| Same-origin iframes | verified (synthetic frames) | verified | verified | verified | partial | `tests/integration/shadow-iframe.test.ts`; jsdom cannot load frame `src`, so the fixture page is manual only |
| Cross-origin iframes | correctly reported unreachable | n/a | n/a | n/a | yes | asserted in tests; never bypassed |
| React controlled inputs | manual only | manual only | manual only | manual only | partial | `/test-forms/react`; the native-setter mechanism is unit-tested, the page is not automated |
| Next.js app-router pages | manual only | manual only | manual only | manual only | partial | `/test-forms/react-multi-step` |
| Vue / Angular / vanilla JS | generic fallback, untested | — | — | — | no | no fixture; the engine uses standard DOM events these frameworks listen to, which is an argument, not a measurement |

## Platforms

| Platform | Recognised | Dedicated adapter | Detection | Mapping | Autofill | Tested |
|---|---|---|---|---|---|---|
| Google Forms | yes (URL + DOM) | yes, `google-forms@2` | verified 100% | verified 100% | verified 7/7 | yes — `google-forms-mock.html` plus a 15-test regression suite covering every v1 question type including grid flattening |
| Generic HTML | yes | yes, `generic-html@1` | verified | verified | verified | yes |
| Microsoft Forms | yes (URL + `data-automation-id`) | no | generic fallback, untested | — | — | no |
| Typeform | yes (URL + `data-qa`) | no | generic fallback, untested | — | — | no |
| Jotform | yes (URL + DOM) | no | generic fallback, untested | — | — | no |
| SurveyMonkey | yes (URL) | no | generic fallback, untested | — | — | no |

For the four recognised-but-unsupported platforms the registry deliberately selects the generic
adapter and records `generic-fallback`, and the UI tells the user the platform was recognised but
is untested. That is the honest state: recognition is a URL match, not a capability.

## Field types

Every type below is detected, classified and filled by the generic engine, and each is covered by
at least one automated test. The table is copied verbatim from the generated report
(`research/benchmark/results/latest.md`, "By field type"); `n/a` means no field of that type had a
value to score (model-bound, blocked, or handed to the user).

| Unified type | Benchmark fields | Mapping acc. | Value acc. |
|---|---|---|---|
| `text` | 43 | 100.0% | 100.0% |
| `radio_group` | 6 | 100.0% | 100.0% |
| `textarea` | 5 | 100.0% | n/a |
| `select_one` | 5 | 100.0% | 100.0% |
| `email` | 4 | 100.0% | 100.0% |
| `url` | 4 | 100.0% | 100.0% |
| `checkbox` | 4 | 100.0% | n/a |
| `checkbox_group` | 3 | 100.0% | 100.0% |
| `tel` | 3 | 100.0% | 100.0% |
| `file` | 3 | 100.0% | n/a |
| `date` | 2 | 100.0% | 100.0% |
| `number` | 1 | 100.0% | 100.0% |
| `time` | 1 | n/a | n/a |
| `password` | 1 | 100.0% | n/a |

Types the engine classifies but the corpus does not yet exercise end to end: `datetime`, `month`,
`week`, `color`, `range`, `search`, `richtext`, `select_many`, `rating`. Their classification is
unit-tested; no benchmark row measures them.

## By label source

The most transportable result in the run: how much the outcome depends on markup quality rather
than on the matcher. Copied from the generated report.

| Label source | Fields | Mapping acc. | Mean confidence |
|---|---|---|---|
| `label-for` | 48 | 100.0% | 0.713 |
| `platform-heading` | 12 | 100.0% | 0.524 |
| `preceding-text` | 8 | 100.0% | 0.364 |
| `aria-labelledby` | 6 | 100.0% | 0.719 |
| `label-wrapping` | 4 | 100.0% | 0.000 |
| `placeholder` | 2 | 100.0% | 0.465 |
| `name-attribute` | 2 | 100.0% | 0.950 |
| `aria-label` | 2 | 100.0% | 0.970 |
| `fieldset-legend` | 1 | 100.0% | 0.912 |

Mapping accuracy is 100% across every strategy on this corpus, but mean confidence varies more
than threefold: fields labelled only by surrounding text average 0.364, well inside the band that
requires human review, while an `aria-label` averages 0.970. The engine is therefore *less certain*
on weakly marked-up fields even where it happens to be right — which is the behaviour the
confidence bands exist to produce. The `label-wrapping` mean of 0.000 is the four consent
checkboxes: blocked fields carry no confidence by construction.

Cell counts here are single- and double-digit. These are descriptive observations about one small
corpus, not estimates with intervals.

## Form categories (application domains)

| Category | Status |
|---|---|
| Job / internship application forms | represented by the synthetic corpus only; no real-site evaluation |
| Registration forms | not evaluated |
| Survey forms | not evaluated |
| Contact forms | not evaluated |
| College / academic forms | not evaluated |

No real-world site has been evaluated. See [limitations.md](./limitations.md).

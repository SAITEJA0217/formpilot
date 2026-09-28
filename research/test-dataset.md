# Test dataset

## The corpus

Ten HTML pages in `frontend/public/test-forms/`, plus two React pages as app routes. The static
pages serve three purposes from one source of truth: manual browser testing at `/test-forms`,
jsdom integration tests, and the benchmark.

| Page | Fields | What it stresses |
|---|---|---|
| `basic-html.html` | 9 | `label[for]` + `autocomplete`; the detection baseline |
| `complex-html.html` | 16 | fieldsets, table layout, native select, radio/checkbox groups, file input, essay |
| `aria-widgets.html` | 7 | no native inputs — roles, `aria-labelledby`/`describedby`, contenteditable, custom listbox |
| `ambiguous-labels.html` | 12 | near-duplicate labels, placeholder-only and name-only fields |
| `dynamic-form.html` | 2 → 4 | conditional fields added by the page's own script |
| `multi-step.html` | 3 / 4 / 2 | 5 steps, indicator list, hidden panels |
| `shadow-dom.html` | 4 | two levels of open shadow root, plus a closed root that must stay unreachable |
| `iframe-form.html` | — | same-origin frame and cross-origin frame (manual verification only) |
| `google-forms-mock.html` | 12 | Google Forms DOM: short answer, paragraph, radio, checkbox, dropdown, date, time, linear scale, 2-row grid |
| `sensitive-fields.html` | 10 | passwords, OTP, card, CVV, SSN, Aadhaar, four consent controls |
| `/test-forms/react` | 13 | React-controlled inputs — the native value-setter path |
| `/test-forms/react-multi-step` | 3–5 per step | a client wizard that unmounts each step |

## Ground truth

`research/benchmark/dataset/*.json`, one file per evaluated page state, 12 states and 85 labelled
fields. Each field records the label a reader sees, the expected unified field type, the expected
ontology concept (or null), the value that should be proposed given the benchmark profile (or
null), and the expected disposition. The schema, including the `review` disposition for genuinely
ambiguous fields, is in [`dataset/schema.md`](./benchmark/dataset/schema.md).

Ground truth was written from the fixture markup, stating what a careful human reader would say
each field means — not what the engine produces. Several entries deliberately disagreed with the
engine's first output; each disagreement was then triaged as either an engine defect (fixed, and
listed in [experiment-design.md](./experiment-design.md)) or a mis-stated expectation (corrected,
with the reason recorded in the dataset's `notes`).

## Profile

One fixed profile, `research/benchmark/profile.ts`, imported by `tests/helpers/profile.ts` so a
test and a benchmark run cannot disagree about what the profile contains. It covers personal
details, two education entries (to exercise "most recent" selection), skills, one project, one
current role, social links, a structured address, languages, and two document records.

## Biases and threats to validity

These are properties of the corpus, and they bound what any number computed from it can mean.

1. **Author bias — the dominant limitation.** The fixtures and the engine were written by the
   same author. The corpus encodes the cases the engine was designed for. A 100% score is a
   regression guard, not evidence of generality.
2. **Synthetic markup.** Real pages carry framework-generated class soup, duplicated ids, hidden
   duplicate forms, tracking iframes, and markup that violates the spec. The fixtures are
   well-formed even where they are adversarial.
3. **Scale.** 85 fields over 12 page states. Far too small for confidence intervals; per-slice
   cells contain single-digit counts.
4. **The Google Forms fixture is a mock.** It reproduces the DOM structure and widget behaviour
   faithfully enough to exercise the adapter, but Google changes its production markup without
   notice, and no automated test in this repository touches the live product.
5. **jsdom is not a browser.** No layout, no real event ordering, no CSS-driven visibility, no
   cross-origin enforcement. The engine avoids layout APIs partly for this reason, but "passes
   under jsdom" is weaker than "works in Chrome".
6. **One profile.** No coverage of missing fields, multiple education entries with equal years,
   non-Latin scripts, or right-to-left text.
7. **One language.** English labels only. The normalizer's abbreviation table is English, so
   non-English forms would fall back to weaker signals.
8. **No model in the loop.** Nine of 85 fields are routed to a model and scored on the routing
   decision alone. Nothing here measures generated-answer quality.

## Extending the corpus

Add a page to `frontend/public/test-forms/`, list it in `test-forms/README.md` and in the
`/test-forms` index, write a ground-truth file, then run `npm run bench`. A page whose inline
script defines globals must wrap them in an IIFE, and custom-element definitions must be guarded,
so the page can be loaded more than once in one process.

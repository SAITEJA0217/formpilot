# Compatibility matrix

Populated only from runs that actually happened. No row says **Verified** unless an automated
test executed against the real thing and asserted the result.

## Status vocabulary

The word **Supported** does not appear in this document. It hides the difference between
"we wrote code for it" and "we ran it and watched it work", and that difference is the whole
point of this file.

| Status | Means | What you can rely on |
| --- | --- | --- |
| **Verified** | Executed and asserted in an automated test against the real target. | It worked when the suite last ran. |
| **Partial** | Some paths executed and asserted; named gaps remain. | The listed paths. Read the gap. |
| **Experimental** | Implemented against a published markup contract and tested against a local reproduction. Never run against the live product. | The structure was read correctly. Nothing about the live site. |
| **Untested** | Code exists. Nothing has measured whether it works. | Nothing. |
| **Unsupported** | No code path, or a platform constraint makes it impossible. | That it will not silently do the wrong thing. |

## Evidence behind the Verified rows

| Source | Scope |
| --- | --- |
| `npm test` | 732 assertions, 37 files, jsdom |
| `npm run test:safety` | 232 of those, safety invariants only, its own CI job |
| `npx playwright test` | 83 specs, 10 files, Chromium 141.0.7390.37, the built extension loaded, real MV3 service worker |
| `npm run bench` | 17 page states, 120 labelled fields, **synthetic, self-authored** |
| `npm run study:safety-corpus` | 196 cases, **a specification of required behaviour**, not a measurement |
| `npm run study:matching` | 69 cases, **post-hoc regression suite** — read `matching/README.md` first |
| `npm run study:heldout` | **307 controls from 55 third-party files, ground truth from the HTML spec** (v1) |
| `npm run study:heldout-v2` | **467 controls from 105 third-party files, zero overlap with v1** |
| `npm run study:routing` | 13 pages, 109 fields, routing decisions; hybrid vs always-ask |
| `npm run study:performance` | 10–500 fields, jsdom scaling curve |
| `./research/platform-probe/probe.sh` | whether the five hosted platforms are reachable |

Only the two held-out rows support a claim about behaviour on pages nobody here wrote. **v1** reports
82.1% accuracy and 73.1% macro F1 with four missed payment-field refusals
(`held-out-evaluation.md`); that record is frozen as measured and is not restated after the fix.
**v2**, built after the fix with no file in common, reports **93.6% accuracy [87.3%, 96.9%]**, a 0.9%
incorrect-fill rate and **45/45 credential and payment controls refused** — and is deliberately
payment-heavy, so its accuracy is **not** a like-for-like improvement on v1's
(`held-out-evaluation-v2.md`).

Every 100% in this document comes from a corpus this project authored and means "no regression", not
"works in general".

**Two constraints bound every row below, and neither is a code problem.**

1. **No hosted form platform is reachable.** This build environment's network policy denies
   `docs.google.com`, `forms.office.com`, `form.typeform.com`, `www.jotform.com` and
   `www.surveymonkey.com` at CONNECT. No adapter can be promoted past **Experimental** from
   here, however well it works.
2. **No model provider is reachable and no API key is present.** Generated answer quality is
   unmeasured. The routing decisions around it are measured.

## Form architectures

| Architecture | Detection | Extraction | Mapping | Autofill | Dynamic updates | Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Generic HTML (`label[for]`, `autocomplete`) | 100% | 100% | 100% | 8/8 | n/a | **Verified** | `basic-html.html`; `workflow.spec.ts` in Chromium |
| Complex HTML (fieldsets, table layout, selects, groups, file) | 100% | 100% | 100% | 14/14 | n/a | **Verified** | `complex-html.html` |
| ARIA widgets (no native inputs, contenteditable, custom listbox) | 100% | 100% | 100% | 6/6 | n/a | **Verified** | `aria-widgets.html` |
| Ambiguous / poorly labelled forms | 100% | 100% | 100% | 6/6 | n/a | **Verified** | `ambiguous-labels.html`; a confident fill on an unresolvable field counts as an error |
| Dynamic / conditional fields | 100% | 100% | 100% | 4/4 | yes | **Verified** | `dynamic.spec.ts`: conditional render, removal, 5-row burst, zero duplicate cards |
| Multi-step wizards | 100% | 100% | 100% | 7/7 | yes | **Verified** | `dynamic.spec.ts`: step re-detection; the step button is never clicked |
| Open Shadow DOM, including nested | 100% | 100% | 100% | 4/4 | yes | **Verified** | `dynamic.spec.ts` fills through two levels of open shadow root in Chromium |
| Closed Shadow DOM | correctly unreachable | — | — | — | — | **Unsupported** | Browser boundary. The host page cannot reach it either; asserted in Chromium. |
| Same-origin iframes | 100% | 100% | 100% | yes | yes | **Verified** | `dynamic.spec.ts` fills a field inside a real loaded frame |
| Cross-origin iframes | correctly reported unreachable | — | — | — | — | **Unsupported** | Same-origin policy. Tested against a frame that genuinely loads, from a second origin on the same server. Never bypassed. |
| Very large forms (400 fields) | 100% | 100% | 100% | yes | n/a | **Verified** | `performance.spec.ts`: 967 ms scan, 2.42 ms/field, every repeat of a label filled identically |

## Frameworks

| Framework | Version tested | Write reaches framework state | Survives re-render | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| React, controlled components | 19.2 | yes | yes | **Verified** | `frameworks.spec.ts`; asserted against `useState`, then against the DOM after a forced render |
| Next.js App Router, server-rendered then hydrated | 16.2 | yes | yes | **Verified** | the repository's own `/test-forms/react` route against a real `next dev` server, after hydration |
| Vue, `v-model` | 3.x | yes | yes | **Verified** | runtime template compiler, so real `v-model` codegen runs rather than a hand-written render function |
| Angular, template-driven `ngModel` | 18 | yes | yes | **Verified** | JIT-compiled in the browser |
| Angular, reactive `FormGroup` | 18 | yes | yes | **Verified** | asserted against `getRawValue()`, not the DOM |
| Svelte, Solid, Ember, others | — | — | — | **Untested** | No fixture. They listen to the same native `input`/`change` events, which is an argument, not a measurement. |

## Platforms

The release brief asks for this shape, so it comes first. Every cell is one of:

- **yes** — executed and asserted in an automated test
- **n/t** — not tested; no claim either way
- **n/a** — the platform has no such behaviour to test

| Platform | Detection | Mapping | Autofill | Dynamic | Multi-step | Chrome | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Generic HTML | 100% | 100% | 100% | yes | yes | yes | **Verified** |
| Google Forms | 100% | 100% | 7/7 | yes | yes | yes | **Partial** |
| Microsoft Forms | 100% | 100% | 100% | n/t | n/t | yes | **Experimental** |
| Typeform | 100% | 100% | 100% | yes | yes | yes | **Experimental** |
| Jotform | 100% | 100% | 100% | n/t | n/t | yes | **Experimental** |
| SurveyMonkey | 100% | 100% | 100% | n/t | n/t | yes | **Experimental** |
| Any unrecognised site | — | — | — | yes | yes | yes | **Partial** |

Reading the columns honestly:

- **Detection / Mapping / Autofill** percentages are against **self-authored fixtures**, so they mean
  "no regression on the structures we wrote", not "works on the live product". The independent numbers
  are the two held-out rows above, and they are lower.
- **Dynamic** means the content script's own MutationObserver noticed a change and re-detected, with no
  rescan triggered by the test. Generic: `dynamic.spec.ts`. Google Forms: `google-forms-sections.spec.ts`,
  including a conditional branch where the answer to one question decides which section comes next.
  Typeform: its one-question-per-screen advance in `platform-adapters.spec.ts`.
- **Multi-step** means fields were re-detected per step *and* the user's decisions survived the walk.
  Generic: `multi-step.spec.ts`, six steps, with identity, value, confidence, provenance and a
  hand-made edit each asserted separately. Google Forms and Typeform as above.
- **n/t for three adapters is a real gap, not an omission.** Microsoft Forms, Jotform and SurveyMonkey
  reproductions are single-screen, so nothing multi-step or dynamic has been exercised on them. Their
  platforms do support both, which is exactly why the cell says "not tested" rather than "no".
- **Chrome** means at least one spec drives that platform's reproduction in real Chromium with the
  built extension loaded. It says nothing about the live site.
- **Status** is defined above. No hosted platform can leave **Experimental** from this environment; see
  the two constraints below.

The same rows with their adapter ids and the reason each is not Verified:

| Platform | Recognised | Dedicated adapter | Detection | Mapping | Autofill | Status | Why not Verified |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Generic HTML | yes | `generic-html@1` | 100% | 100% | 100% | **Verified** | — |
| Google Forms | URL + DOM | `google-forms@2` | 100% | 100% | 7/7 | **Partial** | 15 integration tests over every v1 question type incl. grid flattening, plus 4 Chromium specs (adapter selection, ARIA-only questions, full pipeline to a verified write, submit control and consent never activated) — all against a local reproduction. `docs.google.com` unreachable; see `platform-evaluation.md`. |
| Microsoft Forms | URL + `data-automation-id` | `microsoft-forms@1-experimental` | 100% | 100% | 100% | **Experimental** | `forms.office.com` blocked. Built against the documented automation-id contract. |
| Typeform | URL + `data-qa` | `typeform@1-experimental` | 100% | 100% | 100% | **Experimental** | `form.typeform.com` blocked. One question per screen; only the visible block is scored. |
| Jotform | URL + `form-line` markup | `jotform@1-experimental` | 100% | 100% | 100% | **Experimental** | `jotform.com` blocked. Composite controls (address, full name, date) resolve sub-labels. |
| SurveyMonkey | URL + DOM | `surveymonkey@1-experimental` | 100% | 100% | 100% | **Experimental** | `surveymonkey.com` blocked. Matrix rows flatten to one field each; ranking questions are refused, not half-filled. |
| Any unrecognised site | n/a | falls to generic | — | — | — | **Partial** | The generic engine attempts it. Whether it works depends on the page. |

**Degradation is tested, not assumed.** An adapter requires its platform's *markup*, not just a
URL match. A Typeform URL serving plain markup falls through to `generic-html@1` with the warning
"its expected markup was not found, so FormPilot is reading the page generically", and still
fills correctly — asserted in `tests/integration/platform-adapters.test.ts`.

Each experimental adapter carries a `provenance` string naming what it was actually built and
tested against, and the review panel shows the user a warning saying the support is experimental
and every suggestion should be reviewed.

## Field types

From `research/benchmark/results/latest.md`. `n/a` means no field of that type had a value to
score — model-bound, blocked, or handed to the user by design.

| Unified type | Fields | Mapping acc. | Value acc. | Status |
| --- | --- | --- | --- | --- |
| `text` | 57 | 100% | 100% | **Verified** |
| `radio_group` | 12 | 100% | 100% | **Verified** |
| `textarea` | 8 | 100% | n/a | **Partial** — mapping verified; the value is model-generated and unmeasured |
| `select_one` | 8 | 100% | 100% | **Verified** |
| `checkbox_group` | 6 | 100% | 100% | **Verified** |
| `email` | 5 | 100% | 100% | **Verified** |
| `tel` | 4 | 100% | 100% | **Verified** |
| `date` | 4 | 100% | 100% | **Verified** |
| `url` | 4 | 100% | 100% | **Verified** |
| `file` | 4 | 100% | n/a | **Verified** — the correct behaviour is to hand it to the user |
| `checkbox` | 4 | 100% | n/a | **Verified** — never pre-accepted, by design |
| `number` | 1 | 100% | 100% | **Verified** — single instance |
| `password` | 1 | 100% | n/a | **Verified** — refused, which is the correct outcome |
| `time` | 1 | n/a | n/a | **Untested** — detected, never exercised with a value |
| `rating` | 1 | n/a | n/a | **Partial** — detected and routed; filling a star widget is unexercised |
| `select_many`, `richtext`, `month`, `week`, `search`, `datetime` | 0 | — | — | **Untested** — the schema models them; no fixture exercises them |

## Browsers

| Browser | Status | Note |
| --- | --- | --- |
| Chromium 141 | **Verified** | 42 end-to-end specs, real extension, real service worker |
| Chrome (stable) | **Untested** | Same engine as the Chromium tested; not separately run |
| Edge | **Untested** | Chromium-based; MV3 should apply |
| Firefox | **Untested** | Its MV3 differs in ways nothing here has exercised |
| Safari | **Unsupported** | Requires a Safari Web Extension wrapper that does not exist in this repository |

## Capabilities deliberately not implemented

These are refusals, not gaps. Each is asserted by a test rather than left to convention.

| Capability | Status | Where enforced |
| --- | --- | --- |
| Submitting a form | **Unsupported** | No submission call exists in `extension/src/` or `shared/`; `tests/safety/invariants.test.ts` scans for it |
| Clicking anything that commits the user | **Unsupported** | `isConsequentialAction`; clicking is confined to one reviewed function |
| Solving or bypassing CAPTCHA | **Unsupported** | `captcha` is a blocked phrase; no solving code exists |
| Reading or filling one-time codes | **Unsupported** | 60 adversarial phrasings blocked |
| Entering payment details | **Unsupported** | card, CVV, IBAN, sort code, UPI all blocked |
| Accepting terms or consent on the user's behalf | **Unsupported** | phrase list plus a structural rule: a lone checkbox is never pre-accepted |
| Uploading a document without the user choosing it | **Unsupported** | file fields open the user's own picker |
| Reading a closed shadow root | **Unsupported** | browser boundary, not bypassed |
| Reading a cross-origin frame | **Unsupported** | same-origin policy, not bypassed |
| Standing access to any site | **Unsupported** | `activeTab` only; no broad `host_permissions` |

## Independently measured accuracy

The held-out evaluations are the only place this repository measures behaviour on pages nobody here
wrote. There are two, and **they are not two readings of the same thing.**

| | **v1** | **v2** |
| --- | --- | --- |
| Controls / source files | 307 from 55 | 467 from 105 |
| Overlap with the other | — | **none** |
| Built | before the payment-field fix | after it |
| Accuracy | **82.1%** | **93.6%**  [87.3%, 96.9%] |
| Macro precision | 80.4% | 78.9% |
| Macro recall | 69.3% | 70.5% |
| Macro F1 | **73.1%** | **72.8%** |
| Abstention rate | — | 46.8%  [37.7%, 56.1%] |
| Incorrect-fill rate | — | **0.9%**  [0.2%, 5.0%] |
| Credential / payment controls refused | **29 of 33** | **45 of 45**  [92.1%, 100%] |

**v2's higher accuracy is not an improvement on v1.** v2 was built deliberately payment- and
credential-heavy so the safety fix would be measured on markup it had never seen, which changes the
base rates: a corpus with more fields that should be refused, and refusal being the thing that was
fixed, scores higher for reasons that have nothing to do with getting better at names and addresses.
Macro F1 — which weights every concept equally rather than by frequency — is flat at 73.1 against 72.8,
and that is the more honest comparison. Intervals are Wilson, not normal, because several proportions
sit near 1.

**v1's record is frozen as measured**, including its four missed refusals, in
`research/heldout/results/latest.json`. A post-fix rescore of v1 exists and reads 83.4% with zero
misses; it is stored separately and labelled **not independent**, because the fix was made after seeing
those four failures. See that directory's `README.md`.

By concept on v1: contact fields 93–99% F1; address composition and job title 56–73%;
`links.portfolio` and `person.middle_name` 0% on 3 records each. Non-Latin labels 50.1% macro F1
against 72.1% for Latin ones — the English-only scope boundary with a number attached.

### Against baselines, on v2

| Method | Accuracy | Macro F1 | Abstain | Incorrect-fill | Missed refusals |
| --- | --- | --- | --- | --- | --- |
| A exact label | 81.7% | 61.5% | 58.7% | 0.9% | 0 |
| B substring | 84.4% | 66.5% | 48.6% | 4.6% | 4 |
| C metadata | 88.1% | 68.1% | 43.1% | 6.4% | 4 |
| D semantic | 88.1% | 71.1% | 34.9% | 11.0% | 8 |
| FormPilot (matching only) | 89.0% | 71.2% | 42.2% | 5.5% | 5 |

**FormPilot's margin over the best baseline is 0.1 macro F1 points.** On accuracy alone the difference
between it and semantic matching is not the story either.

The last two columns are. The matching layer scored on its own leaves 5 credential or payment controls
unrefused and a 5.5% incorrect-fill rate; the **shipped pipeline** — matching plus the routing and
safety layers — refuses 45 of 45 and fills 0.9% wrongly. The measurable advantage of this architecture
is therefore **not** its matcher: it is that a wrong-but-plausible match is stopped before it is
offered, and that the abstention is visible to the user rather than silent. Row D is the cautionary
one: the most accurate baseline is also the one that fills wrongly most often, which is what optimising
for accuracy alone buys.

## What this matrix cannot tell you

1. Whether any of the five hosted platforms works against its live product. None is reachable; the
   probe output is in `platform-evaluation.md`.
2. Whether a generated long-form answer is any good. No model provider is reachable.
3. Whether a real person would accept, edit or reject the suggestions. No human study exists; see
   `human-evaluation.md`.
4. How much of a real form falls *outside* the ontology. A field FormPilot models no concept for
   cannot appear in the held-out evaluation either, so coverage is unmeasured.

Every 100% in this document comes from a synthetic corpus authored by the same agent that wrote the
engine. It means the engine does what its author expected. The independently measured figure is
**82.1%**.

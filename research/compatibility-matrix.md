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
| `npm test` | 536 assertions, 29 files, jsdom |
| `npm run test:safety` | 121 of those, safety invariants only, its own CI job |
| `npx playwright test` | Chromium 141.0.7390.37, the built extension loaded, real MV3 service worker |
| `npm run bench` | 17 page states, 120 labelled fields, synthetic corpus |
| `npm run study:matching` | 69 labelled matching cases |
| `npm run study:routing` | 13 pages, 109 fields, routing decisions |
| `npm run study:performance` | 10–500 fields, jsdom scaling curve |

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

| Platform | Recognised | Dedicated adapter | Detection | Mapping | Autofill | Status | Why not Verified |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Generic HTML | yes | `generic-html@1` | 100% | 100% | 100% | **Verified** | — |
| Google Forms | URL + DOM | `google-forms@2` | 100% | 100% | 7/7 | **Partial** | 15-test regression suite covering every v1 question type including grid flattening — but against a local mock. `docs.google.com` is blocked. |
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
| Chromium 141 | **Verified** | 36 end-to-end specs, real extension, real service worker |
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

## What this matrix cannot tell you

1. Whether any of the five hosted platforms works against its live product.
2. Whether a generated long-form answer is any good.
3. Whether a real person would accept, edit or reject the suggestions.
4. How the engine behaves on a page nobody has written a fixture for.

The corpus behind the Verified rows is synthetic and was authored by the same agent that wrote
the engine. 100% on it means the engine does what its author expected. That is the floor, not
the ceiling.

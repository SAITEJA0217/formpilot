# Final validation report

Every claim FormPilot makes, its status, and the command that substantiates it. A claim with no
command behind it is marked **Untested** or **Unsupported** and is listed anyway, because the
absent rows are the ones that matter.

Produced from the runs recorded below, on this container, at the commit this file was added in.
Nothing is estimated and nothing is carried over from an earlier run.

## How to reproduce this report

```bash
npm install && npm --prefix extension install && npm --prefix frontend install
npm run typecheck:all
npm test                   # 536 assertions, 29 files
npm run test:safety        # 121 of those, its own CI job
npm run bench              # 17 page states, 120 labelled fields
npm run study:matching     # 69 matching cases
npm run study:routing      # routing decisions, 13 pages
npm run study:performance  # scaling, 10–500 fields
npm run build:extension && npm run build:apps
npx playwright test        # 38 specs, Chromium 141.0.7390.37
```

## Run record

| Run | Result |
| --- | --- |
| `npm run typecheck` (root: shared, tests, research) | clean |
| `npm run typecheck:extension` | clean |
| `npm run typecheck:frontend` | clean |
| `npm test` | **536 passed**, 29 files, 0 failed |
| `npm run test:safety` | **121 passed**, 0 failed |
| `npx playwright test` | **38 passed**, 0 failed, Chromium 141.0.7390.37 |
| `npm run bench` | detection/mapping/routing 100%, autofill 84/84, **0 safety violations** |
| `npm run study:matching` | 69/69 — **post-hoc, see the caveat below** |
| `npm run study:routing` | 69.7% resolved with no model, 11.0% routed to a model |
| `npm run study:performance` | per-field cost 4.79 → 5.09 ms across 50× size |

## Functional claims

| Claim | Status | Proof |
| --- | --- | --- |
| Detects fields in generic HTML | **Verified** | 9/9 on `basic-html.html` in Chromium; `workflow.spec.ts` |
| Detects fields with no native inputs (ARIA, contenteditable) | **Verified** | `aria-widgets.html`, 7 fields, benchmark + integration |
| Resolves labels from `for`, wrapping, ARIA, table headers, proximity | **Verified** | `tests/unit/labels.test.ts` (25) |
| Maps fields to a 50-concept ontology by multi-signal scoring | **Verified** | `tests/unit/matcher.test.ts` (46); `npm run study:matching` |
| Explains every mapping with weighted signals | **Verified** | the Why? view is read out of the rendered shadow DOM in `workflow.spec.ts` |
| Bands confidence and pre-accepts only high confidence | **Verified** | `tests/unit/confidence.test.ts`; asserted in the rendered panel |
| Writes values so framework-controlled inputs keep them | **Verified** | React 19, Vue 3, Angular 18 (ngModel + FormGroup), Next.js 16 — asserted against framework state, then against the DOM after a forced re-render |
| Verifies every write by reading it back | **Verified** | `tests/integration/fill.test.ts` (22) |
| Re-detects when the page mutates | **Verified** | `dynamic.spec.ts`: conditional render, removal, 5-row burst |
| Does not loop on its own re-render | **Verified** | `dynamic.spec.ts` counts **0** page mutations over 1.5 s after settling |
| Does not duplicate fields or suggestions under mutation | **Verified** | duplicate-label assertion after every mutation scenario |
| Carries decisions across multi-step unmounts | **Verified** | `dynamic.spec.ts`; `tests/unit/session.test.ts` |
| Traverses open shadow roots, including nested | **Verified** | fills through two levels in Chromium |
| Traverses same-origin iframes | **Verified** | fills a field inside a real loaded frame |
| Scales to large forms | **Verified** | 400 fields: 967 ms scan, 2.42 ms/field, every repeated label filled identically |
| Degrades to the generic engine when a platform's markup is absent | **Verified** | `platform-adapters.test.ts`: a Typeform URL with plain markup falls back and still fills |

## Platform claims

| Platform | Status | Why not Verified |
| --- | --- | --- |
| Generic HTML | **Verified** | — |
| Google Forms | **Partial** | 15 regression tests over every v1 question type including grid flattening, all against a local mock. `docs.google.com` is blocked at CONNECT. |
| Microsoft Forms | **Experimental** | `forms.office.com` blocked |
| Typeform | **Experimental** | `form.typeform.com` blocked |
| Jotform | **Experimental** | `jotform.com` blocked |
| SurveyMonkey | **Experimental** | `surveymonkey.com` blocked |

**No hosted form platform has been validated against its live product.** Four adapters are written
against published markup contracts and tested against local reproductions; each reports
`supportStatus: 'experimental'` with a `provenance` string, and the review panel warns the user.

## Safety claims

Every row is asserted by a test, and `.github/workflows/ci.yml` runs `tests/safety` as its own
required job so a regression fails the build.

| Invariant | Status | Proof |
| --- | --- | --- |
| Never submits a form | **Verified** | behavioural (no submit event, `submit()` and `requestSubmit()` spied) plus a source scan: no submission call exists in `extension/src/` or `shared/` |
| Never clicks anything that commits the user | **Verified** | 22 control texts refused; clicking confined to one reviewed function; a radio option reading "Submit now" is skipped |
| Never solves or bypasses CAPTCHA | **Verified** | `captcha` blocked; no solving code exists |
| Never fills a one-time code | **Verified** | 60 adversarial phrasings blocked, including "SMS code" and "the 6-digit code we texted you" |
| Never fills payment details | **Verified** | card, CVV, IBAN, sort code, UPI, expiry all blocked |
| Never accepts a legal agreement or marketing consent | **Verified** | second-person and imperative wording blocked; **and** a lone checkbox is never pre-accepted, whatever its label |
| Never uploads a document unprompted | **Verified** | file fields open the user's own picker; a value handed to a file field is refused |
| Never fills low-confidence sensitive data | **Verified** | write-time re-check ignores a forged `sensitivity: 'normal'` |
| Cannot be bypassed by a hostile caller | **Verified** | `invariants.test.ts` hands a value to every blocked field and asserts the DOM is byte-identical afterwards |
| A safety regression fails the build | **Verified** | mutation-tested: removing the confusable fold, or making the engine trust the caller, each fails the suite |
| Does not over-block ordinary fields | **Verified** | 15 cases; added after a bare `pin` blocked "PIN Code" in 27 of 400 fields |

The first implementation of the policy blocked **27 of 60** evasion techniques. All 60 are blocked
now. A phrase list can never be complete, which is why the structural rule sits behind it.

## Privacy claims

| Claim | Status | Proof |
| --- | --- | --- |
| No standing access to any site | **Verified** | manifest asserted in Chromium as exactly `storage, activeTab, scripting` |
| Reads only the tab you invoke it on | **Verified** | `activeTab` + on-demand injection; no `tabs` permission |
| Logs nothing | **Verified** | zero `console.*` in `extension/src/` and `shared/` |
| Stores nothing outside the device | **Verified** | `chrome.storage.local` only; nothing in `sync` |
| Stores no document bytes | **Verified** | `ProfileDocument` is metadata; the picker is native |
| Sign-out deletes, not flags | **Verified** | token, uid, profile and corrections all removed |
| Export and delete controls work | **Verified** | `EXPORT_PROFILE`, `CLEAR_LOCAL_DATA`, `DELETE_CORRECTIONS` |
| Minimises the profile before the AI request | **Verified** | on a prose batch the endpoint receives `basicProfile` keys `['email','fullName']` and nothing else — asserted against what the endpoint actually received |
| `allowAI: false` makes no request | **Verified** | asserted against the network, not a flag |
| Ships no API key | **Verified** | provider keys are server-side env vars; the Firebase client config is public by design |
| The page URL is sent to the AI path | **Documented, not mitigated** | recorded by a Chromium spec rather than asserted away; `privacy-audit.md` lists it as a residual risk with `allowAI` as the only control |

## Research claims

| Claim | Status | Caveat you must read with the number |
| --- | --- | --- |
| Detection P/R/F1 = 100% | **Verified on a synthetic corpus** | 17 page states, 120 fields, all authored by the same agent as the engine |
| Mapping accuracy = 100% | **Verified on a synthetic corpus** | as above; scored only over asserted mappings |
| Routing accuracy = 100% | **Verified on a synthetic corpus** | as above |
| Autofill 84/84 | **Verified on a synthetic corpus** | measured under accept-everything, which is stricter than the shipped default |
| 89.2% of fields resolved without a model | **Verified** | benchmark denominator is all 120 fields |
| 69.7% resolved without a model | **Verified** | routing-study denominator is all 109 fields *including* blocked and document fields. Both numbers are correct; they count different things. |
| Matching macro F1 = 100% | **Partial — post-hoc** | 65/69 on the first run. Three ontology defects and one harness bug were fixed in response. The dataset is no longer held out. |
| Threshold sweep 0.50–0.95 | **Verified** | coverage 100% → 91.1%; no wrong mappings at any threshold |
| Ablation against 4 baselines and 2 self-ablations | **Verified** | includes a negative result: the margin-based ambiguity guard contributes nothing on this dataset |
| Performance scales linearly in field count | **Verified** | per-field cost 4.79 → 5.09 ms over 50× size, jsdom; 2.42 ms/field at 400 fields in Chromium |
| Generated long-form answer quality | **Unsupported here** | no provider, no key. Routing decisions are measured; answers are not. |
| Human acceptance / correction / override rate | **Unsupported here** | needs participants. No proxy is reported. |
| Generalisation to the open web | **Unsupported here** | no live site is reachable |

## Defects found and fixed during this validation

Listed because a validation pass that finds nothing has usually not looked hard enough.

| Defect | How it was found | Severity |
| --- | --- | --- |
| 30-second stall on first use — `dashboardSync` claimed every message, so Chrome held the port to its own timeout | first real-browser run; measured 30,068 ms | severe; unreachable by jsdom |
| Selector-list mis-composition — `${A} ${B}` with comma lists parses as a list, so the SurveyMonkey adapter claimed any page with one `<fieldset>` | a plain React page came back labelled as a platform reproduction | high; an adapter asserting authority over an unknown page |
| 33 of 60 safety evasions unblocked | adversarial probe written from the attacker's side | high |
| Whole profile sent to the model provider | reading the request path for the privacy audit | high; data over-share |
| `Company` mapped to the employer at 0.970, filled without review | matching study, first run | medium |
| `Why are you leaving your current role?` mapped to `experience.job_title` at 0.930 | exposed by fixing the defect above it | medium; would have written a job title into a prose answer |
| `Notice Period` mapped to employment duration | matching study, first run | medium |
| Bare `pin` blocked "PIN Code" — 27 of 400 fields wrongly refused | performance test that also checked correctness | medium; over-blocking |
| `APPLY_SUGGESTIONS` declared in the message contract, unimplemented | writing the E2E harness | low |
| Root typecheck failing — `dashboardSync.ts` was not a module | running all three typechecks | low; a previous commit message claimed clean |

Four harness bugs were also fixed, and they matter because each would have produced a *misleading
pass*: macro-F1 averaged over a per-strategy denominator (ranked a substring baseline above the
full matcher), `review` cases scored as `decline` cases, a performance total that double-counted
detection, and a React-hydration check that could only ever time out.

## What this report does not establish

1. That FormPilot works on any real website.
2. That a generated answer is any good.
3. That a person would accept its suggestions.
4. That the safety phrase lists are complete — 60 techniques are covered; the structural rule is
   the part that does not depend on wording.
5. That it works in Firefox or Safari.
6. That this report is impartial. It was written by the agent whose work it assesses. Every row
   names its evidence so someone else can check it, which is the most that can be offered from
   here.

# Release checklist

Filled in from runs that happened, at commit `dd812c1`. A box is ticked only where the named command
was executed and its result read; anything else says what it says.

## Build and types

| | Check | Result |
| --- | --- | --- |
| ☑ | `npm run typecheck` (root) | clean |
| ☑ | `npm run typecheck:extension` | clean |
| ☑ | `npm run build:extension` | builds; `dist/injected/universal.js` 265 KB, 83 KB gzipped |
| ☑ | `node tests/e2e/apps/build.mjs` | four framework apps build |
| ☑ | The E2E harness refuses a stale build | added this pass; it spent three runs testing a bundle older than its sources before that |

## Tests

| | Check | Result |
| --- | --- | --- |
| ☑ | `npm test` | **732 passed**, 37 files, 0 failed |
| ☑ | `npm run test:safety` | **232 passed**, its own CI job |
| ☑ | `npx playwright test` | **83 passed**, 10 files, Chromium 141.0.7390.37, built extension loaded |
| ☑ | `npm run study:safety-corpus` | **196 cases, 0 violations**; non-zero exit on any violation, so CI gates on it |
| ☑ | `npm run bench` | detection / mapping / routing 100%, autofill 84/84, **0 safety violations** |

## Independent measurement

| | Check | Result |
| --- | --- | --- |
| ☑ | Held-out v1 record preserved as measured | 82.1%, 4 missed refusals, frozen in `research/heldout/results/latest.json` |
| ☑ | Post-fix rescore of v1 stored separately and labelled not independent | `post-safety-fix-rescore.*` plus a `README.md` saying why |
| ☑ | A new held-out set built after the safety fix | v2: 467 controls, 105 files, **zero overlap with v1** |
| ☑ | v2 configuration frozen before scoring | commit `62eb9c0`, recorded in the output |
| ☑ | v2 split into development / validation / test | 267 / 91 / 109 controls, grouped by file so no author spans two splits |
| ☑ | Nothing tuned after seeing v2 results | one harness bug was fixed and the fix is disclosed in writing in `held-out-evaluation-v2.md` |
| ☑ | Confidence intervals reported | Wilson, throughout |
| ☑ | Test population described alongside every accuracy figure | `held-out-evaluation-v2.md`, and the non-comparability of v1 and v2 stated |
| ☑ | Baselines A–D re-run on v2 | exact label / substring / metadata / semantic, plus FormPilot |
| ☑ | Ablation re-run on v2 | 6 configurations |

## Safety

| | Check | Result |
| --- | --- | --- |
| ☑ | The four v1 payment-field misses fixed at root cause | a prefix rule, a pattern, and a context-sensitive normalizer fix — not four more phrases |
| ☑ | Re-measured on markup never seen | v2: **45 of 45** credential and payment controls refused |
| ☑ | Regression test per discovered failure | `payment-regression.test.ts` (75), `card-expiry-normalization.test.ts` (7), `prose-and-signature.test.ts` (36), `panel-decisions.test.ts` (11) |
| ☑ | Mutation-tested | 10 mutations; every one caught. M8 was **not** caught, so the change it targeted was removed rather than kept |
| ☑ | Payment, CVV, expiry, bank, OTP, password, secret answers, consent, financial authorisation | refused; the corpus asserts each category |
| ☑ | Signatures refused on every control type | added this pass — a typed signature was arriving pre-accepted at 0.93 |
| ☑ | Sensitive and ambiguous fields never silently pre-accepted | 17 of 17 review cases in the corpus |
| ☑ | Refusal reasons are truthful, not merely present | added `reasonMatch`; a newsletter opt-in was being refused as a payment authorisation |
| ☑ | Over-blocking tested from the other side | `notRefused` cases; "Library card name", "PIN Code", "Email signature", "CC" stay usable |

## Privacy

| | Check | Result |
| --- | --- | --- |
| ☑ | Minimum profile data reaches the model path | asserted on the wire in `ai-routing.spec.ts`, by recorded key names not values |
| ☑ | `allowAI: false` sends nothing | asserted: zero requests |
| ☑ | Page URL examined rather than removed blindly | minimised to origin + path; query, fragment and authority credentials dropped, rationale in `privacy-audit.md` |
| ☑ | No secrets in logs | source scan |
| ☑ | No API credentials in any client bundle | source scan; the Firebase client config is public by design |

## Performance

| | Check | Result |
| --- | --- | --- |
| ☑ | 10 / 25 / 50 / 100 / 250 / 500 fields, real Chromium | 164 ms → 1549 ms total preparation |
| ☑ | Same sizes in jsdom | scaling curve, 5 repeats per size |
| ☑ | Synthetic and real-browser figures labelled | separate tables, with an explicit "never quote a jsdom millisecond" |
| ☑ | Memory | page heap growth 2.4 → 5.7 MiB over 50× the fields; no leak signature |
| ☑ | Share of fields routed to a model | 89.2% resolved with no model call |
| ☐ | **Model-call latency** | **not measured** — no provider is reachable, so calls are counted and never executed |

## Documentation

| | Check | Result |
| --- | --- | --- |
| ☑ | Compatibility matrix in the requested column format | Platform / Detection / Mapping / Autofill / Dynamic / Multi-step / Chrome / Status |
| ☑ | Untested cells marked as untested, not inferred | three adapters read `n/t` for Dynamic and Multi-step |
| ☑ | Human-study instruments, all marked NOT YET COLLECTED | `research/human-study/`, seven files |
| ☑ | No claim of universal compatibility | removed from the README this pass; it was the tagline |
| ☑ | No state-of-the-art claim | none made; the matcher's margin over the best baseline is 0.1 macro F1 |
| ☑ | No 100% accuracy claim | every 100% is labelled synthetic and self-authored |
| ☑ | No claim a human study exists | `human-evaluation.md` states the opposite in its first line |
| ☑ | Limitations current | `limitations.md` gained three entries this pass |
| ☑ | Final release report | `research/FINAL_RELEASE_REPORT.md` |

## Publication

| | Check | Result |
| --- | --- | --- |
| ☑ | Everything committed | 34 commits on `claude/exciting-faraday-2jfepm`, working tree clean |
| ☐ | **Pushed to GitHub** | **failed, HTTP 403.** `git push -u origin claude/exciting-faraday-2jfepm` was attempted once and refused: *"Claude doesn't have GitHub access to SAITEJA0217/formpilot for your organization."* The Claude GitHub App is not installed on the repository, or its installation needs re-linking. Not retried, and no force-push attempted — a 403 is an authorisation decision, not a transient failure, and retrying it changes nothing. |

The work is committed locally and complete. Pushing needs someone with access to the repository to
install or re-link the Claude GitHub App; nothing in the commits depends on that.

## Not done, and not claimed

| | | |
| --- | --- | --- |
| ☐ | Any live hosted platform | all five denied at CONNECT; evidence in `research/platform-probe/` |
| ☐ | Generated-answer quality | no provider reachable |
| ☐ | Human study | instruments only |
| ☐ | Content-derived field ids | the ids are still positional; the consequence is fixed where it bit, and the underlying fact is recorded in `limitations.md` |
| ☐ | Non-English forms | the ontology is English-only; v2's held-out split happened to contain no non-Latin labels, so that stratum is empty rather than passing |
| ☐ | Browsers other than Chromium | MV3, one browser tested |

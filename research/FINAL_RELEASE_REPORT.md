# FormPilot — final release report

| | |
| --- | --- |
| **Measured at** | `dd812c1` — every figure below was produced by a run at that commit, which is the one before this report |
| **Date** | 2026-09-29 |
| **Environment** | Linux container, Chromium 141.0.7390.37, Node 22 |
| **Network** | all five hosted form platforms and every model provider denied at CONNECT |
| **Claim** | *FormPilot provides a platform-independent architecture for semantic web-form understanding and automated, human-reviewed form assistance, evaluated across the tested form environments.* |

The last row is the whole claim. "The tested form environments" means the rows of
`compatibility-matrix.md`, not the web.

---

## 1. What was asked, and what this pass did

The brief was to prepare a release: fix four known safety misses, prove the fix on data that had not
been seen, extend coverage, examine privacy, measure performance, prepare human-study instruments, and
write it all down without overclaiming. It explicitly forbade rebuilding the architecture, and that was
not done — every change below is a fix, a test, a measurement or a document.

What that produced, in order of how much it matters:

1. **A multi-step form was writing one step's answers into the next step's fields.** Found by walking a
   six-step application in a real browser. Fixed. §4.
2. **A typed signature was being pre-accepted** at 0.93 confidence, so FormPilot signed the
   application. Fixed. §5.
3. **Two independent consent checkboxes were being merged into one field** labelled with a fieldset
   legend. Fixed. §6.
4. The **four payment-field misses** from the v1 held-out evaluation, fixed at root cause and
   re-measured on a disjoint corpus: 45 of 45 refused. §3.
5. **Prose questions answered from the profile** — "Which company do you admire most and why?" returned
   the user's own employer, pre-accepted. Fixed. §5.
6. A refusal that **gave a false reason** — a newsletter opt-in refused as a payment authorisation. §5.
7. **The page URL** sent to the model path, minimised to origin and path. §8.
8. Coverage, performance, instruments and documents. §7, §9, §11, §13.

Six of those eight were found by writing a test against a structure nobody here had written down yet.
That is the honest summary of the method: the defects were not found by reading the code.

## 2. The numbers

Independent measurement first, because it is the lower number and the one that means anything.

### Held-out, third-party markup, ground truth from the HTML specification

| | v1 | v2 |
| --- | --- | --- |
| Controls / files | 307 / 55 | 467 / 105 |
| Overlap | — | **none** |
| Built | before the safety fix | after it |
| Accuracy | 82.1% | **93.6%**  [87.3%, 96.9%] |
| Macro F1 | 73.1% | 72.8% |
| Abstention | — | 46.8%  [37.7%, 56.1%] |
| Incorrect-fill | — | **0.9%**  [0.2%, 5.0%] |
| Credential / payment refused | 29 / 33 | **45 / 45**  [92.1%, 100%] |

**v2's accuracy is not an improvement on v1's.** v2 was built payment-heavy on purpose so the fix
would be measured on unseen markup; more refusable fields plus a fix to refusal raises accuracy for
reasons unrelated to reading names better. Macro F1 weights every concept equally and is flat — 73.1
against 72.8 — which is the comparison to trust. v1's record stays frozen with its four misses.

### By stratum, v2 held-out split (n = 109)

| Stratum | n | Accuracy | 95% CI | Abstain | Incorrect-fill |
| --- | --- | --- | --- | --- | --- |
| all | 109 | 93.6% | [87.3%, 96.9%] | 46.8% | 0.9% |
| must-refuse | 45 | 100.0% | [92.1%, 100.0%] | 100.0% | 0.0% |
| answerable | 64 | 89.1% | [79.1%, 94.6%] | 9.4% | 1.6% |
| Latin labels | 94 | 94.7% | [88.1%, 97.7%] | 42.6% | 0.0% |
| **non-Latin labels** | **0** | — | — | — | — |
| no label | 15 | 86.7% | [62.1%, 96.3%] | 73.3% | 6.7% |

The non-Latin row is empty because the held-out split happened to contain none. That is a gap in the
measurement, not a pass: v1 measured 50.1% macro F1 on non-Latin labels against 72.1% on Latin ones,
and nothing here supersedes it.

### Self-authored corpora — regression only

| Suite | Result |
| --- | --- |
| `npm test` | 732 passed, 37 files |
| `npm run test:safety` | 232 passed, its own CI job |
| `npx playwright test` | 83 passed, 10 files, Chromium |
| `npm run study:safety-corpus` | 196 cases, **0 violations** |
| `npm run bench` | detection / mapping / routing 100%, autofill 84/84, 0 safety violations |

Every 100% there means "nothing broke on structures we wrote".

## 3. The four payment-field misses

v1 put the policy in front of 33 real credential and payment controls and it missed four:

| Label, as a third party wrote it | Was mapped to |
| --- | --- |
| `CC Name (Full name as given on the payment card)` | `person.full_name` |
| `CC Exp Year` | `experience.years_of_experience` |
| `name="cc-name"`, unlabelled | `person.full_name` |
| `name="cc-exp-year"`, unlabelled | `experience.years_of_experience` |

Sixty self-authored adversarial cases had missed all four, because they were written by someone
imagining how a payment field might be labelled, and real authors name them after the `autocomplete`
token they pair the input with.

**Two of the four were a matching bug, not a policy gap.** `normalizeText` expanded `exp` to
`experience` unconditionally, so `CC Exp Year` reached the matcher reading "cc experience year" and
landed on a high-scoring, entirely wrong concept. The fix is structural in three pieces: a `cc-`
*prefix* rule on `autocomplete` so a token the spec has not defined yet is still caught; a pattern
requiring a payment noun beside the card word, so `CC` meaning carbon copy survives; and
context-sensitive expansion — `exp` becomes `expiry` after a payment word, `experience` elsewhere.

Verified on v2: 45 of 45. The v1 number was not restated.

## 4. The multi-step defect

The most serious finding. Accept step one of a six-step application, press Next, press Fill:

```
Degree           <- "Saiteja Reddy Kotha"
University       <- "saiteja@example.com"
Graduation Year  <- "+91 98765 43210"
```

The applicant's name written into their degree field, with no warning.

**Cause.** The detector names fields positionally — `f0`, `f1`, `f2` in document order — so an id
identifies a place on the current screen, not a field. A multi-step form re-detects per step and
numbers each step from zero again. The review panel carried a decision over whenever the id matched.
That carry-over exists so a framework re-render does not discard the user's work; keyed on position it
copied one step's answers, values and accepted flags alike, onto the next step's questions.

**Fix.** Each decision records the identity of the field it was made about — type plus label, mirroring
what the session layer already computed as `fieldKey` — and a carry-over requires both to match.
Extracted as a pure `reconcileDecisions` so the invariant is pinned by a fast unit test.

**Why nothing caught it.** The session-state suite tests the session layer, which keys by `fieldKey`
and was always right. The panel kept its own map keyed by id. Every other E2E spec drives a
single-screen form, where positional ids are unique and the bug cannot appear.

**A second consequence.** On the review step the declaration checkbox — `blocked`, refused by policy —
occupied `f0` and inherited a `ready` field's accepted flag, so the panel showed a refused consent
control marked **Accepted**. Nothing was written, because the fill path filters on the suggestion's own
status. The defect was in what the user was told, and a panel that contradicts itself about a refusal
is corrosive exactly where the safety layer needs to be believed.

## 5. Safety, beyond the payment fields

Three further defects, all found by the six-step fixture.

**A typed signature was pre-accepted.** "Type your full name to sign" is a text input whose label
contains "full name", so it resolved at 0.93 — above the auto-accept band. FormPilot signed the
application and the user would have found out afterwards. The consent rule missed it because that rule
only applied to boolean controls, and a signature is not a checkbox. Signing is now refused on every
control type, with negatives so "Email signature" stays fillable.

**A prose question was answered from the profile.** "Which company do you admire most and why?"
returned the user's own employer at 0.93, pre-accepted. The prose rule existed but matched only a
marker at the *start* of a label. A marker anywhere now counts when the label is a question, which
leaves "What is your job title?" resolving from the profile.

**A refusal gave a false reason.** The financial-authorisation rule treated a bare "subscribe" as a
payment commitment, so every "Subscribe to the newsletter" checkbox was refused with *"Authorising a
payment is a decision only you can make."* Right verdict, false explanation — and invisible to any
test that counted refusals. The sentence beside a refusal is the user's only basis for judging it; one
visibly wrong on a newsletter teaches them to discount it on a real payment control. A subscription now
counts as financial only where the control names money.

That last one changed the corpus as well as the code: cases take a `reasonMatch`, so a correct verdict
with a wrong explanation is a violation. And `notRefused`, so an over-blocking counterweight can assert
what it actually means — "Signature dish" has no correct concept, so `fill` was the wrong requirement.

### Mutation testing

Ten mutations. Nine caught:

| Mutation | Caught by |
| --- | --- |
| Remove the confusable fold | `tests/safety` |
| Make `fillField` trust the caller's sensitivity | `tests/safety` |
| Drop the `cc-` prefix rule | `tests/safety` + corpus |
| Delete the payment patterns | `tests/safety` + corpus |
| Revert the `exp` → `expiry` normalizer fix | `card-expiry-normalization.test.ts` |
| Treat a bare "subscribe" as a payment | `tests/safety` + corpus (5 violations) |
| Remove the signature rule | 13 tests + 8 corpus violations |
| Revert prose detection to openers only | 2 tests + 2 corpus violations |
| Carry a decision over on positional id alone | 5 assertions |

**The tenth was not caught, and that is the useful one.** A lone-token-alias discount in the matcher
survived its own mutation: reverting it left every test green, because the prose fix already covered
the case it was written for. Rather than add a test to justify it, the change was removed — an untested
change to the core matcher with no case behind it is risk without benefit. It is recorded here because
"we reverted our own change" is the part of a mutation-testing result that usually goes unmentioned.

The fifth row is also worth naming: reverting the normalizer fix left the whole safety suite green,
because the policy-level pattern independently caught the same labels and masked it. Defence in depth
hiding a hole in one layer. The matcher-level test exists because of that.

## 6. Coverage added

| Area | What was added | What it found |
| --- | --- | --- |
| Platform adapters | 16 Chromium specs, 20 selection unit tests, per-platform docs | SurveyMonkey was detected by URL alone; Typeform and Jotform fingerprints did not cover their own adapters' markup; Google Forms accepted a URL with no markup |
| Google Forms | a second fixture — checkbox grid, conditional sections, split date/time, descriptions — plus 21 integration tests and 8 Chromium specs | the split date widget produced **three fields all labelled "Start date"**, indistinguishable in the panel and liable to receive a whole date in the day box |
| Generic / frameworks | a React app with uncontrolled inputs, div-built widgets and nested components, plus 8 Chromium specs and 10 unit tests | two independent consent checkboxes merged into one field labelled with the fieldset legend |
| Multi-step | a six-step fixture and 8 Chromium specs | §4 |

The consent-merge fix costs something, and the cost is stated rather than buried: ARIA options now
merge only where the author said so — an enclosing `role="group"`, `role="radiogroup"` or
`role="listbox"`, or a container a platform adapter supplied. A div-built multi-select with no ARIA
group markup therefore arrives as several boolean fields, and a profile list cannot be applied to it in
one go. Splitting a question costs clicks; merging two puts one decision behind a label describing
another, and where either is consent that is the case the safety layer exists to prevent.
`tests/unit/aria-option-grouping.test.ts` tests both directions, because the trade only holds if the
capability it costs is the smaller one.

## 7. Platforms

| Platform | Detection | Mapping | Autofill | Dynamic | Multi-step | Chrome | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Generic HTML | 100% | 100% | 100% | yes | yes | yes | **Verified** |
| Google Forms | 100% | 100% | 7/7 | yes | yes | yes | **Partial** |
| Microsoft Forms | 100% | 100% | 100% | n/t | n/t | yes | **Experimental** |
| Typeform | 100% | 100% | 100% | yes | yes | yes | **Experimental** |
| Jotform | 100% | 100% | 100% | n/t | n/t | yes | **Experimental** |
| SurveyMonkey | 100% | 100% | 100% | n/t | n/t | yes | **Experimental** |
| Any unrecognised site | — | — | — | yes | yes | yes | **Partial** |

`n/t` is "not tested", and it appears three times because those reproductions are single-screen. Their
real platforms do support dynamic and multi-step behaviour, which is why the cell is not "no".

**No adapter can leave Experimental from this environment.** `forms.office.com`,
`form.typeform.com`, `www.jotform.com`, `www.surveymonkey.com` and `docs.google.com` are all denied at
CONNECT; `research/platform-probe/probe.sh` records the evidence. Every percentage above is against a
local reproduction of published markup. A pass means the adapter read *that structure* correctly in a
real browser. It does not mean the live product still emits it.

## 8. Privacy

The model path sends a minimised profile, the fields that need help, and form context. No field value
is ever sent. `allowAI: false` sends nothing at all, asserted as zero requests.

**The page URL was examined rather than removed.** What depends on it is the company: a generated
answer to "why do you want to join us?" cannot be written without knowing who is asking, and the
hostname carries that. What was *also* being sent was everything after the path — and a real careers
URL carries `?email=you@example.com&token=8f3ac1` or `#candidateId=99201`. A prefilled email, a session
token, an application id, ad identifiers: none helps write an answer, all of it was landing in request
logs. `minimiseUrlForAI` keeps origin and path and drops the query, the fragment and any authority
credentials; a `file:`, `data:` or `chrome-extension:` URL is dropped entirely.

Asserted on the wire rather than at the function: the E2E harness stamps every page with a `?fp=e2eN`
nonce, so every page in that suite has a real query string that must be gone on arrival, and the test
also checks the page still carries it.

**What this does not fix.** The path is kept, and a path can carry an opaque application id beside the
job title. Stripping segments that "look like ids" is guesswork and a wrong guess destroys the
grounding the URL is sent for. So this reduces exposure rather than eliminating it, and `allowAI:
false` remains the only control that sends nothing.

No API credential appears in any client bundle. The Firebase client config is public by design.

## 9. Performance

Real Chromium, built extension loaded, median of 3 runs:

| Fields | Scan + inject | Panel render | **Total preparation** | Per field | Heap growth |
| --- | --- | --- | --- | --- | --- |
| 10 | 100 ms | 64 ms | **164 ms** | 10.00 ms | 2.4 MiB |
| 25 | 144 ms | 70 ms | **214 ms** | 5.76 ms | 2.7 MiB |
| 50 | 196 ms | 66 ms | **262 ms** | 3.92 ms | 2.7 MiB |
| 100 | 279 ms | 81 ms | **360 ms** | 2.79 ms | 3.1 MiB |
| 250 | 565 ms | 129 ms | **694 ms** | 2.26 ms | 4.3 MiB |
| 500 | 1355 ms | 194 ms | **1549 ms** | 2.71 ms | 5.7 MiB |

Per-field cost falls as forms grow, then **rises for the first time at 500** — 2.26 ms to 2.71 ms,
about 20% worse. The curve is not perfectly linear at the top. 500 controls on one screen is past
anything seen in the wild, so it is headroom, but the direction is upward and a synthetic-only
measurement would have hidden it: jsdom has no layout engine, which is precisely why 500 was added to
the browser suite this pass.

Heap growth is sublinear — 50× the fields for 2.4× the memory, no leak signature. Measured through
Chromium's non-standard `performance.memory`, which is coarse and covers the page heap only.

**89.2% of fields resolve with no model call**, and the remaining 10.8% produce 10 batched calls across
the benchmark corpus — one request per page, not per field. **The latency of those calls is not
measured.** No provider is reachable, so calls are counted and never executed, which means every figure
above is the deterministic path only.

## 10. What the architecture is actually worth

The most useful result in this report, and it is not flattering to the matcher.

On v2's held-out split:

| Method | Accuracy | Macro F1 | Abstain | Incorrect-fill | Missed refusals |
| --- | --- | --- | --- | --- | --- |
| A exact label | 81.7% | 61.5% | 58.7% | 0.9% | 0 |
| B substring | 84.4% | 66.5% | 48.6% | 4.6% | 4 |
| C metadata | 88.1% | 68.1% | 43.1% | 6.4% | 4 |
| D semantic | 88.1% | 71.1% | 34.9% | 11.0% | 8 |
| FormPilot, matching only | 89.0% | 71.2% | 42.2% | 5.5% | 5 |
| **FormPilot, shipped pipeline** | **93.6%** | **72.8%** | 46.8% | **0.9%** | **0** |

**The matcher beats the best baseline by 0.1 macro F1 points.** That is nothing. What the last two
columns show is the actual contribution: the matching layer alone leaves 5 credential controls
unrefused and fills 5.5% of fields wrongly; the shipped pipeline — matching plus routing plus the
safety layer — refuses 45 of 45 and fills 0.9% wrongly.

So the measurable advantage of this architecture is **not its semantic matching**. It is that a
wrong-but-plausible match is stopped before it is offered, and that the abstention is visible to the
user instead of silent. Row D makes the same point from the other side: the most accurate baseline is
also the one that fills wrongly most often, which is what optimising accuracy alone buys.

Ablation, same split, and it says the same thing:

| Configuration | Accuracy | Macro F1 | Incorrect-fill | Missed refusals |
| --- | --- | --- | --- | --- |
| 1 label only | 84.4% | 67.9% | 7.3% | 6 |
| 2 + name / id | 82.6% | 67.8% | 16.5% | 12 |
| 3 + control type | 82.6% | 67.8% | 16.5% | 12 |
| 4 + semantic gates | 88.1% | 69.8% | 8.3% | 6 |
| 5 + confidence calibration | 89.0% | 71.2% | 5.5% | 5 |
| 6 full system | 93.6% | 72.8% | 0.9% | 0 |

Configuration 2 is worth pausing on: adding `name` and `id` signals made accuracy *worse* and more than
doubled the incorrect-fill rate, because a `name` attribute is a developer's shorthand and matching on
it confidently is how `cc-exp-year` became years of experience. The signals that help are the gates,
the calibration and the safety layer — the parts that decide *not* to answer.

## 11. Human study

**None was conducted. No participants were recruited. No human data exists.**

`research/human-study/` holds seven instruments, every one marked **NOT YET COLLECTED**: a protocol, the
tasks and their ground truth, a consent form for IRB review, three questionnaires, a data schema, and a
pre-registered analysis plan.

Two parts of it are designed to keep a future study honest rather than flattering:

- **The silent-error rate**: fields where the tool offered a wrong value, pre-accepted it, and the
  participant did not intervene — a wrong answer neither party decided on. It is the one measure that
  can show assistance being *worse*, and it is designated primary before anyone knows what it says.
- **An admission of underpowering, in advance**: n = 24 is sized for completion time and is explicitly
  not enough for rare errors. At the 0.9% incorrect-fill rate measured above, ~1,800 scoreable fields
  yields a handful and an interval spanning "no difference" to "materially worse". Written down first,
  so a wide interval is reported as one and never as a null result.

Acceptance rate, correction rate, rejection rate and time saving are **not reported anywhere in this
repository**, because they are properties of people and no people were involved.

## 12. Methodology, and where it was not clean

Four disclosures. Each is here because the alternative was to leave it out.

**The v1 record was nearly destroyed.** Running `npm run study:heldout` after the safety fix overwrote
`research/heldout/results/latest.json` — the only independent measurement the project had. Restored from
git, and the post-fix rescore is now stored under a different name with a `README.md` explaining that it
is **not** independent, because the fix was made after seeing those four failures.

**A v2 harness bug was fixed after seeing v2's results.** The harness scored a field as a missed refusal
that the real router blocks by concept policy. Fixing it improved the numbers, which is exactly when a
correction deserves suspicion, so it is disclosed in `held-out-evaluation-v2.md` rather than absorbed.

**A change was reverted for lack of evidence.** §5's tenth mutation.

**The E2E suite was testing a stale build.** The harness checked that `extension/dist` existed but not
that it was newer than its sources, and three runs were spent against a bundle that predated a fix. It
now fails hard, naming the newer file. The reverse case is what makes it worth a hard failure: a bundle
built *before* a regression would pass and say nothing.

## 13. Documentation

| File | What it holds |
| --- | --- |
| `compatibility-matrix.md` | every platform, framework, field type and browser, with the status vocabulary that refuses the word "Supported" |
| `held-out-evaluation.md` / `-v2.md` | the two independent measurements, and why they are not comparable |
| `baseline-comparison.md`, `ablation-study.md` | §10's tables with their method |
| `security-audit.md` | the refusals, the mutation table, the closed finding, the false-reason case |
| `privacy-audit.md` | every request, what it carries, and the URL determination |
| `performance-study.md` | §9, synthetic and real separated |
| `limitations.md` | 15 sections, three added this pass |
| `human-study/` | seven instruments, all NOT YET COLLECTED |
| `RELEASE_CHECKLIST.md` | every check with its result, including the unticked ones |

## 14. What is not claimed

- **Not universal compatibility.** The README said "Universal" until this pass; it was unsupported and
  is gone.
- **Not state-of-the-art.** No literature review, no comparison against a published system. The
  baselines are re-implementations written for this harness.
- **Not 100% accuracy.** The independent figure is 93.6% on a payment-heavy corpus and 89.1% on its
  answerable fields. Every 100% in this repository is synthetic and self-authored.
- **Not any live platform.** Nothing has run against a real hosted form.
- **Not generated-answer quality.** Unmeasured.
- **Not a human study.** None exists.
- **Not non-English forms.** The ontology is English-only. v2's held-out split contained no non-Latin
  labels, so that stratum is empty rather than passing; v1 measured 50.1% macro F1 there.
- **Not browsers other than Chromium.**

## 15. Known limitations that were not fixed

Distinguished from §14 because these are real defects with a decision attached, not absent evidence.

1. **Field ids are positional.** Fixed where it bit (§4); the ids themselves are unchanged, because
   they thread through the element map, the selectors, the suggestion pipeline and the benchmark's
   ground truth, and that is not a change to make in a release pass. A field id is safe within one
   detection and never across two.
2. **The review panel can cover the form it is reviewing.** A fixed 400px right-hand column over a
   centred form in a narrow window sits on the form's own buttons — measured with
   `document.elementFromPoint`, not estimated. Closing it gives them back. Any fix is a design decision
   (dock, drag, collapse) and should not be chosen from one fixture's geometry.
3. **A div-built multi-select with no ARIA group markup splits into separate boolean fields.** The
   deliberate cost of §6.
4. **Three adapters have no dynamic or multi-step coverage.** `n/t` in §7.
5. **Model-call latency is unmeasured.** No provider reachable.

## 16. Reproducing this

```bash
npm ci
npm run typecheck && npm run typecheck:extension
npm test                        # 732 assertions, 37 files
npm run test:safety             # 232 of those, its own CI job
npm run study:safety-corpus     # 196 cases, exits non-zero on any violation
npm run bench                   # 17 page states, 120 fields, synthetic
npm run study:heldout-v2        # 467 controls, 105 third-party files
npm run study:performance       # 10-500 fields, jsdom
npm run build:extension         # required before the E2E suite
npx playwright test             # 83 specs, Chromium, built extension loaded
```

Run `npm run build:extension` before Playwright, or the harness will refuse to start and tell you which
source file is newer than the bundle.

`research/heldout-v2/manifest.json` carries a SHA-256 per source file, so the corpus is verifiable
without re-fetching. Re-fetching needs network access to the listed hosts, which this environment does
not have for the platform domains.

## 17. Honest closing assessment

**What this release is.** A Chrome extension that reads a form it has not seen, maps fields onto a
profile ontology with explainable provenance, abstains when it is unsure, refuses categorically where
policy says it must, and writes only what a user has accepted. Measured on 467 controls from 105
third-party files: 93.6% accuracy, 0.9% incorrect-fill, 45 of 45 credential and payment controls
refused. Verified in a real browser across generic HTML, ARIA widgets, shadow DOM, same-origin iframes,
four frameworks, dynamic forms and six-step wizards.

**What it is not.** It has never run against a live hosted form platform. Its generated answers have
never been evaluated. No person has ever used it in a study. Its matcher is worth 0.1 macro F1 points
over a simple semantic baseline.

**What this pass actually demonstrated.** That the architecture's value is in the layers around the
matcher, not the matcher — §10 measures that rather than asserting it. And that a system can pass 732
assertions, a 196-case safety corpus and an independent held-out evaluation while writing an
applicant's name into their degree field, because no test had ever walked a six-step form. Six of the
eight defects in §1 were found the same way: by writing down a structure nobody had written down yet
and running it in a real browser.

The most useful thing here is therefore not a number. It is that the failure modes that mattered were
invisible to every form of review except execution against something new.

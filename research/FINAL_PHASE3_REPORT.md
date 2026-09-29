# FormPilot Phase 3 — final validation report

External validation. The phase that tried to measure FormPilot against data it did not author, and
succeeded in one way it did not expect and failed in one way it could not avoid.

| | |
| --- | --- |
| **Software version** | FormPilot 2.0.0 |
| **Configuration freeze** | commit `6e01e8e`, 2026-09-29T04:51:10Z |
| **Report date** | 2026-09-29 |
| **Environment** | Node v22.22.2, jsdom 26, Chromium 141.0.7390.37, one shared cloud container |

---

## 1. Executive summary

Phase 3 set out to validate FormPilot against live hosted platforms, an independent held-out dataset,
baselines, an ablation, and human participants. Two of those were impossible here and are reported as
impossible; three were done properly.

**What could not be done.** All five hosted form platforms are refused at CONNECT by this
environment's network policy — re-confirmed with a committed probe script. No model provider is
reachable and no API key exists. No human participants are available. So live-platform validation,
generated-answer quality and every human metric are **not measured**, and no proxy for them is
reported anywhere.

**What was done, and matters most.** Third-party *markup* turned out to be reachable through
`raw.githubusercontent.com`, which made a genuinely independent evaluation possible. 658 form controls
were extracted from 134 HTML files written by unrelated authors — Mozilla's own autofill test corpus,
Stripe's checkout examples, the Nova Scotia and Government of Canada design systems, WCAG reference
forms, a French government COVID form, and a long tail of independent projects. The ground truth is
each file's *own* `autocomplete` attribute, whose meaning the WHATWG HTML specification fixes, and the
attribute is withheld from every method under test. Neither the inputs nor the ground truth is this
project's judgement.

**The headline result, on 307 held-out controls from 55 files:**

| Measure | Value |
| --- | --- |
| Accuracy | **82.1%** |
| Macro precision | 80.4% |
| Macro recall | 69.3% |
| Macro F1 | **73.1%** |
| Real credential/payment controls correctly refused | 29 of 33 |

That is substantially below the 100% FormPilot's own corpus reports, and it is the figure that means
something. Three findings sit alongside it and are more useful than the number:

1. **FormPilot beats a plain substring baseline by 1.3 F1 points.** On labels written by strangers the
   elaborate multi-signal matcher buys very little raw accuracy. Its real advantage is calibration —
   it converts eight confident errors into eight abstentions — which no single accuracy figure can see.
2. **Metadata, not sophistication, carries the signal.** Reading `name` and `id` as well as the label
   is worth +22.8 accuracy points; every scoring refinement after that is worth a few.
3. **Four real safety misses.** A label beginning "CC " is not in the secret phrase list, so
   `CC Name (Full name as given on the payment card)` maps to `person.full_name`. Sixty self-authored
   adversarial cases missed this; independent data found it immediately.

The configuration was frozen before the held-out run, with per-file hashes recorded and re-checked
afterwards. **Nothing was tuned in response to any of these results**, including the safety gap.

---

## 2. Current architecture

Unchanged from Phase 2. No architecture was rebuilt and no component replaced.

```
page → adapter registry → detection → normalization → unified form schema
                                                            ↓
                                      multi-signal matcher → confidence bands → provenance
                                                            ↓
                                      router: deterministic | assist | generate | manual | blocked | document
                                                            ↓
                                      safety policy → review panel → user approval
                                                            ↓
                                      interaction engine → verified DOM write
```

Six platform adapters over one unified schema; a 50-concept ontology; matching from weighted signals
with type gates, negatives and a context bonus; three-band confidence; per-decision provenance; a
safety policy consulted at normalization, routing and write time; and a review panel that gates every
write.

---

## 3. Platforms tested

| Platform | How | Verdict |
| --- | --- | --- |
| Generic HTML | real pages in Chromium | **Verified** |
| Google Forms | local reproduction, 15 integration tests + 4 Chromium specs | **Partial** |
| Microsoft Forms | local reproduction, jsdom | **Experimental** |
| Typeform | local reproduction, jsdom | **Experimental** |
| Jotform | local reproduction, jsdom | **Experimental** |
| SurveyMonkey | local reproduction, jsdom | **Experimental** |
| React 19, Vue 3, Angular 18, Next.js 16 | real framework builds in Chromium | **Verified** |

Reachability probe, committed as `research/platform-probe/probe.sh`:

```
docs.google.com                000  UNREACHABLE (curl exit 56)
forms.office.com               000  UNREACHABLE (curl exit 56)
form.typeform.com              000  UNREACHABLE (curl exit 56)
www.jotform.com                000  UNREACHABLE (curl exit 56)
www.surveymonkey.com           000  UNREACHABLE (curl exit 56)
registry.npmjs.org             200  reachable        ← control
raw.githubusercontent.com      301  reachable        ← control
```

The two controls establish that the network works and the denial is specific to these hosts.

---

## 4. Platform compatibility

`research/compatibility-matrix.md` carries the full tables in the five permitted statuses. The word
"Supported" does not appear in it, because it hides the difference between writing code for something
and watching it work.

Dynamic and multi-step behaviour on the four experimental platforms is **Untested**, not Experimental:
no reproduction exercises a conditional branch or a step transition for them. Typeform is the
exception, since its reproduction advances one question at a time natively.

**Not claimed anywhere:** universal compatibility, full compatibility, "works everywhere", or that any
of the five hosted platforms works against its live product today.

---

## 5. Held-out dataset

| | |
| --- | --- |
| Corpus | 658 controls, 134 files, 299 distinct labels |
| Split | dev 203 / validation 148 / **held-out 307**, grouped by file |
| Ground truth | each file's own `autocomplete` token, per the HTML spec |
| Withheld from all methods | the token itself |
| Stored | extracted metadata only, never source files |

Construction, sampling rule and every decision declared before the first run are in
`research/final-methodology.md`. The split is a SHA-256 of the file path modulo 100, grouped so no
author's markup spans two splits. Nothing was filtered: 37 non-Latin labels and 136 unlabelled
controls stay in, and 72 credential or payment controls are scored as a refusal class.

**A structural caveat that survives even this design:** the *concept inventory* is still this
project's. A field whose meaning FormPilot models no concept for cannot appear, because it would carry
no `autocomplete` token either. 82.1% is accuracy *within the ontology's scope*; coverage of a real
form is unmeasured.

---

## 6. Baseline results

Held-out set, matching only, safety policy excluded so the comparison is of strategies.

| Method | Accuracy | Macro P | Macro R | Macro F1 | Wrong | Declined |
| --- | --- | --- | --- | --- | --- | --- |
| A exact label | 44.0% | 76.4% | 29.4% | 41.3% | 7 | 157 |
| B exact + metadata | 72.3% | 83.3% | 60.9% | 68.9% | 13 | 56 |
| C substring | 75.6% | 79.6% | 68.2% | 71.8% | 31 | 24 |
| D token similarity | 74.9% | 78.5% | 70.4% | 72.9% | 39 | 10 |
| **FormPilot** | **75.9%** | 80.4% | 69.3% | **73.1%** | 31 | 20 |

Exact matching is not viable — baseline A declines half the answerable fields. FormPilot wins, by 1.3
F1 over substring and 0.2 over token similarity, which on 307 records with no confidence intervals
should be read as **comparable, not better**. The difference worth noting is in the last two columns:
against baseline D, FormPilot makes 8 fewer confident errors and 10 more abstentions.

No comparison against published systems exists, and **no state-of-the-art claim is made or supported.**

---

## 7. Ablation results

| Configuration | Accuracy | Macro F1 | Missed refusals |
| --- | --- | --- | --- |
| label only | 51.5% | 52.9% | 16 |
| + metadata | 74.3% | 72.5% | 29 |
| + control type | 73.9% | 72.5% | 30 |
| + confidence floor | 75.9% | 73.1% | 24 |
| + ambiguity guard | 75.9% | 73.1% | 23 |
| + safety policy | **82.1%** | 73.1% | **4** |

Metadata **+22.8** accuracy points. Control type **−0.4** — slightly harmful here, retained because it
is load-bearing elsewhere, but this evaluation gives it no support. Confidence floor **+2.0**.
Ambiguity guard **0.0 on both metrics**, converting 8 confident errors into 9 abstentions. Safety
policy **+6.2** and 19 additional refusals.

F1 climbs only between tiers 1 and 4. Everything after the confidence floor improves the system
without improving its F1, because what it improves is *when the system declines to answer*. A
single-metric evaluation would call the last two mechanisms dead weight; the metric is simply blind to
them.

---

## 8. AI routing results

No model was called: no provider is reachable. What is measured is the size and shape of the model's
job, and the plumbing around it.

| Measure | Hybrid routing | Always ask the model |
| --- | --- | --- |
| Fields sent to a model | 12 of 109 | 97 of 109 |
| Batched requests | 9 | 12 |
| Request payload | 17.2 KiB | **41.4 KiB** |

Hybrid sends **12.4% of the fields and 41.4% of the bytes**. Payload is the honest cost proxy
available; provider pricing is per token against a price list this environment cannot see, so no
currency figure is reported.

The model's whole job on the benchmark corpus is 8 prose answers and 4 uncertain mappings, and
`research/routing/results/latest.md` names every field.

**Verified about the path** (8 Chromium specs against a labelled deterministic stub): which fields are
sent, one batched request per page rather than one per field, the profile minimised before it leaves
the device, answers merging back unaccepted, and `allowAI: false` making no request at all — asserted
against the network, not a flag.

**Not measured:** accuracy, latency, monetary cost, long-form quality, correction rate.

---

## 9. Human evaluation

**None. No participants, no human data.**

Acceptance rate, correction rate, rejection rate, manual and assisted completion time, and user
overrides are all **not measured**. Each is a property of people and this environment has none, nor an
ethical-review route to recruit any.

`research/human-evaluation.md` records the study design that would produce them — within-subject,
counterbalanced, 20–30 participants, synthetic profile supplied by the study so no personal data is
collected at all, pre-registered analysis — and names the numbers that are **not** proxies for it. In
particular the benchmark's "51.7% ready" is review *burden*, a property of the system, and must never
be read as an acceptance rate.

---

## 10. Safety results

| | |
| --- | --- |
| Safety assertions | **121 / 121 pass** |
| Benchmark safety violations | **0** |
| Held-out must-refuse controls | 29 of 33 correctly refused |
| Mutation tests | 2 / 2 caught |

Verified: never submits a form (no submission call exists in the source we author, plus behavioural
spies); never clicks anything consequential (22 control texts refused, clicking confined to one
reviewed function); never touches CAPTCHA; never fills a one-time code (60 adversarial phrasings);
never enters payment details; never accepts a legal agreement (phrase list **plus** a structural rule
that a lone checkbox is never pre-accepted); never uploads a document unprompted; never fills
low-confidence sensitive data (policy re-checked at write time, so a forged `sensitivity` is ignored).

`tests/safety` runs as its own required CI job, and CI fails the build if the benchmark records any
violation.

**Open finding — 4 missed refusals on third-party markup.**
`CC Name (Full name as given on the payment card)` → `person.full_name`;
`CC Exp Year` → `experience.years_of_experience`. A pre-existing gap: the phrase list covers `cc-name`
as an `autocomplete` token and `card number` as text, but not a label beginning "CC ". Bounded —
nothing is submitted and every suggestion is reviewable — but a high-confidence mapping to
`person.full_name` could be pre-accepted, putting the user's name in a cardholder field.

**Deliberately not fixed.** The configuration was frozen before the held-out run, and patching against
that set would convert the project's only independent measurement into a training set. The fix is
small and specified in `security-audit.md`; it needs a fresh corpus.

---

## 11. Privacy results

| Claim | Status |
| --- | --- |
| No standing site access | **Verified** — manifest asserted in Chromium as exactly `storage, activeTab, scripting` |
| Reads only the tab you invoke it on | **Verified** — `activeTab` + on-demand injection, no `tabs` permission |
| Logs nothing | **Verified** — zero `console.*` in `extension/src/` and `shared/` |
| Stores nothing off-device | **Verified** — `chrome.storage.local` only |
| Stores no document bytes | **Verified** — metadata only; native picker |
| Profile deletion, correction deletion, session clearing | **Verified** — `CLEAR_LOCAL_DATA`, `DELETE_CORRECTIONS` (local **and** server), sign-out removes everything |
| **Minimum necessary data sent to the model** | **Verified against what the endpoint receives** |
| Ships no API key | **Verified** — provider keys server-side only |

The Phase 2 finding — that the AI path sent the entire profile — is closed and proved twice. A unit
test pins the redaction function; an end-to-end spec in Chromium asserts on the keys the stub endpoint
*actually receives*. On a prose-only batch:

```
basicProfileKeys: ["email", "fullName"]
profileKeys:      ["basicProfile", "education", "experience", "languages", "projects", "skills"]
```

`phone`, `dateOfBirth`, `gender` and `basicProfile.address` are gone, as are `documents`, `address`,
`socialLinks`, `preferences`, `profiles`, `activeProfileId` and `userId`. The stub records key *names*,
never values, so the fixture holds no copy of anything sensitive.

**One residual risk, documented rather than mitigated:** the page URL *is* sent, deliberately, to
ground the answer. `allowAI: false` is the only control. A Chromium spec records this rather than
asserting it away.

---

## 12. Performance results

Chromium 141, built extension, median of 3 runs.

| Fields | Scan + inject | Panel render | **Total preparation** | Per field | Heap growth |
| --- | --- | --- | --- | --- | --- |
| 10 | 88 ms | 58 ms | **146 ms** | 8.80 ms | 2.2 MiB |
| 25 | 117 ms | 56 ms | **173 ms** | 4.68 ms | 2.6 MiB |
| 50 | 168 ms | 66 ms | **234 ms** | 3.36 ms | 2.6 MiB |
| 100 | 267 ms | 80 ms | **347 ms** | 2.67 ms | 3.2 MiB |
| 250 | 549 ms | 111 ms | **660 ms** | 2.20 ms | 4.4 MiB |

Per-field cost falls as forms grow, because injection is a fixed cost that amortises. A 250-field form
is reviewable in 0.66 s. Heap growth is sublinear — 25× the fields for 2× the memory — so no leak
signature.

jsdom scaling over 10–500 fields: per-field cost 5.79 → 4.91 ms, so **50× the fields costs 42.5× the
time**; linear in field count. Detection is 94% of normalization at 500 fields.

**Synthetic and real are not interchangeable.** jsdom is about twice as slow per field as Chromium at
250 fields. No jsdom millisecond is quoted as a user-facing latency. AI latency is unmeasured.

---

## 13. Limitations

The four that should temper every number above, in order:

1. **No live platform, no model, no humans.** Three whole classes of claim are unavailable here, and
   each is reported as unmeasured rather than estimated.
2. **82.1% is scoped.** Accuracy *within the ontology's inventory*. A field FormPilot has no concept
   for cannot appear in the evaluation, so coverage of a real form is unknown. The corpus also skews
   toward authors who write `autocomplete` attributes, who likely write better labels too — which
   flatters the figure — while third-party attribute errors count against it — which depresses it.
   Neither is quantified.
3. **The matching study is not evidence.** 69/69 is post-hoc: it scored 65/69, three defects were
   fixed, and it is now a regression suite. `research/matching/README.md` says so before the number.
4. **Everything here was written by the agent that wrote the code.** Every claim names the command or
   file that substantiates it so a reader can check rather than trust. That is not a substitute for
   independent review.

Full list in `research/limitations.md`, which gained three sections in this phase.

---

## 14. Reproducibility

```bash
npm install && npm --prefix extension install && npm --prefix frontend install
npm run typecheck:all
npm test                      # 536 assertions, 29 files
npm run test:safety           # 121 of those, its own CI job
npm run bench                 # synthetic regression guard
npm run study:heldout         # the independent evaluation
npm run study:routing         # hybrid vs always-ask
npm run study:performance     # jsdom scaling curve
npm run build:extension && npm run build:apps
npx playwright test           # 42 specs, Chromium 141
./research/platform-probe/probe.sh
```

`research/heldout/corpus.json` is committed, so `study:heldout` reproduces byte-identically from any
checkout. `npm run heldout:fetch` re-fetches from 138 upstream repositories and will produce a
*different* corpus — which would no longer be held out against the frozen configuration and would need
a fresh freeze.

Every numerical result in `research/` names its dataset, sample size, procedure, metric, date and
software version.

---

## 15. Git commit

Branch `claude/exciting-faraday-2jfepm`. Configuration frozen at `6e01e8e` before the held-out run;
the seven files that determine matching behaviour were hashed at freeze and re-checked unchanged after.

No commit was deleted, rewritten, squashed or force-pushed in this phase. `git rev-list --count
a799f7c..HEAD` gives the current commit count; no figure is quoted here, because any commit stating one
invalidates it.

---

## 16. GitHub push status

See the closing section of this report for the attempt made at the end of Phase 3. The Phase 2 attempt
failed with **HTTP 403** (`Claude doesn't have GitHub access to SAITEJA0217/formpilot for your
organization`), and read access works while write does not.

If the push fails again, that is an **authentication and access failure**, not a code problem, and the
repository owner can push the branch after installing the Claude GitHub App at
<https://github.com/apps/claude/installations/select_target>:

```bash
git push -u origin claude/exciting-faraday-2jfepm
```

Alternatively, from a clone at `a799f7c`, using the verified bundle supplied with this session:

```bash
git fetch /path/to/formpilot-phase2.bundle 'refs/heads/*:refs/heads/*'
git checkout claude/exciting-faraday-2jfepm
git push -u origin claude/exciting-faraday-2jfepm
```

---

## 17. The single highest-value next step

**Run this checkout on an unrestricted network**, then in order:

1. Fix the four missed refusals and measure against a **fresh** third-party corpus.
2. Validate the four experimental adapters against live platforms. Everything needed is in place —
   adapters, reproductions, the E2E harness, the scoring. Either four rows move to Verified or the
   reproductions are wrong and the adapters get fixed. Both outcomes beat anything else outstanding.
3. Have someone else label a corpus. The held-out design removes this project from the inputs and the
   ground truth, but not from the concept inventory.
4. A provider key and a grounding-faithfulness harness.
5. The human study specified in `human-evaluation.md`.

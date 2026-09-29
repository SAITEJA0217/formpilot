# FormPilot Phase 2 — final report

From "universal architecture plus synthetic tests" to "validated in a real browser, with the
gaps named". This is the narrative; the tables live in
[FINAL_VALIDATION_REPORT.md](./FINAL_VALIDATION_REPORT.md) and
[compatibility-matrix.md](./compatibility-matrix.md).

---

## 1. What this phase was for

Phase 1 built a universal form engine and proved it against jsdom. That proof had a hole in it
that no amount of jsdom testing could close: **the extension had never been run.** Every claim
rested on a DOM implementation with no MV3 service worker, no extension message ports, no
`chrome.scripting`, no real shadow-root rendering and no real same-origin policy. The entire class
of defect that lives in those seams was untested by construction.

So the goal was not more features. It was to find out which of the existing claims survive contact
with a browser, and to relabel the ones that do not.

## 2. What was actually built

| Added | Why |
| --- | --- |
| Playwright harness loading the built extension into Chromium 141 | the only way to test the seams |
| 38 end-to-end specs | workflow, frameworks, dynamic pages, AI path, latency |
| Real React 19 / Vue 3 / Angular 18 apps, plus the repo's own Next.js route | controlled components are the real-world failure mode |
| Four platform adapters (Microsoft Forms, Typeform, Jotform, SurveyMonkey) | four platforms were "recognised but untested" |
| Adversarial safety suite, 121 assertions, its own CI job | the policy was a phrase list with no second layer |
| `shared/privacy/redact.ts` | the whole profile was going to the model provider |
| Three research studies: matching, routing, performance | three claims were unmeasured |
| `.github/workflows/ci.yml` | there was no CI at all |

Totals moved from 343 assertions in 22 files to **536 in 29 files**, plus 38 browser specs, plus
four reproducible studies.

## 3. The finding that justified the whole phase

**A 30-second stall on first use.**

`dashboardSync.ts` returned `true` from its `chrome.runtime.onMessage` listener for *every*
message, not just the one it handled. Chrome reads that as "an async reply is coming", so it held
the sender's port open until its own timeout instead of reporting "no receiver" immediately. The
popup awaited that ping before injecting the engine. On any dashboard-origin tab, the first scan
took **30,068 ms**. After the fix: **4 ms**.

jsdom has no port semantics, so it had nothing to get wrong. This is the shape of every finding in
this phase: not a logic error, but an integration assumption that only a real browser can falsify.

## 4. Frameworks: the claim that was an argument

Phase 1's documentation said, of Vue and Angular:

> the engine uses standard DOM events these frameworks listen to, which is an argument, not a
> measurement

That was honest, and the argument was correct. It was also standing in for a test. Three of the
four are now measured.

Each app exposes `__appState()` reading its **framework** state, and `__nudge()` to force a render
that touches no field. Every test asserts twice: against framework state, then against the DOM
after a re-render — which is when a write that never reached state disappears.

| Framework | Result |
| --- | --- |
| React 19, controlled | writes reach `useState`, survive a forced re-render |
| Vue 3, `v-model` | runtime template compiler, so real `v-model` codegen runs |
| Angular 18, `ngModel` + reactive `FormGroup` | both models updated; asserted via `getRawValue()` |
| Next.js 16 App Router | real `next dev`, post-hydration, values survive |

Svelte, Solid and Ember remain an argument, and are still labelled as one.

## 5. Platform adapters, and a bug they exposed

Four adapters, each written against its platform's published markup contract and tested against a
local reproduction. Each declares `supportStatus: 'experimental'` with a `provenance` string naming
what it was built against, and the panel warns the user.

Building them surfaced a defect worth the whole exercise. All four composed their marker selectors
as `` `${QUESTION} ${TITLE}` ``. CSS gives the comma lower precedence than the descendant space, so
when both parts are comma-separated *lists*, `'a, b' + ' ' + 'c, legend'` parses as a list whose
last member is a bare `legend`. The requirement that both parts be present is silently dropped.

The SurveyMonkey adapter therefore claimed **any page containing one `<fieldset>`**. A plain React
application page came back labelled as a Microsoft Forms reproduction. That is precisely the
failure a platform-adapter layer must not have: an adapter asserting authority over a page it knows
nothing about.

Fixed with an explicit cross-product helper, applied to all five adapters including Google Forms
(correct by luck — neither of its constants had a comma).

## 6. Safety: 27 of 60

The policy was probed from the attacker's side rather than the feature's: 60 ways a page could
label a control so a naive check misses what it is. **The shipped policy blocked 27.**

What got through:

- One-time codes with no keyword from the list — "SMS code", "Authenticator app code", "MFA code",
  "the 6-digit code we texted you"
- Payment rails that never say "card" — "Sort code", "UPI ID", "Expiry date", "ATM PIN"
- Government identifiers beyond the US and Indian ones — driving licence, voter ID, National
  Insurance
- Knowledge-based authentication — security question answers, mother's maiden name
- Consent in anything but the first person. The list caught "I agree"; it missed "By ticking this
  box you agree to our terms" and "Tick here to confirm you have read the privacy notice"
- Look-alike letters: "Раssword" with a Cyrillic Р and а reads identically to a human and matched
  nothing
- Buttons that commit the user but say "Finish", "Done", "Confirm", "Proceed", "Buy now"

All 60 are blocked now. But **making a phrase list longer does not fix a phrase list**, so a
structural rule sits behind it: a lone checkbox is never pre-accepted, whatever its confidence or
wording, because ticking one asserts something in the user's name and that guarantee should not
depend on reading a label correctly. A checkbox *group* is a choice among options, so it is
unaffected.

The suite is mutation-tested — removing the confusable fold, or making the engine trust its
caller's `sensitivity`, each fails it — and runs as its own required CI job.

## 7. Over-blocking, which is also a defect

Widening those lists broke something. A bare `pin` in the secret list blocked **"PIN Code"**, which
in India is a Postal Index Number, not a credential: 27 of 400 generated fields came back refused.

It was caught by a *performance* test that also checked correctness, not by the safety suite that
had just been extended. A safety net that catches ordinary fields stops being used, so 15 cases now
assert that ordinary fields stay fillable, and short ambiguous tokens are only listed in qualified
forms.

## 8. The matching study, and its honest caveat

69 hand-labelled cases, written from what real application forms ask, committed before the harness
ran. **First run: 65/69.** Three of the four failures were real defects:

| Case | Was | Diagnosis |
| --- | --- | --- |
| `Company`, `Company Name` | employer at 0.970, filled without review | the alias is right but, as a whole label, genuinely context-dependent |
| `Notice Period` | employment duration at 0.720 | a bare `period` alias; the profile holds no notice period at all |
| `Reason for leaving` | motivation prompt at 0.583 | token overlap with "reason for applying", which asks the opposite question |

Fixing the third exposed a worse one underneath: `Why are you leaving your current role?` then
matched `experience.job_title` at **0.930**, because the label contains "current role". FormPilot
would have written "Software Engineer" into a textarea asking for an explanation, at auto-accept
confidence.

The `Company` fix produced the phase's one genuinely new mechanism. A concept can now declare an
alias **context-dependent**: the mapping is kept, because it is usually right, but capped below the
auto-accept band unless a section heading corroborates it. `Company` lands at 0.850 and asks the
human; `Current Company` stays at 0.970 and does not. The distinction came out of the data rather
than being designed in advance.

**The study now scores 69/69, and that number is post-hoc.** The dataset is no longer held out — it
is a regression suite with a research harness attached. `matching/README.md` says so before quoting
the figure. A number that would mean something needs labels written by someone else.

## 9. Harness bugs that would have flattered the results

Four, each of which would have produced a *misleading pass*:

1. **Macro-F1 averaged over a per-strategy denominator.** A strategy that answers less touches
   fewer concepts and gets an easier average. It ranked a plain substring baseline **above** the
   full matcher. Now averaged over a fixed gold concept set.
2. **`review` cases scored as `decline` cases.** Naming the likely concept at medium confidence —
   the ideal outcome — counted as an error. Expectations are now three-way.
3. **A performance total that double-counted detection**, because `normalizeForm` calls
   `detectFields` internally. Overstated the total by about a third.
4. **A React-hydration check that could only ever time out**, looking for `__react`-prefixed
   properties React 19 does not expose as enumerable.

Recorded because a harness is code too, and an unverified harness verifies nothing.

## 10. The observer, tested rather than reasoned about

The MutationObserver is the riskiest part of the engine: it re-scans on change, and the re-scan
renders a panel, which is itself a DOM change. Rather than arguing that this terminates, the spec
installs its own observer **in the page** and asserts **zero mutations over a 1.5-second window**
after a change has settled. It also drives a five-row burst to check the debounce coalesces, and
asserts no duplicate cards after every mutation scenario.

## 11. Browser-security boundaries, confirmed rather than assumed

Phase 1 asserted cross-origin frames were unreachable — against a frame pointing at
`example.com`, which this container's network policy blocks. That test could only ever have proven
that a blocked request fails.

The test server now binds to all interfaces, so the same content is reachable as both `127.0.0.1`
and `localhost` — **different origins to the browser, same fixture content.** The cross-origin
frame now genuinely loads and is genuinely unreadable, and the engine reports it rather than
crashing. Same for the closed shadow root: the spec confirms the *page* cannot reach it either,
which is the boundary working as intended.

## 12. Privacy: the whole profile was leaving

Reading the request path for the privacy audit turned up a data-minimisation gap. The AI request
forwarded the stored profile **whole**, and the server route serialises whatever it receives
straight into the prompt. Asking a model to draft one paragraph sent the provider:

- phone number, date of birth, gender, full postal address
- every saved document's label and note
- **every alternate persona** the user keeps for other applications
- the account id and the local confidence thresholds

`shared/privacy/redact.ts` now sends only what the request's modes can use. Verified against what
the endpoint actually received: on a prose-only batch it gets `basicProfile` keys
`['email', 'fullName']` and nothing else.

This is minimisation, not anonymisation. What remains is still personal data going to a third
party, and the audit says so.

## 13. One thing documented rather than fixed

The **page URL is sent** to the AI path, deliberately, to ground the answer — "why do you want to
join?" needs to know which company is asking. It also means the provider's request logs can see
which form the user was filling, and there is no setting that sends the questions without the URL.

`allowAI: false` is the only control, and with it off the rule engine still resolves 89.2% of
benchmark fields. A Chromium spec **records** this rather than asserting it away, and
`privacy-audit.md` lists it as a residual risk. It is a real trade-off the user cannot currently
tune, and calling it anything else would be dishonest.

## 14. What the numbers say

| Measurement | Result | Read with |
| --- | --- | --- |
| Detection / mapping / routing | 100% over 17 page states, 120 fields | synthetic, self-authored corpus |
| Autofill | 84/84 | measured under accept-everything, stricter than the default |
| Safety violations | 0 | over a corpus that includes a page of nothing but sensitive fields |
| Fields resolved with no model | 89.2% (benchmark) / 69.7% (routing study) | different denominators; both stated |
| Model's job on the corpus | 12 of 109 fields — 8 prose, 4 mappings | counted, not executed |
| Matching, macro F1 | 100% | **post-hoc**; 65/69 on the first run |
| Threshold sweep 0.50→0.95 | coverage 100% → 91.1%, zero wrong mappings throughout | 69 cases is small |
| Scaling | per-field 4.79 → 5.09 ms across 50× size | jsdom; shape transfers, milliseconds do not |
| Real latency | 400 fields in 967 ms, 2.42 ms/field | Chromium 141, this container |

## 15. What is still not known

1. **Whether any of this works on a real website.** The network policy blocks
   `docs.google.com`, `forms.office.com`, `form.typeform.com`, `jotform.com` and
   `surveymonkey.com`. No adapter can be promoted past **Experimental** from here.
2. **Whether a generated answer is any good.** No provider, no key. The routing decisions around it
   are measured; the answers are not.
3. **Whether a person would accept the suggestions.** Needs participants. No proxy is reported.
4. **Whether the engine generalises.** Both corpora were authored by the same agent as the engine.
5. **Svelte, Solid, Ember.** Still an argument.
6. **Firefox and Safari.** Untested; Safari would need a wrapper that does not exist here.

## 16. The single highest-value next step

**Run this checkout on an unrestricted network.** Everything needed is already in place: four
adapters, their fixtures, the E2E harness, and a benchmark that will score them. The only thing
missing is the ability to reach the sites. That one change would move four rows from
**Experimental** to **Verified** or reveal exactly where they break — and either outcome is worth
more than anything else on this list.

After that, in order: an independent annotator relabelling the matching dataset so its score means
something again; a provider key and a grounding-faithfulness harness; a human study.

## 17. Honest accounting of this phase

- 15 commits, all local. **The push was refused with HTTP 403** — see section 18.
- 10 product defects found and fixed, 2 of them severe, plus 4 harness bugs.
- 1 new mechanism (context-dependent aliases) that came from the data, not from a design document.
- 1 finding documented rather than fixed, deliberately.
- 1 regression introduced and caught by a test written for a different purpose.
- 0 claims upgraded without a run behind them. Four platforms stayed **Experimental** despite
  working perfectly against their fixtures, because working against a fixture is not the claim.

**This report was written by the agent that wrote the code.** That is a conflict of interest, and
the only mitigation offered is that every claim names the command or file that substantiates it.
`npm test`, `npx playwright test` and the four study commands are the review; this document is just
the narrative over them.

## 18. Push status

**The push failed. It has not succeeded, and nothing here should be read as if it had.**

```
$ git push -u origin claude/exciting-faraday-2jfepm
remote: Claude doesn't have GitHub access to SAITEJA0217/formpilot for your organization.
fatal: unable to access 'https://github.com/SAITEJA0217/formpilot/':
       The requested URL returned error: 403
exit code: 128
```

Confirmed absent from the remote: `git ls-remote origin 'refs/heads/claude/*'` returns nothing.
Read access works (the clone and `git ls-remote` succeed through the container's git proxy); only
write is refused.

**All 15 commits are intact on the local branch `claude/exciting-faraday-2jfepm`, on top of
`a799f7c`.** Nothing was squashed, rebased, force-pushed or discarded. The push was attempted
again after the final commit, with the same result.

To recover, either:

**A. Grant access, then push.** Install the Claude GitHub App on the repository at
<https://github.com/apps/claude/installations/select_target> (an organization owner may need to do
this), or reconnect GitHub from claude.ai settings. Then, from this session:

```bash
git push -u origin claude/exciting-faraday-2jfepm
```

**B. Fetch the bundle.** A verified git bundle of all 15 commits was sent to you. From your own
clone at `a799f7c`:

```bash
git fetch /path/to/formpilot-phase2.bundle 'refs/heads/*:refs/heads/*'
git checkout claude/exciting-faraday-2jfepm
git push -u origin claude/exciting-faraday-2jfepm
```

The bundle was verified with `git bundle verify` before sending: it carries
`refs/heads/claude/exciting-faraday-2jfepm` and requires `a799f7c`, which your clone already has.

# Security audit

An audit of what FormPilot refuses to do, and how each refusal is enforced. Written by reading the
code and running the suite, not from the documentation.

| | |
| --- | --- |
| **Procedure** | `npm run test:safety` (232 assertions), `npm run study:safety-corpus` (196 cases), `npx playwright test` (83 specs), source scan |
| **Date** | 2026-09-29 |
| **Software version** | FormPilot 2.0.0, commit `6e01e8e` |
| **Result** | 121/121 safety assertions pass; 0 violations in the benchmark; **4 missed refusals on the held-out set** |

## Threat model

FormPilot runs in the user's browser, on pages the user chooses, with access to a profile the user
supplied. Three adversaries matter:

1. **A hostile page** trying to get FormPilot to type something sensitive into it, or to take an
   action on the user's behalf. Addressed by the safety policy and the interaction engine's refusals.
2. **A compromised or buggy caller inside the extension** trying to push a write past the policy.
   Addressed by re-checking the policy at write time, tested by handing the engine hostile input.
3. **The extension itself over-reaching** beyond what the user authorised. Addressed by the
   permission surface: `activeTab` and on-demand injection, no standing host access.

Out of scope: an attacker with code execution in the extension's own context (they have the ID token
either way), a malicious Chrome build, and the model provider's own handling of a prompt.

## Refusals, and how each is enforced

| FormPilot does not | Enforcement | Evidence |
| --- | --- | --- |
| Submit a form | no submission call exists in the source we author | source scan over `extension/src/` and `shared/` finds no `requestSubmit(` or `.submit(`; behavioural test spies on both and on the `submit` event |
| Click anything that commits the user | `isConsequentialAction` guards every click site | 22 control texts refused; clicking is confined to one reviewed function, `clickElement` in `setters.ts`; a radio option reading "Submit now" is skipped |
| Solve or bypass CAPTCHA | `captcha` is a blocked phrase; no solving code exists | `tests/safety/evasion.test.ts` |
| Bypass anti-bot systems | nothing simulates human timing, and no request is made to any page | no such code path; the engine only writes and reads the DOM |
| Fill a one-time code | 60 adversarial phrasings blocked | includes "SMS code", "Authenticator app code", "MFA code", "the 6-digit code we texted you" |
| Enter payment details | card, CVV, IBAN, sort code, UPI, expiry blocked | `tests/safety/evasion.test.ts`; **see the held-out gap below** |
| Accept a legal agreement or marketing consent | phrase list **plus** a structural rule | second-person and imperative wording blocked; a lone checkbox is never pre-accepted whatever its label |
| Upload a document unprompted | file fields open the user's own picker | a value handed to a file field is refused with `file-picker` |
| Fill low-confidence sensitive data | policy re-checked at write time | a forged `sensitivity: 'normal'` on a one-time-code field is ignored and nothing is written |

## Defence in depth, not a phrase list

The policy is consulted at three independent points: when a form is normalized (so the panel can
explain a refusal), when the router assigns a route, and again inside `fillField` immediately before
a write. Only the third is a real guarantee — a test that checks the suggestion list would pass even
if `fillField` ignored `sensitivity` entirely, which is why `tests/safety/invariants.test.ts` plays
the part of a hostile caller and asserts the DOM is byte-identical afterwards.

Behind the phrase list sits one rule that does not depend on reading a label correctly: **a lone
checkbox is never pre-accepted.** Ticking one asserts something in the user's name, and a phrase
list will always miss some wording. A checkbox *group* is a choice among options and is unaffected.

## The suite has teeth

Mutation-tested. Every deliberate regression below was caught by the suite named beside it:

| Mutation | Caught by |
| --- | --- |
| Remove the confusable fold (so "Раssword" with Cyrillic letters stops matching) | `tests/safety` |
| Make `fillField` trust the caller's `sensitivity` instead of re-checking | `tests/safety` |
| Drop the `cc-` prefix rule from `BLOCKED_AUTOCOMPLETE_PREFIXES` | `tests/safety` + corpus |
| Delete `PAYMENT_FIELD_PATTERNS` | `tests/safety` + corpus |
| Revert the context-sensitive `exp` → `expiry` expansion in the normalizer | `tests/unit/card-expiry-normalization.test.ts` |
| Treat a bare "subscribe" as a payment authorisation again | `tests/safety` + corpus |

The fifth row is the one worth noting. Reverting the normalizer fix left the whole safety suite green,
because the policy-level payment pattern independently caught the same labels and masked the
regression — defence in depth hiding a hole in one layer. The matcher-level test exists because of
that: a mutation the safety suite cannot see is a mutation the safety suite cannot be trusted on.

`.github/workflows/ci.yml` runs `tests/safety` as its own required job, separate from the main test
run, so a regression reads as the security defect it is rather than one line inside a 536-assertion
run. CI also fails the build if the benchmark records any safety violation, which covers the whole
pipeline rather than the policy in isolation.

## Closed finding: 4 missed refusals on third-party markup

The v1 held-out evaluation put the policy in front of 33 real credential and payment controls it had
never seen. It refused 29 and missed 4:

| Label, as a third party wrote it | Was mapped to |
| --- | --- |
| `CC Name (Full name as given on the payment card)` | `person.full_name` |
| `CC Exp Year` | `experience.years_of_experience` |
| `name="cc-name"`, no visible label | `person.full_name` |
| `name="cc-exp-year"`, no visible label | `experience.years_of_experience` |

Only independent data surfaced these; 60 self-authored adversarial cases did not. The phrase list had
been written by someone imagining how a payment field might be labelled, and real authors name them
after the `autocomplete` token they pair the input with.

**Root cause, not four more phrases.** Two of the four were a *matching* bug rather than a policy
gap: `normalizeText` expanded `exp` to `experience` unconditionally, so `CC Exp Year` arrived at the
matcher reading "cc experience year" and landed on `experience.years_of_experience` — a high-scoring,
entirely wrong mapping. The fix is in three structural pieces:

- `BLOCKED_AUTOCOMPLETE_PREFIXES = ['cc-']`, a prefix rule rather than an enumeration, so a payment
  token the WHATWG table has not defined yet is still refused.
- `PAYMENT_FIELD_PATTERNS`, which requires a payment noun beside the card word, so `CC` meaning
  carbon copy and `Library card name` stay fillable.
- Context-sensitive expansion in the normalizer: `exp` becomes `expiry` after a payment word and
  `experience` everywhere else.

**Verified independently.** The four labels are reproduced verbatim in
`tests/safety/payment-regression.test.ts`. The fix was then measured on
`research/heldout-v2/` — a corpus with zero file overlap with v1, built after the fix and frozen
before scoring — where all 45 credential and payment controls were refused. The v1 record stays
exactly as it was measured, at 82.1% with the 4 misses, in
`research/heldout/results/latest.json`; see that directory's `README.md` for why the post-fix
rescore of v1 is *not* an independent number and must not be cited as one.

## Over-blocking is also a defect

A safety net that catches ordinary fields stops being used. Phase 2 added a bare `pin` to the secret
phrases and blocked "PIN Code" — an Indian Postal Index Number — in 27 of 400 generated fields. 15
assertions now guard the other direction, and short ambiguous tokens (`pin`, `tin`) appear only in
qualified forms. Every widening of these lists needs a matching test on the usable side.

### A true verdict can still carry a false reason

The financial-authorisation rule added this phase listed a bare `subscribe|subscription` as a payment
commitment. Every `Subscribe to the newsletter` checkbox in the React, Vue and Angular apps was then
refused — the right outcome, a marketing opt-in being the user's own choice — but refused with
*"Authorising a payment is a decision only you can make."* Nothing about those controls involves
money.

This is a defect and not a cosmetic one. The refusal count was correct, so any test that counted
refusals stayed green; three E2E specs caught it only because they assert the *reason* shown. It
matters because the sentence beside a refusal is the user's whole basis for judging whether the
refusal was sensible. A reason visibly wrong on a newsletter opt-in trains them to discount the same
sentence on a real payment control, which is the one place it has to be believed.

The fix draws the line at consideration: a subscription counts as a financial commitment only where
the control also names money (`MONEY_SIGNAL_PATTERNS`), and otherwise falls through to the consent
rule, which already covered `newsletter` and `subscribe` and gives the reason that applies. Both
paths still refuse.

Two things were hardened as a result. `corpus.json` cases now take an optional `reasonMatch`, so a
correct verdict with a wrong explanation is a corpus violation rather than a pass — the v2 corpus
could not express that, which is why it had nothing to say here. And the measured effect of the fix
was checked rather than assumed: re-running `research/heldout-v2/` afterwards reproduced
`latest.json` bit-for-bit, confirming the change altered explanation text only and no measured
outcome, so it needs no new held-out evaluation.

## A blocked control shown as accepted

Found by walking a six-step application in Chromium, and worth separating from the multi-step bug it
came from because the safety consequence is its own thing.

The review panel carried a decision over whenever the positional field id matched. On the review step
of a six-step form, the declaration checkbox — `blocked`, refused by policy, never fillable — occupied
`f0`, the same id a `ready` field had held on step one. So it inherited that field's accepted flag and
the panel showed a refused consent control marked **Accepted**.

Nothing was written: the fill path filters on the suggestion's own status, so a blocked field is
dropped regardless of any decision recorded against it, and the E2E suite asserts the declaration
stays unticked. The defect was in what the user was *told*. A panel that shows a refusal as accepted
contradicts itself, and a user reading it has no way to know which half is true — which is corrosive
in exactly the place the safety layer needs to be believed.

`tests/unit/panel-decisions.test.ts` asserts a blocked control is never accepted through a carry-over,
and reverting the fix (mutation M10) fails five of its assertions.

## Secrets

No API key is present in any client-side bundle. Provider keys are read server-side only, from
environment variables documented in `.env.example`. The Firebase *client* config is public by design
— it ships in every Firebase web app, and access is governed by `firebase/firestore.rules`. The
end-to-end suite's Firebase values are throwaways defined in `playwright.config.ts` rather than a
committed `.env.local`, so a checkout carries no file that resembles real configuration.

## What this audit does not cover

- Any live hosted platform. None is reachable; see `platform-evaluation.md`.
- The model provider's handling of a prompt. Out of FormPilot's control and not its claim to make.
- Completeness of the phrase lists. 60 evasion techniques are covered, and the 4 real-world misses
  are now fixed at root cause and independently re-measured on a disjoint corpus. A label nobody has
  thought of can still be misclassified, which is why the structural rules exist, why the corpus is
  append-only, and why nothing is ever submitted.
- Independence. This audit was written by the agent that wrote the code. Every row names the test or
  file that substantiates it so a reader can check rather than trust.

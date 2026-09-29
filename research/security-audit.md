# Security audit

An audit of what FormPilot refuses to do, and how each refusal is enforced. Written by reading the
code and running the suite, not from the documentation.

| | |
| --- | --- |
| **Procedure** | `npm run test:safety` (121 assertions), `npx playwright test` (42 specs), source scan |
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

Mutation-tested. Two deliberate regressions, each caught:

| Mutation | Result |
| --- | --- |
| Remove the confusable fold (so "Раssword" with Cyrillic letters stops matching) | suite fails |
| Make `fillField` trust the caller's `sensitivity` instead of re-checking | suite fails |

`.github/workflows/ci.yml` runs `tests/safety` as its own required job, separate from the main test
run, so a regression reads as the security defect it is rather than one line inside a 536-assertion
run. CI also fails the build if the benchmark records any safety violation, which covers the whole
pipeline rather than the policy in isolation.

## Open finding: 4 missed refusals on third-party markup

The held-out evaluation put the policy in front of 33 real credential and payment controls it had
never seen. It refused 29 and missed 4:

| Label, as a third party wrote it | Mapped to |
| --- | --- |
| `CC Name (Full name as given on the payment card)` | `person.full_name` |
| `CC Exp Year` | `experience.years_of_experience` |

**This is a genuine pre-existing gap.** The phrase list covers `cc-name` as an `autocomplete` token
and `card number` as visible text, but not a label beginning "CC ". Only independent data surfaced
it; 60 self-authored adversarial cases did not.

Severity is bounded but real: nothing is submitted, and every suggestion appears in the review panel
before it is written — but a plausible mapping to `person.full_name` can be pre-accepted at high
confidence, so a user clicking through would put their name into a cardholder field. That is a
privacy leak into a payment form, not a financial loss.

**Not fixed in this phase, deliberately.** The held-out configuration was frozen at `6e01e8e` before
the evaluation ran, and patching the policy against results from that set would destroy the only
independent measurement the project has. The fix is known and small — add `cc name`, `cc exp`,
`cc csc`, `cc type` and a `\bcc\b` pattern to `SECRET_PHRASES`, with tests — and it needs a fresh
held-out corpus to be measured honestly. It is the highest-priority item in `final-results.md`.

## Over-blocking is also a defect

A safety net that catches ordinary fields stops being used. Phase 2 added a bare `pin` to the secret
phrases and blocked "PIN Code" — an Indian Postal Index Number — in 27 of 400 generated fields. 15
assertions now guard the other direction, and short ambiguous tokens (`pin`, `tin`) appear only in
qualified forms. Every widening of these lists needs a matching test on the usable side.

## Secrets

No API key is present in any client-side bundle. Provider keys are read server-side only, from
environment variables documented in `.env.example`. The Firebase *client* config is public by design
— it ships in every Firebase web app, and access is governed by `firebase/firestore.rules`. The
end-to-end suite's Firebase values are throwaways defined in `playwright.config.ts` rather than a
committed `.env.local`, so a checkout carries no file that resembles real configuration.

## What this audit does not cover

- Any live hosted platform. None is reachable; see `platform-evaluation.md`.
- The model provider's handling of a prompt. Out of FormPilot's control and not its claim to make.
- Completeness of the phrase lists. 60 evasion techniques are covered and 4 real-world misses are
  now documented. A label nobody has thought of can still be misclassified, which is why the
  structural rule exists and why nothing is ever submitted.
- Independence. This audit was written by the agent that wrote the code. Every row names the test or
  file that substantiates it so a reader can check rather than trust.

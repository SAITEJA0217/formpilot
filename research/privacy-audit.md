# Privacy audit

An audit of what FormPilot stores, what leaves the device, and what a third party can see.
Written by reading the code, not the documentation. Every claim below names the file it comes
from so it can be checked rather than believed.

| | |
| --- | --- |
| **Procedure** | source audit; `npm test` (536 assertions); `npx playwright test ai-routing` (8 specs) |
| **Date** | re-verified 2026-09-29 |
| **Software version** | FormPilot 2.0.0, commit `6e01e8e` |
| **Result** | all controls verified; the minimisation claim is asserted against what the endpoint actually receives |

Re-run the audit after any change to `extension/src/background/`, `shared/privacy/`, or
`frontend/src/app/api/ai/`.

## Summary

| Question | Answer |
| --- | --- |
| Does the extension read pages you visit? | Only the tab you invoke it on, only when you invoke it. |
| Does it have standing access to any site? | No. `activeTab` + on-demand injection; no broad `host_permissions`. |
| Does page content leave the device? | Field *labels* do, on the AI path only, and only with `allowAI` on. Field *values* never do. |
| Does your profile leave the device? | Yes, on the AI path, minimised to what the request can use. |
| Is anything logged? | No. There is not one `console.*` call in `extension/src/` or `shared/`. |
| Can you see what is held? | Yes — Options → Export. |
| Can you delete it? | Yes — Options → Clear local data, and Delete corrections (local + server). |
| Can you turn the AI path off? | Yes — one setting, `allowAI`. With it off, no request is made at all. |

## Permissions

From `extension/public/manifest.json`:

```
permissions:               storage, activeTab, scripting
host_permissions:          http://localhost:3000/*, http://127.0.0.1:3000/*
optional_host_permissions: http://*/*, https://*/*
```

**What this means.** There is no `tabs` permission and no broad host permission. The extension
cannot enumerate your tabs, cannot read their URLs, and cannot run on any site until you click
its button — at which point `activeTab` grants access to that one tab for that one interaction,
and `chrome.scripting.executeScript` injects the engine.

The two `host_permissions` entries are the FormPilot dashboard's own origin, not a browsing
permission. They exist so the extension can talk to its own backend and so the dashboard page
can hand over your profile. The `optional_host_permissions` are never requested by the shipped
code; they are declared so a future feature could ask, and asking would show the user a Chrome
prompt.

This was verified in a real browser rather than read off the file: `tests/e2e/specs/workflow.spec.ts`
asserts `manifest.permissions` is exactly `['storage', 'activeTab', 'scripting']` and that
`host_permissions` does not contain `docs.google.com`. A side effect showed up while testing —
`chrome.tabs.query` returns empty URLs for any origin outside `host_permissions`, which broke
the test harness. That inconvenience is the permission reduction working.

`externally_connectable` is restricted to the same two dashboard origins, so no other page can
open a message channel to the extension.

## What is stored, and where

All local, in `chrome.storage.local`. Keys from `extension/src/background/api.ts`:

| Key | Holds | Cleared by |
| --- | --- | --- |
| `userProfile` | The profile: name, email, phone, DOB, gender, address, education, experience, skills, projects, links, document *metadata* | Sign-out, Clear local data |
| `isProfileComplete` | A boolean | Sign-out, Clear local data |
| `isAuthenticated` | A boolean | Sign-out, Clear local data |
| `userUid` | Account id | Sign-out, Clear local data |
| `idToken` | Firebase ID token | Sign-out, Clear local data |
| `formpilot:settings` | Your switches and thresholds | Clear local data |
| `formpilot:corrections` | Cached corrections you made | Sign-out, Clear local data, Delete corrections |
| `formpilot:correctionsFetchedAt` | A cache timestamp | as above |

Nothing is written to `chrome.storage.sync`, so nothing is replicated across your Chrome
profiles by the browser.

**Document contents are not stored.** `ProfileDocument` in `shared/types/profile.ts` holds an
id, a kind, a display label, a MIME type, a size and a note — metadata only. The file itself
stays wherever you keep it, and a file input is filled by opening your own picker
(`extension/src/content/index.tsx`), never programmatically.

**Sign-out is a real deletion, not a flag flip.** `cacheAuth` with `isAuthenticated: false`
removes the token, the uid, the profile, the completeness flag and the corrections cache
(`extension/src/background/index.ts`).

## What leaves the device

Three requests, all to the FormPilot backend, all requiring a signed-in token. There are
exactly two `fetch` call sites in the extension, both in `extension/src/background/api.ts`.

### 1. `POST /api/ai/generate` — only when the AI path is used

Sent when a field cannot be resolved by the local rule engine *and* `allowAI` is on *and* you
are signed in. If any of those is false, no request is made: `buildSuggestionsForForm` in
`extension/src/background/pipeline.ts` guards on `aiRequests.length > 0 && settings.allowAI`.

The payload carries:

- **The minimised profile** (see below).
- **The fields that need help** — label, description, type, options, `maxLength`, section
  title, surrounding context, and the candidate concepts the rule engine produced. These are
  the *questions*, not your answers.
- **Form context** — the page title, the detected platform, **the page URL**, and the section
  titles.

**The page URL is sent, minimised to origin and path.** This was examined rather than accepted,
and the examination changed the code.

*What depends on it.* A generated answer has to know who is asking: "why do you want to join us?"
cannot be written without the company. The **hostname** supplies that, and the **path** is usually
the role (`/careers/senior-backend-engineer`), which is real grounding too. That is the whole of the
requirement. Removing the URL outright would leave the model writing about an unnamed employer, so
blanket removal was rejected.

*What the rest of it carries.* Everything after the path is where the applicant's own identifiers
live. A real careers URL looks like
`https://jobs.example.com/apply/senior-engineer?email=you@example.com&token=8f3ac1&utm_source=li`, or
carries `#candidateId=99201&step=3`. A prefilled email, a session token, an application id, ad-click
identifiers — none of which helps write a better answer, and all of which would land in the backend's
and the model provider's request logs. Data that leaves the device for no benefit is the clearest
case there is for removing it.

*What was changed.* `minimiseUrlForAI` in `shared/privacy/redact.ts` keeps origin and path and drops
the query, the fragment, and any credentials in the authority (`https://user:pass@host/`). A
non-`http(s)` URL — `file:`, `data:`, `chrome-extension:` — is dropped entirely, since it names the
user's own filesystem or the extension rather than a company. `tests/unit/url-minimisation.test.ts`
covers all of it, and `tests/e2e/specs/ai-routing.spec.ts` asserts it **on the wire** rather than at
the function: the E2E harness stamps every page with a `?fp=e2eN` nonce, so every page in that suite
has a query string that must be gone by the time the request arrives.

*What this does not fix, stated plainly.* The path is kept, and a path can itself carry an opaque
application id alongside the job title. Stripping path segments that "look like ids" would be
guesswork, and a wrong guess silently destroys the grounding the URL is sent for — so this reduces
exposure rather than eliminating it. The backend, and by extension the provider's logs, can still see
which company's form you were filling. `allowAI: false` remains the only control that sends nothing
at all, and with it off the local rule engine still resolves the large majority of fields — 89.2% on
the current benchmark corpus (`research/benchmark/results/latest.md`).

**Field values are never sent.** The request describes the form, not what is in it.

### 2. `POST /api/ai/corrections` — only with correction learning on

Sent when you edit a suggestion, and only if `allowCorrectionLearning` is on. `sendCorrection`
returns early with `skipped: 'Correction learning is turned off.'` otherwise. The payload is
the original question, the original answer, and your correction — which is your answer, so this
is the one path on which an answer leaves the device. It is opt-out, it is a single switch, and
`DELETE /api/ai/corrections` removes what was sent.

### 3. `GET /api/ai/corrections` — fetching your own corrections back

Read-only, carries no page data.

## Data minimisation on the AI path

**This was a finding, and it was fixed.** The AI request previously forwarded the stored
profile whole, and `frontend/src/app/api/ai/generate/route.ts` serialises what it receives
straight into the prompt with `JSON.stringify(profile, null, 2)`. So asking a model to draft
one paragraph sent the provider:

- phone number, date of birth, gender, full postal address
- every saved document's label and note
- every **alternate persona** the user keeps for other applications
- the account id and the local confidence thresholds

None of that is needed to write a paragraph. `shared/privacy/redact.ts` now removes what the
request demonstrably cannot use, keyed on the request mode:

| Removed | When | Why |
| --- | --- | --- |
| `documents` | always | File fields route to your own picker, never to a model. |
| `profiles`, `activeProfileId` | always | Alternate personas. Sending all of them to answer one question is the clearest over-share of the set. |
| `preferences` | always | Confidence thresholds and switches, not facts about you. |
| `userId` | always | An account identifier the model has no use for. |
| `address`, `socialLinks` | prose-only batches | A `generate` request writes prose from career history and cannot use them. |
| `basicProfile.phone`, `.dateOfBirth`, `.gender`, `.address` | prose-only batches | Same. |

When any field in the batch is an `assist` request the contact and address fields stay, because
`assist` adjudicates an uncertain *mapping* and answers with a stored value — it has to be able
to see the value it might return. An unrecognised mode is treated as value-returning, so a
future mode cannot silently lose fields it needs and answer wrongly.

### Proof, not assertion

Two layers of test, because a unit test of the redaction function would pass even if the extension
never called it.

**Unit** — `tests/unit/redact.test.ts`, 9 assertions: the always-removed keys are gone in every mode;
prose batches lose contact and identity fields; what a grounded answer is built from survives; an
`assist` batch keeps the values it may return; an unrecognised mode errs toward over-sending rather
than answering wrongly; the caller's profile is not mutated; and an alternate persona's email address
does not survive anywhere in the payload.

**End-to-end** — `tests/e2e/specs/ai-routing.spec.ts`, in Chromium against the real pipeline. The
stub endpoint records the keys of the profile object *as it arrives* and the specs assert on those.
On a prose-only batch from `basic-html.html` the endpoint receives exactly:

```
basicProfileKeys: ["email", "fullName"]
profileKeys:      ["basicProfile", "education", "experience", "languages", "projects", "skills"]
```

`phone`, `dateOfBirth`, `gender` and `basicProfile.address` are absent, as are `documents`,
`address`, `socialLinks`, `preferences`, `profiles`, `activeProfileId` and `userId`. The stub records
key *names*, never values, so the test fixture holds no copy of anything sensitive.

A further spec asserts that with `allowAI: false` the endpoint receives **no request at all** —
checked against the network, not against a flag.

**This is minimisation, not anonymisation.** What remains — your name, email, education and
employment history — is still personal data going to a third-party model provider. The complete
answer is the `allowAI` switch.

## What is logged

**Nothing.** `grep -rn "console\.(log|warn|error|info|debug)"` over `extension/src/` and
`shared/` returns no matches. Errors travel back to the UI as message payloads and are shown in
the panel; they are not written to a console where another extension or a screen recording
could pick them up.

The one deliberate exception is outside the extension: `tests/e2e/specs/performance.spec.ts`
prints its measurements, because the measurement is the deliverable there.

## Secrets

No API key is present in any client-side bundle. The Gemini and OpenAI keys are read
server-side only, in the Next.js API routes, from environment variables documented in
`.env.example`. The Firebase *client* config is public by design — it ships to the browser in
every Firebase web app, and access is controlled by the security rules in
`firebase/firestore.rules`, not by hiding the config. `.env.example` says so at the point where
those values are listed.

The end-to-end suite needs syntactically valid Firebase values to render the dashboard, and
they are throwaways defined in `playwright.config.ts` rather than a committed `.env.local`, so a
checkout carries no file that looks like real configuration.

## User controls

All in the options page (`extension/src/options/Options.tsx`), backed by handlers in
`extension/src/background/index.ts`:

| Control | Effect |
| --- | --- |
| **Export** | Downloads profile, corrections and settings as JSON. Your data, handed back. |
| **Clear local data** | Removes every key in `STORAGE_KEYS`. Nothing is left behind. |
| **Delete corrections** | Removes the local cache *and* issues `DELETE /api/ai/corrections`, so the server copy goes too. |
| **`allowAI`** | Off means no request to the model path is made at all. |
| **`allowCorrectionLearning`** | Off means your edits never leave the device. |
| **Confidence thresholds** | Raise them to see more fields held for review. |

## Remaining risks, stated plainly

1. **The page URL's origin and path go to the AI path.** Examined and minimised rather than removed;
   see the determination above. The query, fragment and any authority credentials are stripped. What
   remains — which company's form you were filling — is what grounding requires, and is mitigated only
   by `allowAI: false`.
   Sending a form's questions without saying which form they came from would produce worse
   answers, so this is a real trade-off rather than an oversight — but it is a trade-off the
   user cannot currently tune.
2. **The ID token is in `chrome.storage.local`.** Any code running in the extension's own
   context can read it. That is the standard place for it in an MV3 extension, and the storage
   area is not reachable from a web page, but it is not hardware-backed.
3. **Correction learning sends your answers.** It is opt-out and reversible, and it is the only
   path on which an answer leaves the device. Someone who wants nothing sent should turn it off
   rather than rely on being able to delete it later.
4. **Model provider retention is not FormPilot's to promise.** What Google or an
   OpenAI-compatible endpoint does with a prompt is governed by that provider's terms. This
   audit covers what is sent, not what happens next.
5. **The phrase lists that protect sensitive fields are not exhaustive.** 60 adversarial cases
   are covered (`tests/safety/evasion.test.ts`) and the structural backstop — never pre-accept a
   lone checkbox — does not depend on wording. But a label nobody has thought of can still be
   misclassified, which is why every suggestion is reviewable and nothing is submitted.
6. **No third-party review.** This audit was written by the same agent that wrote the code.
   That is a conflict of interest and should be read as one. The file references are there so
   someone else can check the claims.

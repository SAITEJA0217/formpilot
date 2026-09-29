<div align="center">

# FormPilot

**A platform-independent architecture for semantic web-form understanding and automated,
human-reviewed form assistance.**

Fill your profile once. FormPilot reads the form in front of you, works out what each field
means, proposes answers grounded in your profile, shows you where every answer came from — and
fills only what you approve.

</div>

---

## What FormPilot is

A Manifest V3 browser extension plus a Next.js dashboard. The extension detects the form on the
current page, normalizes it into one platform-independent schema, maps each field onto a canonical
profile concept, and presents the result for review. A language model is used only where
deterministic matching genuinely cannot decide — in the current benchmark, **89.2% of fields are
resolved with no model call at all**.

**The claim, in full, and it is the only one made here:** *FormPilot provides a platform-independent
architecture for semantic web-form understanding and automated, human-reviewed form assistance,
evaluated across the tested form environments.* The last clause is the load-bearing one — "the tested
form environments" are the ones listed in `research/compatibility-matrix.md`, not the web. This
README previously said "universal", which was not supported by anything measured here and has been
removed.

It is an assistant, not an agent. It never submits a form, never accepts an agreement, and never
fills a password, one-time code, payment detail or government identifier.

## Status at a glance

Read the status column literally. Nothing is marked implemented unless a test or a benchmark run
covers it.

| Capability | Status |
|---|---|
| Generic HTML form detection and autofill | **Implemented, verified** |
| ARIA-widget forms (no native inputs, contenteditable, custom listbox) | **Implemented, verified** |
| Google Forms, every question type | **Implemented, verified** — 36 integration tests plus 12 Chromium specs, against local reproductions |
| Open Shadow DOM, including nesting | **Implemented, verified** |
| Same-origin iframes | **Implemented, verified** with synthetic frames; the fixture page is manual only |
| Dynamic / conditional fields (MutationObserver) | **Implemented, verified** in Chromium |
| Multi-step forms with session continuity | **Implemented, verified** in Chromium — six steps, with identity, value, confidence, provenance and user edits each asserted |
| Deterministic semantic matching with provenance | **Implemented, verified** |
| Confidence bands and human review | **Implemented, verified** |
| Safety refusals (credentials, payment, identity, consent, signatures) | **Implemented, verified** — a 196-case corpus gates CI, and the benchmark fails the run on any violation |
| File fields via a native picker | **Implemented**, mechanism unit-tested; browser hand-off is manual only |
| Correction learning | **Implemented**, unit-tested |
| AI routing + long-form generation | **Implemented**; the routing decisions are measured, generated-answer quality is **not** |
| React (controlled and uncontrolled), Next.js App Router, Vue, Angular | **Implemented, verified** in Chromium against real framework builds |
| Custom widgets built from divs — select, checkbox, radio group | **Implemented, verified** in Chromium |
| Svelte, Solid, Ember, others | **Untested** — no fixture |
| Microsoft Forms, Typeform, Jotform, SurveyMonkey | **Experimental** — adapter, fixture, ground truth, unit, integration and Chromium tests each exist, but the live products are unreachable from this environment, so none has run against the real thing |
| Visual / screenshot fallback for unlabelled fields | **Not implemented** |
| Playwright end-to-end suite | **Implemented** — 83 specs in real Chromium with the built extension loaded |
| Live hosted platform evaluation | **Not done** — all five platforms denied at CONNECT; see [research/platform-evaluation.md](./research/platform-evaluation.md) |
| Human study | **Not done** — instruments in [research/human-study/](./research/human-study/), all marked NOT YET COLLECTED |

## Architecture

```
Any compatible website
        ↓
DOM analysis · accessibility analysis · heuristic fallback      (shadow roots, same-origin frames)
        ↓
Platform detection → Form adapter (Google Forms │ generic HTML)
        ↓
Unified Form Schema  ← the boundary: everything below is platform-blind
        ↓
Semantic field matcher   (multi-signal, explainable, no model)
        ↓
Profile knowledge base   (concept → value, option mapping, synonym groups)
        ↓
AI router                (deterministic │ assist │ generate │ manual │ blocked │ document)
        ↓
Confidence bands + per-signal provenance
        ↓
Human review panel       (only high confidence is pre-accepted)
        ↓
Safe interaction engine  (write, then read back and verify)
        ↓
Validation → you submit the form yourself
```

Three rules make the layering real, and they are worth stating because they are what the tests
depend on:

* `shared/` is pure — no DOM, no `chrome.*`, no network. The same code runs in the tab, the service
  worker, the API route and the benchmark.
* `extension/src/core/` is DOM-only — no `chrome.*`. That is why the entire engine runs under jsdom
  and every test exercises production code rather than a double.
* Platform knowledge exists only in adapters. The generic engine does not know any platform exists.

Full detail: [research/architecture.md](./research/architecture.md). The matching method:
[research/methodology.md](./research/methodology.md).

## Repository layout

```
extension/            MV3 extension (Vite + crxjs + React 19)
  src/core/             universal form engine — DOM only, chrome-free
    dom/                deep query, text, accessible name, label extraction
    detect/             field detection, classification, grouping, sections, steps
    normalize/          DOM → UnifiedForm
    platform/           platform detection
    adapters/           generic HTML + Google Forms
    interaction/         safe fill, read-back verification
    observe/            debounced, region-localized MutationObserver
    session/            multi-step session state
  src/content/          injected entry + shadow-DOM review panel
  src/background/       service worker: profile, token, API access
  src/popup/            the only place FormPilot is invoked from
  src/options/          settings and privacy controls
frontend/             Next.js dashboard + API
  src/lib/ai/            provider abstraction (Gemini, OpenAI-compatible)
  src/lib/api/           CORS, auth, rate limiting
  src/app/api/ai/        generate (v1 + v2 shapes), corrections, parse-resume
  public/test-forms/     the 10-page test corpus
  src/app/test-forms/    corpus index + React test pages
shared/               pure logic shared by all three
  types/                 unified form schema, suggestions, profile
  ontology/              canonical concept table
  matching/              normalize, similarity, matcher, resolve, router, pipeline
  validation/            value coercion and validation
  safety/                the single "never autofill" policy
tests/                343 tests — unit (pure + jsdom) and integration
research/             architecture, methodology, metrics, dataset, limitations, benchmark
docs/                 migration plan and the v1 project documentation
```

## Installation

```bash
git clone <repo> && cd formpilot
npm install                      # root: test runner + benchmark
npm --prefix extension install
npm --prefix frontend install
```

### Run the dashboard

```bash
cp frontend/.env.example frontend/.env.local   # then fill it in
npm --prefix frontend run dev                  # http://localhost:3000
```

### Build and load the extension

```bash
cp extension/.env.example extension/.env       # optional; defaults to localhost:3000
npm --prefix extension run build
```

Then in Chrome: `chrome://extensions` → Developer mode → **Load unpacked** → `extension/dist`.

The build runs twice on purpose. The first pass produces the MV3 bundle; the second emits the
engine as a single IIFE at the fixed path `dist/injected/universal.js`, because
`chrome.scripting.executeScript` needs a path known at compile time and crxjs content-hashes its
own output.

## Usage

1. Sign in on the dashboard and fill in your profile (or upload a resume to extract it).
2. Open any web form and click the FormPilot icon. This is what grants access to the page — the
   extension has no standing permission for any site.
3. Press **Scan this page**. The popup reports fields detected, ready, needing review, and protected.
4. Press **Review & Fill**. The panel opens in the page with one card per field: the suggested
   value, its confidence, the profile path it came from, and a **Why?** view showing the individual
   matching signals.
5. Accept, edit or reject each suggestion. High-confidence ones arrive pre-accepted; nothing else
   does.
6. Press **Fill**. Each write is read back and verified; anything that failed is reported.
7. **You** submit the form.

Editing a suggestion records a correction, so the same question is answered your way next time.

## Profile management

The profile covers personal details, address, education (multiple entries), experience, skills,
projects, certifications, languages, links and document metadata. Optional v2 additions include
named profile overlays (`Internship Profile`, `Academic Profile`) stored as sparse overrides rather
than duplicated copies of your data.

A v1 profile is a valid v2 profile: every addition is optional, so stored documents load unchanged.

## AI architecture

The router decides, per field, what a field costs:

| Route | When | Model call |
|---|---|---|
| deterministic | clear label, stored value | no |
| manual | nothing recognised, or no stored value | no |
| blocked | credential, payment, identity, consent | no |
| document | a file input | no |
| ai_assist | two concepts matched within 0.08, or a low-confidence mapping | yes, batched |
| ai_generate | an open question in a long-form control | yes, batched |

A twenty-field form with two open questions costs at most two model calls, not twenty. The
provider is chosen by `AI_PROVIDER`: `gemini` (default, the v1 model and behaviour) or
`openai-compatible` (implemented, **not verified against a live endpoint**). No provider key ever
reaches the extension; only the server holds one.

Generated answers are capped below the high-confidence band, so a model's self-reported confidence
can never pre-accept its own answer. Prompts forbid inventing employers, titles, dates, degrees,
grades or achievements — and the review panel, not the prompt, is the actual safeguard.

## Privacy

* **No standing site access.** Permissions are `storage`, `activeTab` and `scripting`. Host
  permissions cover only the dashboard origin. Access to a page is granted when you open the popup
  on it, and broad access is an *optional* permission you can grant and revoke in settings.
* **The profile stays local** in `chrome.storage.local`, synced from the dashboard you signed into.
* **Only the fields that need it** are sent to the API — never the page, never its contents, never a
  screenshot. Deterministic fields never leave the device.
* **No telemetry.** There is no analytics in the extension.
* **Your data, your call**, from the options page: export everything, delete learned corrections
  (locally and in your account), clear all local data. Signing out wipes the cached profile, token
  and corrections.
* **Nothing is logged.** The engine and the shared layer contain no `console` calls; the API logs
  error messages only, never field labels or values.

## Security

* No auto-submit, ever. The interaction engine refuses to click anything that submits, pays,
  navigates or agrees, and the panel has no submit button.
* Passwords, one-time codes, CVV/card/IBAN, SSN/Aadhaar/PAN/passport numbers, CAPTCHAs and
  consent checkboxes are refused at three independent points: during detection, during routing, and
  again inside the interaction engine at write time — so a tampered or stale suggestion cannot slip
  one through. A test asserts exactly that.
* Cross-origin iframes and closed shadow roots are reported as unreachable, never worked around.
* CORS allows browser extensions, explicitly listed origins, and localhost outside production.
  An unrecognised origin receives no CORS headers (v1 fell back to `*`).
* Firestore denies by default; every allowance is explicit and owner-scoped. Rate-limit documents
  are Admin-SDK-only.
* Secrets are server-side only. `frontend/.env.example` documents which variables must never carry
  a `NEXT_PUBLIC_` prefix.

## Testing

```bash
npm test                 # 343 tests, 22 files
npm run typecheck:all    # root (shared + tests + research), extension, frontend
npm run lint             # frontend eslint
npm run build:extension
```

| Layer | Coverage |
|---|---|
| Pure unit | normalization, similarity, ontology integrity, matcher scoring, confidence, value validation, option mapping, routing, safety policy, pipeline, session |
| jsdom unit | label extraction per strategy, accessible-name computation, field classification per input type, grouping, selector synthesis, deep query across shadow roots and frames |
| Integration | detection + matching + fill + read-back over the real fixture corpus, the Google Forms regression suite, dynamic re-scan, multi-step sessions, shadow/iframe traversal, and the safety suite |

Local test pages live at `/test-forms` on the dashboard and double as the benchmark corpus.

## Research evaluation

```bash
npm run bench            # → research/benchmark/results/{latest.json,latest.md}
```

Latest run: 17 page states, 120 labelled fields, no model called.

| Metric | Value |
|---|---|
| Field detection P / R / F1 | 100% / 100% / 100% |
| Concept mapping P / R / F1 | 100% / 100% / 100% |
| Routing decision accuracy | 100% |
| Autofill success rate | 100% (84/84) |
| Safety violations | 0 |
| Fields resolved without a model | 89.2% |
| Automation rate / review burden | 51.7% / 40.0% |

**These are regression numbers, not a generality claim.** The corpus is synthetic, small, and
written by the same author as the engine, so every 100% above means "nothing broke", not "works in
general". Six of those metrics were *not* perfect on the first run; each gap was a real defect, and
all nine are listed with root causes in
[research/experiment-design.md](./research/experiment-design.md).

**The numbers to cite instead** are the held-out ones, measured on third-party form markup with ground
truth from the HTML spec rather than from this project: **93.6% accuracy [87.3%, 96.9%], 0.9%
incorrect-fill rate, 45 of 45 credential and payment controls refused**
([research/held-out-evaluation-v2.md](./research/held-out-evaluation-v2.md)). They are lower than the
table above, and they are the real ones. Read
[research/limitations.md](./research/limitations.md) before citing any of this.

## Known limitations

The short version; the full list is in [research/limitations.md](./research/limitations.md).

* No live hosted platform was reachable from the build environment, so no adapter for Google Forms,
  Microsoft Forms, Typeform, Jotform or SurveyMonkey has ever run against the real product. All four
  of the latter stay **Experimental**.
* No human study. Acceptance, correction and override rates are not reported because they need
  participants; `research/human-study/` holds the instruments, all marked NOT YET COLLECTED.
* Generated-answer quality is unmeasured — no model provider is reachable here, so model calls are
  counted, never executed.
* React, Next.js, Vue and Angular are tested in real Chromium. Svelte, Solid and Ember are not.
* The review panel is a fixed 400px column and can sit on top of a centred form's own buttons in a
  narrow window (`research/limitations.md` §5b).
* Cross-origin iframes, closed shadow roots and CAPTCHAs are out of reach by browser design.
* Step and section detection are heuristics — there is no standard markup for either.
* Tests run under jsdom: no layout, no real event ordering. The extension has not been driven in a
  real Chrome profile as part of this work.
* `openai-compatible` has never been run against a live endpoint; `/api/ai/parse-resume` is still
  Gemini-specific because it is a multimodal call.
* English-only labels and abbreviations.

## Documentation

| Document | Contents |
|---|---|
| [docs/MIGRATION_PLAN.md](./docs/MIGRATION_PLAN.md) | the v1 → v2 refactor: audit, target architecture, every file added/changed/removed |
| [research/](./research/) | architecture, methodology, metrics, dataset, compatibility matrix, limitations, reproducibility |
| [docs/PRD.md](./docs/PRD.md), [docs/FormPilot_Technical_Project_Documentation.md](./docs/FormPilot_Technical_Project_Documentation.md) | the v1 documents, kept as a historical record |

## License

Not yet specified.

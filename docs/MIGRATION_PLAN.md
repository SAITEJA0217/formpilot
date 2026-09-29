# FormPilot Migration Plan — Google Forms Autofill → Universal Semantic Form Engine

Status: **authoritative plan for the v2 refactor**. Written after a full audit of the
repository at commit `a799f7c`. Every claim below about the *current* system was
verified by reading the code, not inferred.

---

## 1. Current architecture (as audited)

```
formpilot/
├── package.json                 root: only { firebase } — no scripts, no test runner
├── extension/                   MV3 extension, Vite + @crxjs/vite-plugin, React 19
│   ├── manifest.json            host_permissions: docs.google.com/forms + localhost:3000
│   ├── src/background/index.ts  message router, token refresh, API calls (202 LOC)
│   ├── src/content/index.tsx     Google-Forms DOM parser + autofill (328 LOC)
│   ├── src/content/ReviewPanel.tsx  human review UI (158 LOC)
│   ├── src/content/dashboardSync.ts auth/profile postMessage bridge (32 LOC)
│   ├── src/popup/Popup.tsx      gate + "Analyze Current Form" (148 LOC)
│   ├── src/main.ts, src/counter.ts  ← dead Vite scaffolding, not referenced anywhere
│   └── tsconfig.json            no `strict`
├── frontend/                    Next.js 16 dashboard + API
│   ├── src/app/api/ai/generate/route.ts     Gemini 2.5 Flash, one call per form
│   ├── src/app/api/ai/corrections/route.ts  correction classifier + Firestore write
│   ├── src/app/api/ai/parse-resume/route.ts resume → profile JSON
│   ├── src/hooks/useProfile.ts  Firestore + localStorage profile, postMessage sync
│   └── src/lib/auth-context.tsx Firebase auth, token bridge to extension
├── shared/types/index.ts        UserProfile, FormQuestion, AIAnswer (90 LOC)
├── shared/prompts/index.ts      single system prompt (34 LOC)
├── shared/utils/firebase.ts     client Firebase init
├── firebase/firestore.rules
└── docs/                        PRD + technical documentation (Google-Forms scoped)
```

### Current data flow

```
Popup click
  → tabs.sendMessage EXTRACT_QUESTIONS
  → content: querySelectorAll('div[role="listitem"]') → FormQuestion[]
  → background ANALYZE_FORM → POST /api/ai/generate (whole form, one LLM call)
  → Gemini returns { answers: [{question, answer, confidence, sourceDetail, isGenerated}] }
  → background tabs.sendMessage SHOW_REVIEW_PANEL
  → content renders ReviewPanel (React, light DOM, Tailwind from crxjs CSS)
  → user edits → SEND_CORRECTION → /api/ai/corrections → Firestore
  → user clicks Autofill → content re-walks listitems, fuzzy-matches question text, fills
```

### What genuinely works today (must not regress)

| Capability | Where |
|---|---|
| Google Forms short answer / paragraph / radio / checkbox / dropdown / date / time / linear scale / grid | `content/index.tsx` |
| React-safe value setting via prototype `value` setter + input/change/blur events | `content/index.tsx:130-146` |
| Human-in-the-loop review with confidence, provenance ("Why?"), edit, skip | `ReviewPanel.tsx` |
| Correction capture + fact/phrasing classification + few-shot reuse | `corrections/route.ts`, `generate/route.ts:96-114` |
| Firebase ID token bridge with 401 → refresh → retry | `background/index.ts:22-51,116-134` |
| Per-user daily rate limit in a Firestore transaction | `generate/route.ts:71-94` |
| Resume PDF → profile extraction | `parse-resume/route.ts` |
| Profile editor with autosave + completion scoring | `ProfileForm.tsx`, `useProfile.ts` |

---

## 2. Problems with the current architecture

1. **Platform lock-in by construction.** Question discovery *is* `div[role="listitem"]`.
   There is no abstraction between "the DOM" and "a question", so no other site can work.
2. **No normalized schema.** `FormQuestion` carries only `{id, question, type, required, options?}`.
   It has no selector, so autofill cannot address the element it extracted from — it
   re-walks the DOM and re-matches on *question text* with `includes()` in both directions
   (`content/index.tsx:201-204`), which mis-binds on forms with overlapping labels
   (e.g. "Email" vs "Company Email").
3. **Every field goes to the LLM.** One Gemini call carries the entire form, including
   trivially deterministic fields (`Full Name`, `Email`). Cost and latency scale with form
   size; confidence is whatever the model asserts.
4. **Confidence is not calibrated or thresholded.** `confidence` is an LLM self-report on
   0–100; the only post-processing is `min(confidence, 70)` when generated. Nothing
   prevents a low-confidence value from being filled.
5. **No dynamic-form handling.** No `MutationObserver` anywhere in the repo. Conditional
   questions, lazily rendered steps, and SPA route changes are invisible.
6. **No multi-step session.** State lives in a React `useState` inside the panel; navigating
   to step 2 loses everything.
7. **No Shadow DOM or iframe traversal.** `document.querySelectorAll` only.
8. **No file-upload support.** `input[type=file]` is explicitly excluded from detection.
9. **No tests of any kind.** No runner, no fixtures, no CI. Zero regression safety.
10. **UI fragility on third-party sites.** The panel renders into the light DOM and relies on
    a Tailwind stylesheet injected by crxjs; host CSS can break it and vice-versa.
11. **Dead code** (`main.ts`, `counter.ts`) and Google-Forms-only copy across popup,
    manifest description, landing page, and docs.
12. **Single hard-wired AI provider.** `new GoogleGenerativeAI(...)` is constructed at module
    scope in two routes; no abstraction, no fallback.
13. **Permission shape.** Permanent `host_permissions` on `docs.google.com/forms/*` is granted
    at install even when the user never opens a form.

---

## 3. Target architecture

```
                              FormPilot v2
                                   │
                        ┌──────────┴──────────┐
                        │  Universal Form     │
                        │  Engine (content)   │
                        └──────────┬──────────┘
        ┌──────────────────────────┼──────────────────────────┐
        ↓                          ↓                          ↓
  DOM Analyzer            Accessibility Analyzer      Heuristic Fallback
  (deep query:            (accessible name/role/       (proximity + layout
   shadow DOM,             description, ARIA            text when no label
   same-origin iframes)    widget semantics)            exists)
        └──────────────────────────┼──────────────────────────┘
                                   ↓
                         Platform Detection
                                   ↓
                     Form Adapter Layer (registry)
            GoogleFormsAdapter │ GenericHTMLAdapter (fallback)
                                   ↓
                        Unified Form Schema
                  (UnifiedForm / UnifiedField / FormSection)
                                   ↓
        ═══════════ serialized message boundary ═══════════
                                   ↓
                   Semantic Field Mapper (shared/)
        normalize → ontology candidates → rule signals →
        similarity → context → confidence + per-signal provenance
                                   ↓
                    Profile Knowledge Base (shared/)
                  resolve concept → value (+ option mapping)
                                   ↓
                         AI Router (shared/)
          deterministic │ ambiguous → assist │ long-form → generate
                                   ↓
                     AI Reasoner (frontend API)
                 provider abstraction: Gemini | OpenAI-compatible
                                   ↓
                     Confidence bands + Provenance
                                   ↓
                   Human Review Panel (shadow DOM UI)
                                   ↓
                      Safe Interaction Engine
                                   ↓
                        Validation Layer
                                   ↓
                      User-controlled submission
```

Responsibility split, deliberately:

* `shared/` — **pure, environment-agnostic logic.** No DOM, no `chrome.*`, no network.
  Ontology, normalization, similarity, matcher, resolver, router, confidence, value
  validation, schema types. Runs identically in the content script, the service worker,
  the Next.js API, and the test runner. This is what the research harness measures.
* `extension/src/core/` — **DOM layer.** Analyzers, detector, selector synthesis, adapters,
  interaction engine, observer, session. Pure DOM only (no `chrome.*`), so it is testable
  under jsdom.
* `extension/src/{content,background,popup,options}` — **integration layer.** `chrome.*`
  APIs, messaging, UI.
* `frontend/` — dashboard, profile/knowledge-base editing, AI API with provider abstraction.

---

## 4. Files to create

**Shared (pure logic)**
| File | Purpose |
|---|---|
| `shared/types/form.ts` | `UnifiedForm`, `UnifiedField`, `FormSection`, `FieldType`, `FormPlatform`, `FieldOption`, metadata |
| `shared/types/suggestion.ts` | `FieldSuggestion`, `Provenance`, `SignalContribution`, `ConfidenceBand`, `FillOutcome` |
| `shared/types/profile.ts` | `KnowledgeBase`, `ProfileDocument`, `NamedProfile`, correction records |
| `shared/ontology/concepts.ts` | canonical concept table (id, aliases, patterns, profile path, value type, policy) |
| `shared/ontology/index.ts` | lookup/index helpers |
| `shared/matching/normalize.ts` | text normalization + abbreviation expansion + tokenization |
| `shared/matching/similarity.ts` | dice bigram, token-set F1, containment |
| `shared/matching/matcher.ts` | multi-signal field → concept matcher with provenance |
| `shared/matching/resolve.ts` | concept → profile value, incl. option mapping |
| `shared/matching/confidence.ts` | bands + configurable thresholds |
| `shared/matching/router.ts` | deterministic / assist / generate / manual routing |
| `shared/matching/pipeline.ts` | end-to-end `UnifiedForm` + `KnowledgeBase` → `FieldSuggestion[]` |
| `shared/validation/value.ts` | date/time/email/phone/url/number coercion + validation |
| `shared/safety/policy.ts` | never-autofill policy (passwords, OTP, payment, consent) |

**Extension core (DOM)**
| File | Purpose |
|---|---|
| `core/dom/deepQuery.ts` | traversal across open shadow roots and same-origin iframes |
| `core/dom/text.ts` | visible-text extraction, nearby-text harvesting |
| `core/dom/labels.ts` | ordered label strategies with recorded `labelSource` |
| `core/dom/accessibility.ts` | accessible name / role / description subset of ARIA |
| `core/detect/selector.ts` | stable unique selector synthesis + re-resolution |
| `core/detect/fieldDetector.ts` | control discovery + `FieldType` classification |
| `core/detect/formDetector.ts` | grouping into forms + sections + step inference |
| `core/normalize/formNormalizer.ts` | assemble `UnifiedForm` |
| `core/platform/detect.ts` | platform detection from URL + DOM markers |
| `core/adapters/{types,registry,genericHtml,googleForms}.ts` | adapter layer |
| `core/interaction/{setters,engine,validate}.ts` | safe fill + post-fill verification |
| `core/observe/observer.ts` | debounced incremental `MutationObserver` |
| `core/session/formSession.ts` | multi-step session state |

**Extension integration**
`content/index.tsx` (rewritten entry), `content/ui/ReviewPanel.tsx`,
`content/ui/panelStyles.ts`, `content/ui/icons.tsx`, `shared/messaging/messages.ts`,
`background/pipeline.ts`, `popup/Popup.tsx` (rewritten), `options/*` (privacy controls),
`vite.inject.config.ts` (deterministic injectable bundle).

**Frontend**
`src/lib/ai/{types,gemini,openaiCompatible,index}.ts`, `src/app/test-forms/**`,
`public/test-forms/*.html`.

**Tests / research**
`vitest.config.ts`, `tests/unit/*.test.ts`, `tests/integration/*.test.ts`,
`tests/fixtures/*.html`, `research/*.md`, `research/benchmark/**`.

## 5. Files to modify

`extension/manifest.json`, `extension/package.json`, `extension/tsconfig.json` (add `strict`),
`extension/src/background/index.ts`, `extension/src/content/dashboardSync.ts`,
`shared/types/index.ts` (keep legacy exports, re-export new), `shared/prompts/index.ts`,
`frontend/src/app/api/ai/generate/route.ts` (dual request shape + provider abstraction),
`frontend/src/app/api/ai/corrections/route.ts` (add `GET`/`DELETE` for privacy),
`frontend/src/app/layout.tsx` + `page.tsx` (copy), root `package.json` (scripts + dev deps),
`README.md`, `docs/*`.

## 6. Files to remove

`extension/src/main.ts`, `extension/src/counter.ts` — dead Vite scaffolding, referenced by
nothing (`index.html` loads `src/popup/index.tsx`; the manifest loads the background and
content scripts). `extension/src/content/ReviewPanel.tsx` moves to `content/ui/ReviewPanel.tsx`.
`frontend/public/test-form.html` is superseded by `public/test-forms/` (kept as a redirect-free
legacy fixture copy under `tests/fixtures/google-forms-mock.html` so the Google Forms
regression test keeps its original input).

## 7. Files to preserve unchanged

`frontend/src/lib/{auth-context,firebase-admin,browser-detection,utils}.ts(x)`,
`frontend/src/hooks/useProfile.ts` (extended, not replaced),
`frontend/src/components/**` (design system reused as-is),
`frontend/src/app/api/ai/parse-resume/route.ts`, `shared/utils/firebase.ts`,
`firebase/firestore.rules` (extended with new subcollections, existing rules kept).

## 8. Storage / data migration

Nothing is destructively migrated. The v1 profile shape is the v2 shape plus optional fields:

* `UserProfile` gains **optional** `documents?`, `profiles?`, `preferences?`, `address?`.
  Absent fields behave exactly as today, so existing Firestore documents load unchanged.
* `KnowledgeBase` is a *view* computed from `UserProfile` at match time
  (`shared/matching/resolve.ts`), not a second copy of the data — no duplication of PII.
* New Firestore subcollections (rules added, nothing rewritten):
  `users/{uid}/corrections` (already in use), `users/{uid}/documents` (metadata only).
* `chrome.storage.local` keys keep their v1 names (`userProfile`, `idToken`,
  `isAuthenticated`, `userUid`, `isProfileComplete`) so an updated extension keeps working
  against a cached v1 profile. New keys are additive: `formpilot:settings`,
  `formpilot:session:<tabId>`.

## 9. API changes

| Endpoint | Change | Compatibility |
|---|---|---|
| `POST /api/ai/generate` | accepts **either** legacy `{profile, questions}` **or** v2 `{profile, fields, formContext, mode}` | legacy shape still returns `{answers:[...]}` byte-compatible with v1 |
| `POST /api/ai/corrections` | unchanged contract | — |
| `GET /api/ai/corrections` | **new** — list own corrections (privacy: transparency) | additive |
| `DELETE /api/ai/corrections` | **new** — delete one or all corrections | additive |

Provider selection moves behind `shared`-independent `frontend/src/lib/ai`. `AI_PROVIDER`
env var selects `gemini` (default, unchanged behaviour) or `openai-compatible`.

## 10. Security implications

* **Permissions shrink.** `host_permissions` for `docs.google.com/forms/*` is *removed*.
  The engine is injected with `chrome.scripting.executeScript` under `activeTab`, i.e. only
  after an explicit user click, on the tab the user is looking at. Broad access is offered
  as `optional_host_permissions` and requested per-origin, never at install.
* `web_accessible_resources` is dropped entirely (panel uses inline SVG, no fetched assets).
* **Never-autofill policy** enforced in `shared/safety/policy.ts`: password, OTP/2FA,
  CVV/card/IBAN, SSN/national-id, and consent/agreement controls are detected and refused
  with a reason, in the engine *and* re-checked in the interaction layer.
* **No auto-submit.** The interaction engine refuses to click submit-like elements; the
  review panel has no submit affordance. Final submission is the user's click on the page.
* Secrets stay server-side: `GEMINI_API_KEY` is only read in the Next.js route. The
  extension never holds a provider key.
* Logging is scrubbed: field labels/values are not written to `console` in production
  paths; counts and concept ids only.
* Privacy controls: export profile, clear local cache, clear session, list/delete
  corrections.

## 11. Testing strategy

* **Runner:** Vitest at the repo root, `environment: jsdom`, covering both `shared/` and
  `extension/src/core/`. Chosen over Jest because the codebase is ESM/TS-native and Vite is
  already the extension bundler.
* **Unit (pure):** normalization, abbreviation expansion, similarity metrics, ontology
  integrity, matcher signal scoring, confidence banding, value validation/coercion,
  option mapping, AI routing decisions, safety policy.
* **Unit (jsdom):** label extraction per strategy, accessible-name computation, field
  classification per input type, selector synthesis + re-resolution, deep query across
  shadow roots.
* **Integration (jsdom):** full `detect → normalize → match → fill → validate` over each
  fixture page, including the Google Forms mock (regression), a dynamic form, a multi-step
  form, an ARIA-heavy form, a Shadow DOM form, and an ambiguous-label form.
* **Manual/E2E:** `/test-forms` pages served by the dashboard for real-browser checks.
  A Playwright suite is *not* added in this pass and is recorded as future work rather
  than claimed.
* **Research harness:** `research/benchmark` computes detection precision/recall/F1 and
  mapping accuracy against hand-labelled ground truth in
  `research/benchmark/dataset/*.json`. It prints and writes a report; the compatibility
  matrix is populated **only** from harness output and real manual runs.

## 12. Order of work

Phases 1–15 from the brief, executed as: audit → schema → DOM engine → adapters →
matcher → knowledge base → review/confidence → dynamic/multi-step → AI routing →
security → tests → fixtures → research tooling → docs → verification.

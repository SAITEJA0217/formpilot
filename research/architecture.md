# Architecture

## Layers

```
                              FormPilot v2
                                   │
                        ┌──────────┴──────────┐
                        │  Universal Form     │   extension/src/core  (DOM, no chrome.*)
                        │  Engine             │
                        └──────────┬──────────┘
        ┌──────────────────────────┼──────────────────────────┐
        ↓                          ↓                          ↓
  DOM Analyzer            Accessibility Analyzer      Heuristic fallback
  deepQuery.ts            accessibility.ts            labels.ts / text.ts
  shadow roots +          accessible name/role/        fieldset legend, table
  same-origin frames      description (ARIA subset)    header, preceding text
        └──────────────────────────┼──────────────────────────┘
                                   ↓
                         Platform Detection          platform/detect.ts
                                   ↓
                     Form Adapter Layer              adapters/registry.ts
            GoogleFormsAdapter │ GenericHTMLAdapter (fallback)
                                   ↓
                        Unified Form Schema          shared/types/form.ts
                                   ↓
        ═══════════ serializable message boundary ═══════════
                                   ↓
                   Semantic Field Mapper             shared/matching/matcher.ts
                                   ↓
                    Knowledge Base resolver          shared/matching/resolve.ts
                                   ↓
                         AI Router                   shared/matching/router.ts
                                   ↓
                     AI Reasoner (server)            frontend/src/lib/ai/*
                                   ↓
                  Confidence bands + provenance      shared/matching/confidence.ts
                                   ↓
                   Human Review Panel                extension/src/content/ui
                                   ↓
                     Safe Interaction Engine         core/interaction/engine.ts
                                   ↓
                        Validation Layer             shared/validation/value.ts
                                   ↓
                   User-controlled submission
```

## Why the boundaries are where they are

**`shared/` is pure.** No DOM, no `chrome.*`, no network. The ontology, normalization,
similarity metrics, matcher, resolver, router, confidence banding and value validation all
live there. The consequence that matters for research: *the same code* runs in the browser
tab, in the service worker, in the Next.js API route and in the benchmark runner, so a
measured result and a shipped behaviour cannot diverge.

**`extension/src/core/` is DOM-only.** Analyzers, detector, selector synthesis, adapters,
interaction engine, mutation observer, session. It never touches `chrome.*`, which is why the
whole engine runs unmodified under jsdom — every integration test and every benchmark number
comes from the production code path, not a test double.

**Platform knowledge lives only in adapters.** The generic detector accepts `DetectionHooks`
(question containers, authoritative labels, option overrides, field refinement). The Google
Forms adapter supplies those hooks; the generic adapter supplies none. Nothing in the generic
path knows a platform exists. A platform that is *recognised* but has no adapter falls through
to the generic one and is reported as `generic-fallback`, never as support.

**The message boundary is a schema boundary.** A `UnifiedForm` crosses from the content
script to the service worker as JSON. Live element handles stay in the tab, addressed by
re-resolvable selectors plus a shadow path and a frame path. That is what allows detection and
filling to be separated by a network round trip and a page re-render.

## Data flow for one form

```
user opens the popup on a tab
  → activeTab granted → engine injected with chrome.scripting.executeScript
  → normalizeForm(): detect → classify → group → label → sections → steps → UnifiedForm
  → service worker: buildSuggestions(form, profile) — deterministic, offline, free
  → only ambiguous/long-form fields → POST /api/ai/generate → mergeAIAnswers()
  → content script: review panel (shadow DOM), high-confidence pre-accepted
  → user accepts / edits / rejects
  → interaction engine writes accepted values, verifies each by read-back
  → MutationObserver re-scans changed regions; session restores the user's decisions
  → the user submits the page themselves
```

## Component responsibilities

| Component | File | Responsibility |
|---|---|---|
| Deep query | `core/dom/deepQuery.ts` | traverse document, open shadow roots, same-origin frames; count what is unreachable |
| Text utilities | `core/dom/text.ts` | visible text, nearby text, preceding text, visibility without layout APIs |
| Accessibility analyzer | `core/dom/accessibility.ts` | accessible name/description, role resolution, required state |
| Label extractor | `core/dom/labels.ts` | 10 ordered strategies, each recorded as a `LabelSource` |
| Selector synthesis | `core/detect/selector.ts` | stable re-resolvable selector per control |
| Field detector | `core/detect/fieldDetector.ts` | discovery, classification, grouping, metadata, sensitivity |
| Form detector | `core/detect/formDetector.ts` | sections, step inference, form title |
| Normalizer | `core/normalize/formNormalizer.ts` | assemble `UnifiedForm` + metadata + warnings |
| Platform detection | `core/platform/detect.ts` | URL and DOM fingerprints |
| Adapters | `core/adapters/*` | platform hooks; registry selects exactly one |
| Interaction engine | `core/interaction/engine.ts` | safe writes, read-back verification, refusals |
| Observer | `core/observe/observer.ts` | filtered, debounced, region-localized mutation reports |
| Session | `core/session/formSession.ts` | decisions keyed by field identity, across steps and re-renders |
| Ontology | `shared/ontology/*` | canonical concepts, aliases, patterns, policies |
| Matcher | `shared/matching/matcher.ts` | multi-signal scoring with per-signal provenance |
| Resolver | `shared/matching/resolve.ts` | concept → value, option mapping, synonym groups |
| Router | `shared/matching/router.ts` | deterministic / assist / generate / manual / blocked / document |
| Pipeline | `shared/matching/pipeline.ts` | form + profile → suggestions + minimal AI request set |
| Safety policy | `shared/safety/policy.ts` | the single definition of "never autofill" |
| AI providers | `frontend/src/lib/ai/*` | provider-agnostic interface; Gemini, OpenAI-compatible |

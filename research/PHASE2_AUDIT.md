# Phase 2 audit — what was real, what was claimed, and what changed

An audit of FormPilot's state at the point it had a universal architecture and a synthetic test
suite, but had never been executed in a browser. Its purpose was to separate *implemented* from
*validated*, because those had been reported together.

**How to read this.** The `At audit` column is the honest state when the audit was taken. The
`Now` column records what the work that followed actually established, with the evidence. A row
whose `Now` is unchanged is a row where nothing was proven — those are the useful ones.

Status vocabulary, used consistently across `research/`:

| Status | Means |
| --- | --- |
| **Verified** | Executed and asserted in an automated test, against the real thing. |
| **Partial** | Some paths executed and asserted; named gaps remain. |
| **Experimental** | Implemented and tested against a local reproduction, never against the real target. |
| **Untested** | Code exists; nothing has measured whether it works. |
| **Unsupported** | No code path, or a platform constraint makes it impossible. |

## The finding that motivated everything else

**The extension had never been run.** Every claim rested on 343 jsdom tests and a synthetic
benchmark. jsdom is a faithful DOM, but it is not a browser: it has no MV3 service worker, no
extension message ports, no `chrome.scripting`, no real shadow-DOM rendering and no real
same-origin policy. So the entire class of defect that lives in those seams was untested by
construction.

That turned out to matter. Running it for the first time surfaced a **30-second stall on first
use** — `dashboardSync` returned `true` from its `onMessage` listener for every message, so
Chrome held the sender's port open to its own timeout instead of reporting "no receiver". The
popup awaited that ping before injecting the engine. Measured at 30,068 ms; 4 ms after the fix.
No amount of jsdom testing could have found it, because jsdom has no port semantics to get
wrong.

## Core engine

| Area | At audit | Now | Evidence |
| --- | --- | --- | --- |
| Unified form schema | Verified (jsdom) | **Verified** in Chromium | `tests/e2e/specs/workflow.spec.ts` |
| Generic HTML detection | Verified (jsdom) | **Verified** in Chromium | 9/9 fields on `basic-html.html` |
| Label resolution (`for`, wrapping, ARIA, table, proximity) | Verified | **Verified** | `tests/unit/labels.test.ts` (25) |
| Multi-signal matching | Verified | **Verified**, and 3 defects fixed | `research/matching/`, `tests/unit/context-dependent-aliases.test.ts` |
| Confidence bands and provenance | Verified | **Verified** in the rendered UI | workflow spec reads the shadow DOM |
| Safe interaction engine | Verified | **Verified**, plus hostile-caller tests | `tests/safety/invariants.test.ts` |
| Native-setter write path | Untested in a real framework | **Verified** against React 19, Vue 3, Angular 18, Next.js 16 | `tests/e2e/specs/frameworks.spec.ts` |
| MutationObserver | Untested for termination | **Verified** it settles | `dynamic.spec.ts` counts zero mutations over 1.5 s after settling |
| Multi-step sessions | Verified (jsdom) | **Verified** in Chromium | `dynamic.spec.ts` |
| Open Shadow DOM traversal | Verified (jsdom) | **Verified** in Chromium, nested | `dynamic.spec.ts` fills through two shadow roots |
| Closed Shadow DOM | Asserted unreachable (jsdom) | **Unsupported**, confirmed in Chromium | the page cannot reach it either; it is a browser boundary |
| Same-origin iframes | **Partial** — jsdom cannot load frame `src` | **Verified** in Chromium | `dynamic.spec.ts` fills through a real frame |
| Cross-origin iframes | Asserted unreachable, but against a frame that never loaded | **Unsupported**, confirmed against a frame that *does* load | the server is dual-origin so `localhost` vs `127.0.0.1` gives a real cross-origin frame |
| Performance at scale | Untested | **Verified** linear-ish | per-field cost 4.79→5.09 ms across 50× size; 400 fields scan in 967 ms in Chromium |

## Platforms

| Platform | At audit | Now | Why not more |
| --- | --- | --- | --- |
| Generic HTML | Verified | **Verified** | — |
| Google Forms | Verified against a local mock | **Verified** against a local mock | `docs.google.com` is blocked by this container's network policy |
| Microsoft Forms | **Untested** — recognised by URL, no adapter | **Experimental** | `forms.office.com` blocked |
| Typeform | **Untested** — recognised by URL, no adapter | **Experimental** | `form.typeform.com` blocked |
| Jotform | **Untested** — recognised by URL, no adapter | **Experimental** | `jotform.com` blocked |
| SurveyMonkey | **Untested** — recognised by URL, no adapter | **Experimental** | `surveymonkey.com` blocked |

The audit's honest conclusion here has not changed: **no hosted form platform has been validated
against its live product, and none can be from this environment.** What changed is that four of
them now have adapters written against their published markup contracts and tested against local
reproductions, and each reports `supportStatus: 'experimental'` with a `provenance` string saying
exactly what it was built against.

Building them surfaced a defect worth recording. Four adapters composed their marker selectors as
`` `${QUESTION} ${TITLE}` ``, which CSS parses as a selector *list* rather than a descendant
combinator when both parts contain commas. The SurveyMonkey adapter's list ended in a bare
`legend`, so any page with one `<fieldset>` was claimed by it — a plain React page came back
labelled as a Microsoft Forms reproduction. That is the exact failure mode the audit was worried
about: a platform adapter asserting authority over a page it knows nothing about.

## Frameworks

| Framework | At audit | Now | Evidence |
| --- | --- | --- | --- |
| React controlled components | **Untested** — "manual only"; the mechanism was unit-tested, the page was not | **Verified** | React 19 app; writes reach `useState`, survive a re-render |
| Next.js App Router | **Untested** — "manual only" | **Verified** | the repository's own route against a real `next dev` server, post-hydration |
| Vue | **Untested** — the docs said the engine "uses standard DOM events these frameworks listen to, which is an argument, not a measurement" | **Verified** | Vue 3 with the runtime template compiler, so real `v-model` codegen runs |
| Angular | **Untested**, same argument | **Verified** | Angular 18 JIT, both `ngModel` and a reactive `FormGroup` |
| Svelte, Solid, others | **Untested** | **Untested** | no fixture written |

The audit flagged that sentence — "which is an argument, not a measurement" — as the clearest
example of the problem. It was honest about being an argument, and the argument was correct, but
it was standing in for a test. Three of the four are now measured; the fourth (Svelte and
beyond) is still an argument and still labelled as one.

## Safety

| Invariant | At audit | Now | Evidence |
| --- | --- | --- | --- |
| Never submits a form | Verified (jsdom) | **Verified**, plus a source-level guarantee | no submission call exists in `extension/src/` or `shared/`; clicking is confined to one reviewed function |
| Never bypasses CAPTCHA | Verified by phrase match | **Verified** | `captcha` blocks; no solving code exists |
| Never intercepts OTPs | **Partial** — 27 of 60 adversarial cases blocked | **Verified** | all 60 blocked, including "SMS code" and "the 6-digit code we texted you" |
| Never performs payments | **Partial** | **Verified** | `sort code`, `UPI ID`, `expiry date` now blocked |
| Never accepts legal agreements | **Partial** — only first-person wording caught | **Verified**, with a structural backstop | second-person and imperative wording blocked; a lone checkbox is never pre-accepted whatever its label |
| Never uploads documents unprompted | Verified | **Verified** | file fields open the user's own picker |
| Never fills low-confidence sensitive data | Verified | **Verified** | write-time re-check ignores a forged sensitivity |
| CI fails on a safety regression | **Unsupported** — no CI existed | **Verified** | `.github/workflows/ci.yml`, `safety` as its own required job; mutation-tested |

The audit's sharpest safety finding was that the policy was a **phrase list with no second
layer**. A phrase list can never be complete, and the adversarial probe proved it: 33 of 60
evasions worked. Closing them made the list longer, which does not fix the underlying problem —
so the structural rule was added alongside. A lone checkbox is never pre-accepted regardless of
confidence or wording, because ticking one asserts something in the user's name and that
guarantee should not depend on reading the label correctly.

Closing them also introduced a regression, which is worth recording as a caution: adding bare
`pin` to the secret list blocked "PIN Code", an Indian postal code, in 27 of 400 generated
fields. Over-blocking is a real defect, and 15 tests now guard against it.

## Privacy

| Area | At audit | Now | Evidence |
| --- | --- | --- | --- |
| Permissions | Verified minimal | **Verified** in Chromium | manifest asserted as exactly `storage, activeTab, scripting` |
| No logging of user data | Verified by inspection | **Verified** | zero `console.*` in `extension/src/` and `shared/` |
| Local-only storage | Verified | **Verified** | nothing in `chrome.storage.sync` |
| Export / delete controls | Verified | **Verified** | — |
| AI payload minimisation | **Not implemented** — the whole profile was sent | **Verified** | `shared/privacy/redact.ts`; the stub receives `basicProfile` keys `['email','fullName']` on a prose batch |
| Page URL sent to the AI path | Undocumented | **Documented as a residual risk** | `research/privacy-audit.md`; a Chromium spec records it rather than asserting it away |

The audit found that the AI request forwarded the stored profile whole, and the server route
serialises what it receives straight into the prompt. Drafting one paragraph therefore sent the
model provider a phone number, date of birth, gender, full postal address, every saved document
and every alternate persona the user keeps. That is now minimised per request mode, and verified
against what the endpoint actually receives rather than in a unit test alone.

## Research claims

| Claim | At audit | Now |
| --- | --- | --- |
| Detection / mapping / routing accuracy | Verified on a 12-page synthetic corpus | **Verified** on 17 page states, 120 fields |
| Semantic matching P/R/F1 | **Not measured** — no labelled matching dataset existed | **Partial** — 69 cases, but the dataset is no longer held out |
| Threshold sweep | **Not measured** | **Verified** — 0.50 to 0.95 |
| Ablation against baselines | **Not measured** | **Verified** — 4 baselines and 2 self-ablations |
| AI contribution | **Not measured** | **Partial** — routing decisions measured; answer quality not measurable here |
| Long-form answer quality | **Not measured** | **Unsupported** in this environment — needs a provider key |
| Human acceptance / correction rates | **Not measured** | **Unsupported** — needs human participants |
| Performance | **Not measured** | **Verified** — jsdom scaling curve plus real Chromium latency |

Two of these deserve a caveat in the same breath as the number.

**The matching study is no longer held out.** It scored 65/69 on its first run, three ontology
defects and one harness bug were fixed in response, and it now scores 69/69. That makes it a
regression suite with a research harness attached. `research/matching/README.md` says so before
quoting the figure.

**The benchmark corpus is synthetic and self-authored.** Every fixture was written by the same
agent that wrote the engine. 100% on it means the engine does what its author expected, which is
a weaker claim than it looks. It is the floor, not the ceiling.

## What remains untested or unsupported

Stated plainly, because these are the gaps a reader should hold against everything above:

1. **No live hosted platform.** Google Forms, Microsoft Forms, Typeform, Jotform and
   SurveyMonkey are all blocked at the network layer here. Four adapters are `Experimental` for
   exactly this reason.
2. **No model provider.** Generated answer quality, grounding faithfulness and hallucination
   rate are unmeasured. The routing decisions around them are measured.
3. **No human participants.** Acceptance rate, correction rate and trust are unmeasured, and no
   proxy for them is reported.
4. **No independent labels.** Both the benchmark corpus and the matching dataset were authored
   by the same agent as the engine.
5. **Frameworks beyond the four tested.** Svelte, Solid, Ember and others fall to the generic
   engine. The argument that they listen to the same DOM events is sound and is still only an
   argument.
6. **Firefox and Safari.** Untested. The manifest is MV3; Firefox's MV3 differs in ways nothing
   here has exercised.
7. **This audit's own independence.** It was written by the agent whose work it audits. Every
   row names its evidence so someone else can check it, which is the best that can be offered
   from here.

# Limitations

Ordered by how much they should temper a reader's confidence.

## 0. The number to hold against everything else

Independent evaluation against 307 form controls written by 55 unrelated authors, ground truth from
their own `autocomplete` attributes: **82.1% accuracy, 73.1% macro F1**. Every 100% elsewhere in this
repository comes from a corpus this project wrote and means "no regression".

FormPilot's margin over a plain substring baseline on that set is **1.3 F1 points**. The elaborate
multi-signal matcher buys far less raw accuracy on third-party labels than the synthetic corpus
implies. What it does buy is calibration — it converts confident errors into abstentions — which a
single accuracy figure cannot see. See `held-out-evaluation.md` and `baseline-comparison.md`.

## 1. No real-world evaluation

Every number in this repository comes from synthetic corpora written by the same agent as the
engine: 17 page states and 120 labelled fields for the benchmark, 69 cases for the matching study.
**No live website has been evaluated, and none can be from this environment** — its network policy
denies `docs.google.com`, `forms.office.com`, `form.typeform.com`, `www.jotform.com` and
`www.surveymonkey.com` at CONNECT, re-confirmed 2026-09-29 by
`./research/platform-probe/probe.sh`. Third-party *markup* is reachable via
`raw.githubusercontent.com`, which is how the held-out corpus exists; live *platforms* are not. The corpora therefore measure whether the engine still does
what it was built to do. Cite them as a regression baseline.

The matching study carries a second caveat of its own: it scored 65/69 on its first run, three
ontology defects and one harness bug were fixed in response, and it now scores 69/69. It is no
longer held out. See [matching/README.md](./matching/README.md).

What would change this: a stratified sample of live forms, labelled independently by two
annotators with agreement reported, driven through a real browser. Designed in
[experiment-design.md](./experiment-design.md); not run.

## 2. No human study

Acceptance rate, correction rate, override rate, completion time and error rate in submitted forms
are all properties of people. The session layer records what is needed
(`sessionMetrics`: accepted / rejected / edited / filled / failed), and no study has been run. The
"automation rate" and "review burden" figures describe the *work the system creates*, not how
humans respond to it. No proxy for a human response is reported anywhere, deliberately.

## 3. The language-model path is unmeasured

**There is no model provider or API key in this environment**, so no model has ever been called.
`npm run study:routing` reports 12 of 109 fields routed to a model across 13 pages — eight prose
answers and four uncertain mappings — and names every one of them. That is the *size and shape of
the model's job*, counted, not executed.

Unmeasured: the quality of a generated long-form answer, how often the model correctly declines,
the accuracy of its adjudication on an ambiguous field, and its hallucination rate. The grounding
rules in the prompts are constraints on the model's instructions, not guarantees about its output;
the review panel is the actual safeguard.

What *is* verified about the path, against a labelled deterministic stub in
`tests/e2e/specs/ai-routing.spec.ts`: which fields are sent, that one batched request goes per
page rather than one per field, that the profile is minimised before it leaves the device, that an
answer merges back into the panel unaccepted, and that `allowAI: false` makes no request at all.
The stub is not a model, and no number derived from it is an answer-quality measurement.

## 4. Platforms that are recognised but not supported

Microsoft Forms, Typeform, Jotform and SurveyMonkey now have dedicated adapters, each written
against its platform's published markup contract and tested against a local reproduction. Each
reports `supportStatus: 'experimental'` with a `provenance` string naming what it was built
against, and the review panel warns the user. **None has been run against its live product**, and
none can be from here. Read them as "the structure was read correctly", not as platform support.

Google Forms is in the same position with a longer test suite: 15 regression tests covering every
v1 question type including grid flattening, all against a local mock, because `docs.google.com` is
blocked too. It is **Partial**, not Verified.

Degradation is tested rather than assumed: an adapter requires its platform's *markup*, not just a
URL match, so a Typeform URL serving plain markup falls through to the generic engine with an
honest warning and still fills correctly.

React, Next.js, Vue and Angular are no longer in this category — all four are now validated in
Chromium against real framework builds, asserted against framework state rather than the DOM.
Svelte, Solid, Ember and the rest still are: the interaction engine uses the native prototype
setter and native `input`/`change` events, which those frameworks do listen to. That is a reason
to expect it to work, not evidence that it does.

## 5. Browser-security boundaries that cannot be crossed

Not limitations to be fixed — statements of what is impossible, and confirmations that the engine
does not pretend otherwise:

* **Cross-origin iframes** cannot be read. The engine counts them, warns the user, and tells them
  those fields need manual entry.
* **Closed shadow roots** cannot be traversed. Fields inside them are invisible, and the engine
  does not report them.
* **CAPTCHA and anti-bot mechanisms** are not touched, in any way, by design.
* A **file** cannot be attached without the user picking it. FormPilot stores no document bytes and
  opens a native picker.

## 5b. The panel can cover the page it is reviewing

The review panel is a fixed 400px column against the right edge of the window. On a page whose form
is centred, a narrow window puts the panel on top of the form's right-hand side — and a form's own
buttons are usually on that side.

Measured, not estimated: in a 1280×720 window on
`frontend/public/test-forms/google-forms-advanced-mock.html`, whose form is 680px and centred,
`document.elementFromPoint` at the centre of the form's own **Next** button returns the panel host,
not the button. Chromium refuses to click through it, and so would a user's mouse.
`tests/e2e/specs/google-forms-sections.spec.ts` asserts both halves of this: that the panel is on
top, and that closing it gives the button straight back.

It is a layout limitation rather than a safety one — nothing is hidden or altered, the panel has a
Close button, and the page is fully usable the moment it closes. It is recorded here because a
multi-step form is exactly where it bites: the user wants the panel open *while* navigating, and on a
small screen they cannot have both.

Not fixed in this phase. Any fix is a real design decision — docking the panel so it reshapes the
page, making it draggable, or collapsing it to an edge — and none of those should be chosen from a
single fixture's geometry.

## 6. Heuristics that will be wrong sometimes

* **Step detection** has no standard markup to rely on. It infers a wizard from an indicator list
  (`[data-step]`, `[role=tab]`, `aria-current="step"`, common class names) or from sibling panels
  where some are hidden. A custom wizard with none of those signals looks like a single-page form,
  and the user is told only about the step in front of them.
* **Section inference** falls back to the nearest preceding heading in document order, which is
  wrong on visually columnar layouts.
* **Field ids are positional.** The detector names fields `f0`, `f1`, `f2` in document order, so an
  id identifies a *place on the current screen*, not a field. A multi-step form re-detects on every
  step and numbers each step from zero again, which means step two's `f0` wears step one's name.

  Anything keying on a field id across a re-detection is therefore wrong, and one thing was: the
  review panel carried a user's decision over whenever the id matched, so on a six-step application
  it copied step one's answers onto step two's questions — the applicant's name into Degree, their
  email into University — accepted flags included, and pressing Fill wrote them. Fixed by recording
  the field's identity alongside each decision and requiring both to match
  (`reconcileDecisions`, pinned by `tests/unit/panel-decisions.test.ts`), and the session layer was
  already correct because it keys by `fieldKey(field)` rather than by id.

  The ids themselves are still positional. Making them content-derived is the deeper fix and was not
  attempted here: ids thread through the element map, the selectors, the suggestion pipeline and the
  benchmark's ground truth, and that is not a change to make in a release pass. Until then, a field id
  is safe to use *within* one detection and never across two.
* **Selector stability** is best-effort. A framework that regenerates ids and class names on every
  render can invalidate a selector between detection and filling. The session keys decisions by
  field *identity* rather than id to limit the damage, and the engine re-detects on mutation, but a
  sufficiently hostile re-render will still lose a binding.
* **The abbreviation table and ontology are English-only.** A non-English form falls back to the
  weakest signals.
* **ARIA options with no group markup are not merged.** A multi-select built from `role="checkbox"`
  divs is treated as one question only where the author said so — an enclosing `role="group"`,
  `role="radiogroup"` or `role="listbox"`, or a container a platform adapter supplied. Without one of
  those, each checkbox comes through as its own boolean field, so a list from the profile cannot be
  applied to it in one go and the user ticks the boxes themselves.

  This is a deliberate trade, made after the previous rule — group ARIA options by shared parent
  element — merged a marketing opt-in and a legal consent that happened to sit in the same
  `<fieldset>` into a single field labelled with the fieldset's legend: one control for two unrelated
  decisions, under a label naming neither. Splitting a question costs the user some clicking. Merging
  two questions puts one decision behind a label describing another, and where either is consent,
  that is the case the safety layer exists to prevent. `tests/unit/aria-option-grouping.test.ts`
  tests both directions, since the trade only holds if the capability it costs is the smaller one.
  Radios are exempt and still merge on a shared parent: they are mutually exclusive by definition, so
  grouping them cannot fuse two independent decisions.

## 7. Testing environment

Unit and integration tests and the benchmark run under jsdom: no layout, no real event ordering,
no CSS-driven visibility, no genuine cross-origin enforcement. The engine avoids layout APIs partly
to be testable, which is a design compromise: it uses attributes and computed style to decide
visibility, so a control hidden purely by clipping or zero size is treated as visible.

There is now also a Playwright suite — 38 specs in Chromium 141 against the built extension — which
covers what jsdom cannot: the MV3 service worker, `chrome.scripting` injection, real shadow-root
rendering, a real same-origin policy on a loaded iframe, real framework hydration, and real
latency. The jsdom performance study is explicit that its absolute milliseconds do not transfer to
a browser, only the shape of its curve; `tests/e2e/specs/performance.spec.ts` supplies the real
numbers.

One harness compromise is worth naming. `chrome.scripting.executeScript` needs either `activeTab`,
which only a real toolbar click grants and no automation API can simulate, or a `host_permissions`
match. So the Next.js dev server is reverse-proxied through the origin the manifest already
trusts. Adding a test-only origin to the shipped manifest would have made the test pass by
defeating the permission reduction it exists to protect.

## 8. Not verified in this repository

* **Chrome itself, as opposed to Chromium.** The extension is loaded and driven in Chromium
  141.0.7390.37 by 38 end-to-end specs. Chrome stable ships the same engine and is not separately
  run. Firefox and Safari are untested; Safari would need a Web Extension wrapper that does not
  exist here.
* **Any live hosted form platform.** See section 4.
* **Any real model output.** See section 3.
* The `openai-compatible` AI provider is implemented and typechecked but has never been run
  against a live endpoint. It is documented as experimental. `gemini` remains the default and is
  the provider the v1 system used.
* `/api/ai/parse-resume` remains Gemini-specific: it is a multimodal call, which the text-only
  provider interface does not model. Adding multimodal support to the abstraction is future work.

## 9. Metric design choices that flatter or penalise

Stated so a reader can adjust:

* **Detection pairing is label-based**, so a label-extraction error is charged to detection rather
  than to mapping. This *penalises* the reported detection score relative to a control-based
  pairing.
* **Autofill is measured under accept-everything**, which is stricter than the shipped default
  (only high-confidence suggestions are pre-accepted, and a lone checkbox never is) and is the
  only way an over-eager fill becomes visible.
* **Mapping is scored only over asserted mappings.** A field the engine declined to map is not
  counted as a mapping error. This *flatters* mapping precision; the routing-accuracy metric is
  what catches an engine that declines too often.
* A wrong mapping counts as both a false positive and a false negative, so it depresses precision
  and recall together.

## 10. Over-blocking, which is a real defect and not the safe side

Widening the safety phrase lists to close 33 evasions introduced a regression: a bare `pin` in the
secret list blocked "PIN Code", which in India is a Postal Index Number, not a credential. 27 of
400 generated fields came back refused. It was caught by a performance test that also checked
correctness, not by the safety suite that had just been extended.

A safety net that catches ordinary fields stops being used, so 15 cases now assert that ordinary
fields stay fillable, and short ambiguous tokens (`pin`, `tin`) are only listed in qualified forms.
The general lesson stands: every widening of those lists needs a matching test on the other side.

## 11. Self-audit

Every document in this directory, including this one, was written by the agent that wrote the code.
That is a conflict of interest. The mitigation is that every claim names the command or file that
substantiates it, so a reader can check rather than trust. It is not a substitute for independent
review.

## 12. Findings the independent evaluation added

Four things only third-party data surfaced, all recorded rather than fixed because the configuration
was frozen before the held-out run:

1. **Four missed refusals on real payment markup.** A label beginning "CC " is not in the secret
   phrase list, so `CC Name (Full name as given on the payment card)` maps to `person.full_name`.
   Bounded — nothing is submitted and every suggestion is reviewable — but a user clicking through
   would put their name in a cardholder field. Highest-priority fix; needs a fresh corpus to measure.
2. **Non-Latin labels at 50.1 macro F1** against 72.1 for Latin ones. The English-only scope boundary,
   previously asserted, now measured.
3. **Address composition is the largest error cluster.** `address.full` 45% precision; the bare label
   "Address" is misread three times in one split.
4. **The control-type signal contributes −0.4 accuracy points** on third-party data. It helps on the
   synthetic corpus and is load-bearing elsewhere, but this evaluation gives it no support.

## 13. What the held-out evaluation still cannot see

The *labels* are independent and the ground truth is spec-defined, but the **concept inventory is
this project's**. A field whose meaning FormPilot models no concept for cannot appear in the
evaluation, because it would carry no `autocomplete` token either. So 82.1% is accuracy *within the
ontology's scope*, and nothing here measures how much of a real form falls outside it.

The corpus also skews toward authors who bothered to write `autocomplete` attributes at all, who
probably write better labels too. That likely flatters the result, in the opposite direction from the
ground-truth noise described in `held-out-evaluation.md`. Neither is quantified.

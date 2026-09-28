# Limitations

Ordered by how much they should temper a reader's confidence.

## 1. No real-world evaluation

Every number in this repository comes from a 12-state, 85-field synthetic corpus written by the
same author as the engine. **No live website has been evaluated.** The corpus therefore measures
whether the engine still does what it was built to do; it cannot support a claim about the open
web. Anyone citing these figures should cite them as a regression baseline.

What would change this: a stratified sample of live forms, labelled independently by two
annotators with agreement reported, driven through a real browser. Designed in
[experiment-design.md](./experiment-design.md); not run.

## 2. No human study

Acceptance rate, correction rate, override rate, completion time and error rate in submitted forms
are all properties of people. The session layer records what is needed
(`sessionMetrics`: accepted / rejected / edited / filled / failed), and no study has been run. The
"automation rate" and "review burden" figures describe the *work the system creates*, not how
humans respond to it.

## 3. The language-model path is unmeasured

Nine of 85 fields are routed to a model. Those fields are scored on the routing decision only. The
quality of generated long-form answers, how often the model correctly declines, and the accuracy
of its adjudication on ambiguous fields are all unmeasured. The grounding rules in the prompts are
constraints on the model's instructions, not guarantees about its output; the review panel is the
actual safeguard.

## 4. Platforms that are recognised but not supported

Microsoft Forms, Typeform, Jotform and SurveyMonkey are recognised by URL and DOM fingerprints and
deliberately fall through to the generic adapter, reported as `generic-fallback`. There is no
fixture, no adapter and no measurement for any of them. They should be read as "the engine will
try" and nothing more.

Vue, Angular and vanilla-JS forms are in the same position with one caveat: the interaction engine
uses the native prototype setter and native `input`/`change` events, which those frameworks do
listen to. That is a reason to expect it to work, not evidence that it does.

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

## 6. Heuristics that will be wrong sometimes

* **Step detection** has no standard markup to rely on. It infers a wizard from an indicator list
  (`[data-step]`, `[role=tab]`, `aria-current="step"`, common class names) or from sibling panels
  where some are hidden. A custom wizard with none of those signals looks like a single-page form,
  and the user is told only about the step in front of them.
* **Section inference** falls back to the nearest preceding heading in document order, which is
  wrong on visually columnar layouts.
* **Selector stability** is best-effort. A framework that regenerates ids and class names on every
  render can invalidate a selector between detection and filling. The session keys decisions by
  field *identity* rather than id to limit the damage, and the engine re-detects on mutation, but a
  sufficiently hostile re-render will still lose a binding.
* **The abbreviation table and ontology are English-only.** A non-English form falls back to the
  weakest signals.

## 7. Testing environment

Automated tests and the benchmark run under jsdom: no layout, no real event ordering, no
CSS-driven visibility, no genuine cross-origin enforcement. The engine avoids layout APIs partly
to be testable, which is a design compromise: it uses attributes and computed style to decide
visibility, so a control hidden purely by clipping or zero size is treated as visible. There is no
Playwright suite; the React pages, the iframe page and the extension UI are verified by hand.

## 8. Not verified in this repository

* The extension has not been loaded into a real Chrome profile as part of this work. It builds,
  typechecks and produces a valid MV3 bundle including the fixed-path injectable engine, and the
  engine's logic is covered by 343 automated tests — but "installed and driven in Chrome" is a
  separate claim and is not made.
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
  (only high-confidence suggestions are pre-accepted) and is the only way an over-eager fill
  becomes visible.
* **Mapping is scored only over asserted mappings.** A field the engine declined to map is not
  counted as a mapping error. This *flatters* mapping precision; the routing-accuracy metric is
  what catches an engine that declines too often.
* A wrong mapping counts as both a false positive and a false negative, so it depresses precision
  and recall together.

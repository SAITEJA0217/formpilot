# Experiment design

## Research questions

* **RQ1** Can one platform-independent schema and matcher cover form architectures as different
  as Google Forms' ARIA widget tree, a plain labelled HTML form, and a React-controlled form?
* **RQ2** What share of fields can be resolved deterministically, without a language model?
* **RQ3** Where does the deterministic path fail, and does the engine *know* it has failed —
  i.e. does it route those fields to review rather than filling them wrongly?
* **RQ4** How much human review does the system create, and is the confidence banding calibrated
  enough that the pre-accepted set is trustworthy?
* **RQ5** Are the safety refusals absolute under adversarial input?

## Design

**Unit of analysis:** one form field.
**Independent variables:** page category, field type, label-extraction strategy, form dynamism
(static / conditional / multi-step), label ambiguity.
**Dependent variables:** the metrics in [evaluation-metrics.md](./evaluation-metrics.md).
**Control:** one fixed profile (`research/benchmark/profile.ts`), imported by both the benchmark
and the test suite so expected values cannot drift.

**Procedure**, per page state:

1. Build a fresh jsdom realm from the fixture and run its inline scripts. A fresh realm per page
   is required, not a convenience: the engine's `instanceof Document` checks are per-realm, and
   reusing one realm let a previous page's event listeners stack on the next page's, which flipped
   every checkbox twice and made a working autofill look broken.
2. Apply the declared mutations, which drive the page's own script (click Next, choose an option)
   rather than injecting markup.
3. `normalizeForm` → `UnifiedForm`. Record timing.
4. `buildSuggestions(form, profile)` → suggestions + the minimal AI request set. Record timing.
5. Write every proposal (the accept-everything upper bound) and read each value back from the DOM.
6. Pair against ground truth; compute detection, mapping, routing, autofill, safety.

**Not varied, and why:** no model is called. Fields the router defers to a model are scored on the
routing decision only. A model in the loop would make the run non-deterministic and would measure
the model rather than the framework; the framework's claim is precisely that it *avoids* the model
for most fields.

## Current result

Engine 2.0.0, node v22.22.2, jsdom, no model called. 17 page states, 120 labelled fields.
Every accuracy figure below is reproduced byte-for-byte on every run; the timing row is the one
non-deterministic output, so it points at the generated report rather than quoting a value. The
exact run is timestamped in `research/benchmark/results/latest.md`.

| Metric | Value |
|---|---|
| Field detection P / R / F1 | 100% / 100% / 100% (120 TP, 0 FP, 0 FN) |
| Concept mapping P / R / F1 | 100% / 100% / 100% (74 asserted mappings) |
| Routing decision accuracy | 100% |
| Autofill success rate | 100% (56/56 correct, 0 wrong, 0 missed) |
| Safety violations | 0 |
| Fields resolved without a model | 89.2% (13 of 120 model-bound) |
| Model calls for the whole corpus | 7 |
| Detection time per page | varies run to run — see `results/latest.md` (order 10–200 ms under jsdom) |
| Automation rate | 55.3% pre-accepted |
| Review burden | 32.9% |

**How to read this.** A perfect score on a corpus the same author wrote is a *regression guard*.
It says the engine handles the cases the corpus encodes and that a future change that breaks them
will be caught. It does not say the engine generalises, and no claim of generality should be drawn
from it. Six of these numbers were *not* perfect when the harness was first run; each gap was a
real defect, and they are listed below because the failures are more informative than the final
score.

## Defects the benchmark found

| Symptom | Root cause | Fix |
|---|---|---|
| `B.Tech` never matched a `Bachelor's Degree` option | `tech` expanded to `technical`, so `B.Tech` normalized to `b technical` | stop expanding `tech`; add explicit `tech skills` alias |
| `Phone Number` in a contenteditable was blocked as a card-number field | a hard type gate dropped an exact match below an unrelated weak one | soft gate (×0.85) between text-bearing types; fix `contenteditable` + `role=textbox` classification |
| Shadow DOM and iframe fields were invisible from `normalizeForm` | `{...DEFAULTS, ...options}` let a forwarded `undefined` overwrite the defaults | resolve options field by field with `??` |
| A radio set was labelled with its first option's text | the group's primary element is one member, whose own `<label>` names the choice | skip the element's own accessible name for multi-member groups; read the group's name or legend |
| Google Forms grid rows selected the wrong column | positional `nth-of-type` counted the row-header cell as a sibling | address grid options with a real synthesized selector |
| A custom dropdown reported success without changing | no read-back for the click-to-select path | require the option to be marked selected, or the control's own text to change |
| `Company Email` was answered with the employer's name | `experience.company` had no disqualifying phrase for email fields | add `email`/`phone`/`address` negatives |
| A field labelled `Other` would have had a paragraph generated into it | a generative concept matched, with no check on the control's shape | refuse generation into a single-line control |
| A low-confidence value was labelled `manual` while still carrying a value | conflated "nothing to propose" with "propose but do not pre-accept" | `manual` means no proposal; low-confidence values are `needs_review` with their true band |

## Experiments still required

These are designed but **not run**, and nothing in this repository reports results for them.

1. **Real-site evaluation.** A sample of live job-application, registration and survey forms,
   stratified by platform, labelled by two annotators with inter-annotator agreement reported.
   This is the only way to make a generalisation claim. Needs a browser harness (Playwright) and
   an ethics-appropriate sampling protocol.
2. **Human-in-the-loop study.** Participants complete matched forms with and without FormPilot.
   Measures: completion time, manual interactions, acceptance rate, correction rate, override
   rate, and errors in the submitted form. The session layer already records what is needed.
3. **Threshold sweep.** Vary the high/medium thresholds over a grid and plot automation rate
   against incorrect-fill rate. The thresholds are already parameters, so this needs only a driver.
4. **Ablation.** Disable one signal group at a time (autocomplete, patterns, aliases, token
   similarity, character similarity, context, gates) and report the drop in mapping F1. This
   quantifies which signals carry the system.
5. **LLM contribution.** With a model configured, measure how many of the routed fields it answers
   correctly, and how often it correctly declines. Also the counterfactual: send *every* field to
   the model and compare accuracy, latency and cost against the hybrid.
6. **Platform coverage.** Microsoft Forms, Typeform, Jotform and SurveyMonkey: fixtures, adapters
   where needed, and the same metrics. Currently only recognised, not supported.
7. **Robustness over time.** Re-run against the same real sites after an interval to measure decay
   as pages change — the failure mode that kills selector-based systems in production.

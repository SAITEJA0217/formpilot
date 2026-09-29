# FormPilot — research documentation

FormPilot v2 is a universal semantic web-form understanding and human-in-the-loop autofill
framework. This directory holds the material needed to evaluate it as a research artifact rather
than as a product demo.

## Documents

| Document | Contents |
| --- | --- |
| [PHASE2_AUDIT.md](./PHASE2_AUDIT.md) | **start here** — what was implemented vs what was validated, and what changed |
| [FINAL_VALIDATION_REPORT.md](./FINAL_VALIDATION_REPORT.md) | every claim, its status, and the command that proves it |
| [architecture.md](./architecture.md) | the system, layer by layer, and why it is split that way |
| [methodology.md](./methodology.md) | how a field is understood: signals, scoring, routing |
| [experiment-design.md](./experiment-design.md) | what is measured, against what, and what is not |
| [evaluation-metrics.md](./evaluation-metrics.md) | every metric's exact definition |
| [test-dataset.md](./test-dataset.md) | the corpus, the ground truth, and its biases |
| [compatibility-matrix.md](./compatibility-matrix.md) | Verified / Partial / Experimental / Untested / Unsupported, per row |
| [privacy-audit.md](./privacy-audit.md) | what is stored, what leaves the device, what is logged |
| [limitations.md](./limitations.md) | what does not work, and what the numbers do not show |
| [reproducibility.md](./reproducibility.md) | how to reproduce every number from a clean checkout |

## Studies

Each writes a fresh `results/latest.json` and `latest.md` on every run. Nothing is carried over
between runs and nothing is hand-edited.

| Study | Command | Reports |
| --- | --- | --- |
| [benchmark](./benchmark/) | `npm run bench` | detection, mapping, routing, autofill, safety over 17 page states / 120 fields |
| [matching](./matching/) | `npm run study:matching` | per-concept P/R/F1, threshold sweep 0.50–0.95, ablation against 4 baselines |
| [routing](./routing/) | `npm run study:routing` | deterministic-only vs deterministic-plus-model, and what the model is asked about |
| [performance](./performance/) | `npm run study:performance` | scaling from 10 to 500 fields |

## The three things to read before quoting any number

**1. The corpus is synthetic and self-authored.** 100% on detection, mapping, routing and
autofill over 17 page states and 120 labelled fields is a regression guard, not evidence of
generality. Every fixture was written by the same agent that wrote the engine, so it encodes the
cases the engine was built to handle. [test-dataset.md](./test-dataset.md) documents the biases in
detail.

**2. The matching study is no longer held out.** It scored 65/69 on its first run. Three ontology
defects and one harness bug were fixed in response, and it now scores 69/69. That makes it a
regression suite with a research harness attached, not a generalisation measurement.
[matching/README.md](./matching/README.md) says so before quoting the figure, and lists each
defect.

**3. Two things cannot be measured from this environment at all.** Its network policy blocks
every hosted form platform, so no adapter can be promoted past **Experimental**. And there is no
model provider or API key, so generated answer quality is unmeasured — the routing decisions
around it are measured, the answers are not.

## What *is* validated in a real browser

38 end-to-end specs run against the built extension in Chromium 141, with a real MV3 service
worker, real `chrome.scripting` injection and a real shadow-DOM panel:

- the whole workflow, from install to a filled field, asserted against the rendered UI
- controlled-component writes reaching framework state in React 19, Vue 3, Angular 18 and the
  repository's own Next.js 16 route, and surviving a re-render
- dynamic forms, multi-step wizards, nested open shadow roots, a closed shadow root, a
  same-origin iframe and a genuinely cross-origin one
- the AI path against a labelled deterministic stub: which fields are sent, that the profile is
  minimised first, and that `allowAI: false` makes no request at all
- latency: a 400-field form scans in 967 ms, 2.42 ms per field

Running it for the first time found a **30-second stall on first use** that no amount of jsdom
testing could have surfaced. [PHASE2_AUDIT.md](./PHASE2_AUDIT.md) has the details.

## Contribution claims, stated narrowly

1. **A platform-independent unified form schema** that a Google Forms question, an ARIA widget
   tree and a plain HTML input all normalize into, letting one matcher and one interaction engine
   serve all of them.
2. **A hybrid field-understanding pipeline** in which deterministic multi-signal matching handles
   the large majority of fields and a language model is invoked only for ambiguous mappings and
   genuinely open questions — 89.2% of benchmark fields resolved with no model call, and the
   ablation quantifies what each component of the matcher contributes.
3. **Per-decision provenance**: every suggestion carries the concept, the profile path and the
   individual weighted signals that produced it, so both a reviewer and an experiment can audit a
   mapping instead of trusting a scalar.
4. **A safety layer that is measured adversarially, not asserted.** 60 evasion techniques are
   tested, of which the first implementation blocked 27. The gap is closed, the suite is
   mutation-tested, and it runs as its own required CI job so a regression fails the build.
   Because a phrase list can never be complete, a structural rule sits behind it: a lone checkbox
   is never pre-accepted, whatever its label says.
5. **Calibrated uncertainty as a first-class outcome.** A concept can declare an alias
   *context-dependent*, so a field labelled only `Company` is still mapped but capped below the
   auto-accept band, while `Current Company` is not. The distinction came out of the matching
   study rather than being designed in advance.

## What would be needed to make a generalisation claim

Set out in [experiment-design.md](./experiment-design.md), not run: a stratified sample of live
forms, labelled independently by two annotators with inter-annotator agreement reported, driven
through a real browser, with a human study for acceptance and correction rates. The environment
this was built in cannot reach live forms, so that work is described rather than done.

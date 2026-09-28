# FormPilot — research documentation

FormPilot v2 is a universal semantic web-form understanding and human-in-the-loop autofill
framework. This directory holds the material needed to evaluate it as a research artifact
rather than as a product demo.

| Document | Contents |
|---|---|
| [architecture.md](./architecture.md) | the system, layer by layer, and why it is split that way |
| [methodology.md](./methodology.md) | how a field is understood: signals, scoring, routing |
| [experiment-design.md](./experiment-design.md) | what is measured, against what, and what is not |
| [evaluation-metrics.md](./evaluation-metrics.md) | every metric's exact definition |
| [test-dataset.md](./test-dataset.md) | the corpus, the ground truth, and its biases |
| [compatibility-matrix.md](./compatibility-matrix.md) | verified support, populated only from real runs |
| [limitations.md](./limitations.md) | what does not work, and what the numbers do not show |
| [reproducibility.md](./reproducibility.md) | how to reproduce every number from a clean checkout |

## The one thing to read first

The benchmark currently scores 100% on detection, mapping, routing and autofill over its
12 page states and 85 labelled fields. **That number is a regression guard, not evidence of
generality.** The corpus is synthetic, small, and written by the same author as the engine,
so it encodes the cases the engine was built to handle. Treating it as a claim about the
open web would be misleading. [limitations.md](./limitations.md) says exactly what would be
needed to make a generalisation claim, and [test-dataset.md](./test-dataset.md) documents the
corpus's biases in detail.

## Contribution claims, stated narrowly

1. **A platform-independent unified form schema** that a Google Forms question, an ARIA
   widget tree and a plain HTML input all normalize into, letting one matcher and one
   interaction engine serve all of them.
2. **A hybrid field-understanding pipeline** in which deterministic multi-signal matching
   handles the large majority of fields and a language model is invoked only for ambiguous
   mappings and genuinely open questions — 89.4% of fields in the current corpus resolved
   with no model call.
3. **Per-decision provenance**: every suggestion carries the concept, the profile path and
   the individual weighted signals that produced it, so both a reviewer and an experiment
   can audit a mapping instead of trusting a scalar.
4. **A safety layer that is measured, not asserted**: credentials, one-time codes, payment
   and identity numbers, and consent controls are refused at three independent points, and
   the benchmark fails the run if any of them is ever written to.

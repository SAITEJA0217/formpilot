# Evaluation metrics

Every metric below is computed in `research/benchmark/metrics.ts` from an explicit confusion
count. Nothing is smoothed, estimated, or carried between runs. Undefined ratios (zero
denominator) are reported as 0 rather than omitted.

## Field detection

A ground-truth field and a detected field are **paired** when their normalized labels match
(level‑1 normalization, greedy first-match, each detected field consumed at most once).

| Count | Definition |
|---|---|
| TP | a ground-truth field that was paired |
| FP | a detected field that paired with nothing (a field the engine invented or split) |
| FN | a ground-truth field that paired with nothing (a field the engine missed) |

```
precision = TP / (TP + FP)
recall    = TP / (TP + FN)
F1        = 2PR / (P + R)
```

Label-based pairing is the honest choice for this system: the label *is* the unit a user sees,
and an engine that finds a control but extracts the wrong label has not detected the field in
any useful sense. It does mean a label-extraction error is charged to detection, which is
intentional.

## Concept mapping

Scored only over paired fields, and only over **asserted** mappings. A concept is asserted when
the engine acted on it; a below-threshold candidate routed to manual entry is not an assertion,
and neither is a field sent to the model for *adjudication* (where the engine explicitly declined
to choose). A field sent for *generation* is an assertion, because recognising it as a long-form
concept is what routed it there.

| Count | Definition |
|---|---|
| TP | asserted concept equals the expected concept |
| FP | a concept was asserted where the expectation was a different concept, or none |
| FN | an expected concept was not asserted, or a different one was |

A wrong assignment counts as both FP and FN, so precision and recall both fall — a mis-mapping
is two errors, not one. `accuracy = correct / scored`.

## Routing

`outcomeAccuracy` over every ground-truth field: did the engine choose the expected disposition
(`fill` / `model` / `document` / `blocked` / `manual`)? The ground truth may also specify
`review`, which accepts either `manual` or `model` — declared in the dataset schema up front, for
fields where the only requirement is that the engine does not fill confidently.

## Autofill

Measured over ground-truth fields whose expected outcome is `fill`, after the engine has written
its proposals and the values have been **read back out of the DOM**:

| Count | Definition |
|---|---|
| correct | the DOM holds the expected value |
| incorrect | the DOM holds a different value |
| missed | nothing was proposed, or the write failed |

```
successRate = correct / (correct + incorrect + missed)
```

The run simulates a user who accepts every proposal. That is the strictest reading — it is the
only way an over-eager fill becomes visible — and it is *not* the shipped default, where only
high-confidence suggestions are pre-accepted.

Grouped controls are read back through their own option selectors, not by inspecting the group's
primary element, which is one member of the set.

## Safety

`violations` lists every field whose expected outcome is `blocked` or `document` for which the
engine either proposed a value or changed the DOM. This is a hard gate: a non-empty list sets a
non-zero exit code, so the benchmark fails rather than reporting a slightly lower score.

## Efficiency

| Metric | Definition |
|---|---|
| detect ms (mean, sd) | wall-clock `normalizeForm` per page state |
| match ms (mean) | wall-clock `buildSuggestions` per page state |
| model calls total | HTTP requests the router would have made (at most one per mode per page) |
| model-bound fields | fields routed to a model |
| deterministic field share | `1 − modelBound / fieldsEvaluated` |

Timings are from jsdom on one machine and are useful for comparing *relative* cost between page
shapes, not as browser performance figures.

## Human-in-the-loop

| Metric | Definition |
|---|---|
| status distribution | count of `ready` / `needsReview` / `manual` / `blocked` / `noData` |
| automation rate | `ready / total` — the share pre-accepted for one confirmation |
| review burden | `(needsReview + manual + noData) / total` — the share needing a per-field decision |

**Acceptance rate, correction rate and user override rate are not reported.** They are properties
of people, not of the engine, and cannot be obtained without participants. The plumbing to
collect them exists (`sessionMetrics` counts accepted, rejected, edited, filled and failed per
session); the study does not.

## Robustness breakdowns

The report slices every metric by **category** (Generic HTML, ARIA widgets, Ambiguous labels,
Dynamic, Multi-step, Shadow DOM, Google Forms, Safety), by **field type** (18 unified types), and
by **label source** (10 extraction strategies, with mean confidence per strategy). The label-source
breakdown is the most transportable finding: it quantifies how much detection quality depends on
markup quality rather than on the matcher.

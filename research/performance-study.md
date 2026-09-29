# Performance study

Two measurements at two levels: a scaling curve in jsdom, and absolute latency in a real browser.
They answer different questions and are not interchangeable.

| | |
| --- | --- |
| **Procedure** | `npm run study:performance` (jsdom); `npx playwright test performance` (Chromium) |
| **Date** | 2026-09-29 |
| **Software version** | FormPilot 2.0.0, commit `6e01e8e` |
| **Hardware** | one shared cloud container; no CPU pinning, no isolation from neighbours |

## Real browser — the numbers to quote

Chromium 141.0.7390.37, the built extension loaded, median of 3 runs per size. Generated forms of
labelled text inputs, sectioned every ten fields.

| Fields | Detected | Scan + inject | Panel render | **Total preparation** | Per field | Heap growth |
| --- | --- | --- | --- | --- | --- | --- |
| 10 | 10 | 88 ms | 58 ms | **146 ms** | 8.80 ms | 2.2 MiB |
| 25 | 25 | 117 ms | 56 ms | **173 ms** | 4.68 ms | 2.6 MiB |
| 50 | 50 | 168 ms | 66 ms | **234 ms** | 3.36 ms | 2.6 MiB |
| 100 | 100 | 267 ms | 80 ms | **347 ms** | 2.67 ms | 3.2 MiB |
| 250 | 250 | 565 ms | 129 ms | **694 ms** | 2.26 ms | 4.3 MiB |
| 500 | 500 | 1355 ms | 194 ms | **1549 ms** | 2.71 ms | 5.7 MiB |

**Total preparation** is what the user waits for between opening FormPilot and seeing reviewable
suggestions: injection, detection, normalization, matching, suggestion building and rendering the
panel. It includes no model call — see *Where the model would sit* below.

Four readings:

- **Per-field cost falls as forms grow**, 8.80 ms to 2.26 ms at 250. Injecting the engine is a fixed
  cost that amortises; on a 10-field form most of the 164 ms is setup, not work.
- **A 250-field form is ready in 0.69 s.** Real application forms are rarely larger.
- **500 fields cost 1.55 s, and per-field cost rises for the first time** — 2.26 ms at 250 to 2.71 ms
  at 500, about 20% worse. The curve is not perfectly linear at the top end. 500 controls on one
  screen is past anything this project has seen in the wild, so this is a headroom figure rather than
  a user-facing one, but it is the real number and the direction is upward, not flat.
- **Heap growth is sublinear** — 2.4 MiB at 10 fields to 5.7 MiB at 500, so 50× the fields costs 2.4×
  the memory. No leak signature. Measured with Chromium's non-standard `performance.memory`, which
  is coarse and quantised and covers the *page* heap only, not the extension's service worker. Treat
  it as a leak check, not a figure.

500 is measured here, and not only in jsdom, for a specific reason: jsdom has no layout engine, so a
synthetic number at the largest size cannot show work that only appears when 500 controls are laid
out, painted and observed. That is exactly where a synthetic-only figure would be most likely to be
wrong, and the 20% per-field rise above is the kind of thing it would have hidden.

## jsdom — the scaling shape

500 fields are included here because jsdom can run them cheaply and the question is the curve's
shape, not a latency a user would experience. Five timed repeats per size after two discarded
warm-ups, mean ± sample standard deviation.

| Fields | (detect) | normalize | suggest | Total | Per field |
| --- | --- | --- | --- | --- | --- |
| 10 | 36.3 ± 6.3 | 39.6 ± 8.3 | 26.6 ± 4.8 | 66.2 ± 12.8 | 6.62 ms |
| 25 | 49.0 ± 13.4 | 57.1 ± 19.2 | 51.3 ± 13.7 | 108.4 ± 32.3 | 4.34 ms |
| 50 | 96.1 ± 10.6 | 117.5 ± 19.8 | 108.3 ± 9.6 | 225.8 ± 26.8 | 4.52 ms |
| 100 | 244.8 ± 20.2 | 257.2 ± 30.4 | 232.8 ± 37.8 | 490.1 ± 67.6 | 4.90 ms |
| 250 | 586.5 ± 110.1 | 621.3 ± 57.9 | 525.9 ± 76.8 | 1147.1 ± 69.7 | 4.59 ms |
| 500 | 1416.0 ± 132.8 | 1660.3 ± 96.5 | 1017.5 ± 110.0 | 2677.8 ± 126.2 | 5.36 ms |

`detect` is parenthesised because it is a **component of** `normalize`, not a separate stage:
`normalizeForm` calls `detectFields` internally, so the pipeline total is normalize + suggest.
Counting both would charge detection twice, which the first version of this harness did, overstating
the total by about a third. At 500 fields detection is 85% of normalize.

**Scaling: 50× the fields costs 40.4× the time.** Per-field cost moves 6.62 ms to 5.36 ms, so the
engine is close to linear in field count over this range, with no super-linear traversal.

Both tables were re-run for this release, so neither is a figure carried over from an earlier pass.
The run-to-run spread is wide at some sizes (±132.8 ms at 500), which is what a shared container
looks like; that is a reason to read the shape rather than any single cell.

## Where the model would sit

The release brief asks for AI latency and the share of fields routed to a model alongside the rest, so
here is what is measurable and what is not.

**The routed share is measured.** On the benchmark corpus — 17 page states, 120 labelled fields —
**89.2% of fields are resolved without any model call**, and the remaining 10.8% produce **10 model
calls** in total, because the router batches every field on a page into one request.
`research/benchmark/results/latest.md` carries the current figures and
`research/routing/results/latest.md` breaks the routing decisions down by field type.

**The latency of those calls is not measured, and no number here should be read as if it were.** No
provider is reachable from this environment, so a model call is counted, never executed. That means
total preparation above is the *deterministic* path only: on a page that routes fields to a model, a
user waits for that request on top of the figures in this document, and how long that takes is a
property of the provider and the network rather than of FormPilot.

What *is* established about the model path: it is one batched request per page rather than one per
field (`research/routing/`), it carries a minimised profile and a URL stripped to origin and path
(`research/privacy-audit.md`), it is skipped entirely when `allowAI: false`, and a failing endpoint
degrades to review rather than breaking the form
(`tests/e2e/specs/ai-routing.spec.ts`).

## Synthetic versus real, stated plainly

| | jsdom | Chromium |
| --- | --- | --- |
| What it establishes | the shape of the curve | absolute latency a user experiences |
| Layout engine | none | real |
| Event ordering | approximate | real |
| Numbers transfer? | **no** | yes, for comparable hardware |

jsdom is roughly twice as slow per field as Chromium at 250 fields (4.59 ms against 2.26 ms), in the
opposite direction from what one might assume, because Blink's DOM is heavily optimised while jsdom
is a JavaScript implementation. **Never quote a jsdom millisecond as a user-facing latency.**

The Chromium spec asserts only the *shape* — that per-field cost does not blow up with size — and
prints the rest. A wall-clock threshold is a property of the runner, not of the engine, and one tuned
on this container would fail elsewhere for no useful reason.

## Not measured

- **AI path latency.** No provider is reachable. What *is* measured is how much work the router
  sends: 12 fields of 109 over 13 pages, in 9 batched requests rather than one per field, at 41.4%
  of the payload an always-ask strategy would send. See `research/routing/`.
- **Real-world page weight.** Generated forms carry no unrelated DOM. A real page of the same field
  count has far more of it, which affects detection (a document-wide query) more than matching
  (per-field work).
- **Extension service-worker memory.** `performance.memory` sees only the page.
- **Cold-start cost of the service worker**, which MV3 may terminate between uses. The 30-second
  first-use stall Phase 2 fixed lived in exactly this seam; it is now covered by a regression test
  but the worker's own wake latency is not separately profiled.
- **Variance across hardware.** One container, no CPU pinning. Standard deviations are reported for
  the jsdom runs; a difference smaller than the deviation is not a difference.

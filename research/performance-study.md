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
| 250 | 250 | 549 ms | 111 ms | **660 ms** | 2.20 ms | 4.4 MiB |

**Total preparation** is what the user waits for between opening FormPilot and seeing reviewable
suggestions: injection, detection, normalization, matching, suggestion building and rendering the
panel. It includes no model call — the AI path is separate and its latency is unmeasured here
because no provider is reachable.

Three readings:

- **Per-field cost falls as forms grow**, 8.80 ms to 2.20 ms. Injecting the engine is a fixed cost
  that amortises; on a 10-field form most of the 146 ms is setup, not work.
- **A 250-field form is ready in 0.66 s.** Real application forms are rarely larger.
- **Heap growth is sublinear** — 2.2 MiB at 10 fields to 4.4 MiB at 250, so 25× the fields costs 2×
  the memory. No leak signature. Measured with Chromium's non-standard `performance.memory`, which
  is coarse and quantised and covers the *page* heap only, not the extension's service worker. Treat
  it as a leak check, not a figure.

## jsdom — the scaling shape

500 fields are included here because jsdom can run them cheaply and the question is the curve's
shape, not a latency a user would experience. Five timed repeats per size after two discarded
warm-ups, mean ± sample standard deviation.

| Fields | (detect) | normalize | suggest | Total | Per field |
| --- | --- | --- | --- | --- | --- |
| 10 | 27.8 ± 3.5 | 35.1 ± 9.0 | 22.8 ± 1.6 | 57.9 ± 8.1 | 5.79 ms |
| 25 | 58.4 ± 15.4 | 75.9 ± 13.0 | 65.6 ± 20.3 | 141.5 ± 31.7 | 5.66 ms |
| 50 | 82.5 ± 5.2 | 93.5 ± 4.8 | 106.6 ± 8.3 | 200.2 ± 9.4 | 4.00 ms |
| 100 | 172.8 ± 6.9 | 197.9 ± 26.9 | 207.0 ± 9.2 | 404.8 ± 33.8 | 4.05 ms |
| 250 | 533.2 ± 23.8 | 543.1 ± 25.6 | 559.9 ± 15.8 | 1103.0 ± 25.9 | 4.41 ms |
| 500 | 1304.4 ± 34.8 | 1327.0 ± 40.3 | 1130.2 ± 42.7 | 2457.2 ± 79.2 | 4.91 ms |

`detect` is parenthesised because it is a **component of** `normalize`, not a separate stage:
`normalizeForm` calls `detectFields` internally, so the pipeline total is normalize + suggest.
Counting both would charge detection twice, which the first version of this harness did, overstating
the total by about a third. At 500 fields detection is 94% of normalize.

**Scaling: 50× the fields costs 42.5× the time.** Per-field cost moves 5.79 ms to 4.91 ms, so the
engine is linear in field count over this range, with no super-linear traversal.

## Synthetic versus real, stated plainly

| | jsdom | Chromium |
| --- | --- | --- |
| What it establishes | the shape of the curve | absolute latency a user experiences |
| Layout engine | none | real |
| Event ordering | approximate | real |
| Numbers transfer? | **no** | yes, for comparable hardware |

jsdom is roughly twice as slow per field as Chromium at 250 fields (4.41 ms against 2.20 ms), in the
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

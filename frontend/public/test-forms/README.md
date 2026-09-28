# FormPilot test-form corpus

Ten pages used three ways, from one source of truth:

1. **Manual browser testing** — served by the dashboard at `/test-forms/<file>`.
2. **Automated integration tests** — loaded into jsdom by `tests/integration/*.test.ts`.
3. **Research benchmark** — the input side of `research/benchmark`, paired with the
   hand-written ground truth in `research/benchmark/dataset/`.

| File | What it stresses |
|---|---|
| `basic-html.html` | `label[for]` + `autocomplete`; the detection baseline |
| `complex-html.html` | fieldsets, table layout, selects, radio/checkbox groups, file input, long-form question |
| `aria-widgets.html` | ARIA-only controls, `aria-labelledby`/`describedby`, contenteditable, custom listbox |
| `ambiguous-labels.html` | near-duplicate labels, placeholder-only and name-only fields |
| `dynamic-form.html` | conditional fields added/removed after load (MutationObserver) |
| `multi-step.html` | 5 steps, step indicators, hidden panels, session continuity |
| `shadow-dom.html` | open shadow roots incl. nesting; a closed root that must report as unreachable |
| `iframe-form.html` | same-origin frame (readable) and cross-origin frame (must be reported, not bypassed) |
| `google-forms-mock.html` | Google Forms DOM: short answer, paragraph, radio, checkbox, dropdown, date, time, linear scale, grid |
| `sensitive-fields.html` | passwords, OTP, card, government id, consent — every one must be refused |

The React and Next.js cases are app routes rather than static files, because a static
file cannot exercise React's controlled-input value tracking: see `/test-forms` in the
dashboard.

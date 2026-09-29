# Platform evaluation

What was tested against each hosted form platform, and why four of them cannot move past
**Experimental** from this environment.

| | |
| --- | --- |
| **Procedure** | `research/platform-probe/probe.sh`, then the integration and E2E suites |
| **Date** | 2026-09-29 |
| **Software version** | FormPilot 2.0.0, commit `6e01e8e` (frozen) |

## The blocking constraint, with evidence

Phase 3 was asked to validate against live platforms *if network access is available*. It is not.
Every hosted form platform is refused at the CONNECT stage by this container's network policy:

```
probe date: 2026-09-29T05:02:19Z
target                       http  verdict
docs.google.com                000  UNREACHABLE (curl exit 56)
forms.office.com               000  UNREACHABLE (curl exit 56)
form.typeform.com              000  UNREACHABLE (curl exit 56)
www.jotform.com                000  UNREACHABLE (curl exit 56)
www.surveymonkey.com           000  UNREACHABLE (curl exit 56)
registry.npmjs.org             200  reachable
raw.githubusercontent.com      301  reachable
```

The last two lines are controls: the network itself works, and the package registry and raw GitHub
content are reachable. The gateway reports `403 to CONNECT (policy denial)` for the platform hosts.
Re-run `./research/platform-probe/probe.sh` to check whether this has changed.

**This is a property of the environment, not of the code.** Every one of the five adapters is
implemented, typechecked and passing against a local reproduction of its platform's markup. What is
missing is the ability to point a browser at the real product.

## Status per platform

| Platform | Status | Tested against | Coverage | Why not Verified |
| --- | --- | --- | --- | --- |
| Generic HTML | **Verified** | real pages in Chromium | detection, normalization, matching, autofill, dynamic, multi-step, review | — |
| Google Forms | **Partial** | local reproduction, in Chromium | 15 integration tests over every v1 question type incl. grid flattening; 4 Chromium specs | `docs.google.com` unreachable |
| Microsoft Forms | **Experimental** | local reproduction, jsdom | detection, labels, required, types, options, matching, autofill | `forms.office.com` unreachable |
| Typeform | **Experimental** | local reproduction, jsdom | as above, plus one-question-per-screen advance | `form.typeform.com` unreachable |
| Jotform | **Experimental** | local reproduction, jsdom | as above, plus composite address/name/date sub-labels | `jotform.com` unreachable |
| SurveyMonkey | **Experimental** | local reproduction, jsdom | as above, plus matrix flattening; ranking questions refused | `surveymonkey.com` unreachable |

## What each platform's test actually covers

Per the eight dimensions Phase 3 asked for:

| Dimension | Generic | Google Forms | MS Forms | Typeform | Jotform | SurveyMonkey |
| --- | --- | --- | --- | --- | --- | --- |
| Form detection | Verified | Partial | Experimental | Experimental | Experimental | Experimental |
| Field detection | Verified | Partial | Experimental | Experimental | Experimental | Experimental |
| Normalization | Verified | Partial | Experimental | Experimental | Experimental | Experimental |
| Field matching | Verified | Partial | Experimental | Experimental | Experimental | Experimental |
| Autofill | Verified | Partial | Experimental | Experimental | Experimental | Experimental |
| Dynamic behaviour | Verified | Untested | Untested | Experimental | Untested | Untested |
| Multi-step behaviour | Verified | Untested | Untested | Experimental | Untested | Untested |
| Review workflow | Verified | Partial | Experimental | Experimental | Experimental | Experimental |

Dynamic and multi-step behaviour on the four experimental platforms is **Untested**, not
Experimental: no reproduction exercises a conditional branch or a step transition for them. Typeform
is the exception because its reproduction advances one question at a time, which is its native
behaviour.

## Google Forms is Partial, not Verified

It has the most coverage of any platform adapter — a 15-test regression suite over every v1 question
type, plus four Chromium specs covering adapter selection, ARIA-only questions with no native
`<input>`, the full pipeline through to a verified write, and a check that neither the submit control
(a clickable `div` in Google's markup) nor any consent choice is ever activated.

It remains **Partial** because all of that runs against `google-forms-mock.html`. A reproduction
tests the adapter's reading of a structure; it cannot tell you the live product still emits that
structure. Google Forms markup is generated and unversioned, and has changed before.

## Degradation is tested, not assumed

An adapter requires its platform's **markup**, not just a URL match. A Typeform URL serving plain
HTML falls through to `generic-html@1` with the warning *"its expected markup was not found, so
FormPilot is reading the page generically"*, and still fills correctly — asserted in
`tests/integration/platform-adapters.test.ts`.

This matters because the alternative failure mode is worse. A selector-composition bug in Phase 2
let the SurveyMonkey adapter claim any page containing a single `<fieldset>`; a plain React page came
back labelled as a Microsoft Forms reproduction. Adapter selection is now tested for both false
negatives and false positives.

## What would promote these rows

One thing: **an environment that can reach the five hosts.** Everything else is already in place —
adapters, reproductions, the E2E harness, the benchmark scoring and the compatibility matrix. On an
unrestricted network the work is to create a public test form on each platform, point the harness at
it, and record what happens. Either four rows move to Verified, or the reproductions turn out to be
wrong and the adapters get fixed. Both outcomes are worth more than anything else outstanding.

## Explicitly not claimed

- That FormPilot works on Google Forms, Microsoft Forms, Typeform, Jotform or SurveyMonkey today.
- That it supports every website. It supports the architectures listed in
  `compatibility-matrix.md` and falls back to a generic engine elsewhere, with results that depend
  on the page.
- Universal compatibility, full compatibility, or "works everywhere". None of those is supported by
  any evidence in this repository.

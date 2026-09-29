# Platform adapters

One adapter per platform over a single unified form schema. This directory documents what each one
does, what it was built against, and what is and is not known about it.

| Adapter | id | Status | Tested against | Live product |
| --- | --- | --- | --- | --- |
| Generic HTML | `generic-html@1` | **Verified** | real pages in Chromium | n/a |
| Google Forms | `google-forms@2` | **Partial** | local reproduction | `docs.google.com` unreachable |
| Microsoft Forms | `microsoft-forms@1-experimental` | **Experimental** | local reproduction | `forms.office.com` unreachable |
| Typeform | `typeform@1-experimental` | **Experimental** | local reproduction | `form.typeform.com` unreachable |
| Jotform | `jotform@1-experimental` | **Experimental** | local reproduction | `jotform.com` unreachable |
| SurveyMonkey | `surveymonkey@1-experimental` | **Experimental** | local reproduction | `surveymonkey.com` unreachable |

Reachability is re-checkable: `./research/platform-probe/probe.sh`. No adapter can be promoted past
Experimental from an environment that cannot reach its platform, however well it works against a
reproduction.

## What every adapter has

The checklist, per platform:

| | MS Forms | Typeform | Jotform | SurveyMonkey |
| --- | --- | --- | --- | --- |
| Adapter implementation | `microsoftForms.ts` | `typeform.ts` | `jotform.ts` | `surveyMonkey.ts` |
| Reproduction fixture | `microsoft-forms-mock.html` | `typeform-mock.html` | `jotform-mock.html` | `surveymonkey-mock.html` |
| Ground-truth data | `microsoft-forms.json` | `typeform-block1.json`, `typeform-block4.json` | `jotform.json` | `surveymonkey.json` |
| Unit tests | `tests/unit/adapter-selection.test.ts` | ✓ | ✓ | ✓ |
| Integration tests | `tests/integration/platform-adapters.test.ts` (35) | ✓ | ✓ | ✓ |
| E2E tests (Chromium) | `tests/e2e/specs/platform-adapters.spec.ts` | ✓ | ✓ | ✓ |
| Documentation | this directory | ✓ | ✓ | ✓ |

## How selection works, and why it is conservative

`selectAdapter` picks the highest-priority adapter whose `matches` returns true. The generic adapter
matches everything at priority 0, so selection never fails.

**An adapter requires its platform's markup, not just a URL that looks right.** A Typeform URL serving
plain HTML falls through to `generic-html@1` with the warning *"its expected markup was not found, so
FormPilot is reading the page generically"*, and still fills correctly.

That rule exists because the opposite failure is worse, and it happened: a selector-composition bug
once let the SurveyMonkey adapter claim any page containing a single `<fieldset>`, and a plain React
page came back labelled as a platform reproduction. `tests/e2e/specs/platform-adapters.spec.ts`
asserts the negative direction — a plain HTML page, a React app and a Vue app must all fall to the
generic engine with no warning.

`detectPlatform` is separate from adapter selection: it identifies the platform from the URL host or
from DOM fingerprints, and an adapter only acts if its own markup check also passes. Both have to
agree.

## Microsoft Forms

Markers: `[data-automation-id="questionItem"]`, `questionTitle`, `requiredMark`. Microsoft publishes
these as part of its accessibility contract, which is what makes them a reasonable thing to build on.

- `questionContainers` walks `questionItem` blocks.
- `containerLabel` reads `questionTitle` and strips the trailing required asterisk.
- `classify` returns `rating` when a `ratingOption` is present, so a star scale is not mistaken for a
  radio group.
- `options` resolves dropdown choices through `aria-owns` / `aria-controls`, because the list is not a
  child of the control.
- `refineField` sets `platformMeta.scale = 'stars'`.

Reproduction covers 10 fields: text, textarea, radio group, checkbox group, dropdown, date, and a
star rating.

## Typeform

Markers: `[data-qa="block-container"]`, `question-header`, `multiple-choice-option`, `rating-option`.

The distinctive problem is that Typeform's choices are `<button>` elements, not inputs, so the generic
control selector cannot see them. Rather than widening that selector to every button on the web, the
adapter uses the `extraControls` hook to nominate exactly the elements it knows are choices. That hook
was added for this case and is available to any adapter.

Typeform also shows one question per screen and advances on a button press, so:

- `matches` requires a block container *and* a question header.
- `options` returns answers only for the first choice group, so the group collapses into one field.
- `refineField` sets `platformMeta.oneQuestionPerScreen = 'true'`.

The E2E spec asserts that only the visible block is detected, that the engine re-detects after the
form advances, and that **filling never presses the advance button** — `OK` is a consequential action.

## Jotform

Markers: `li.form-line[data-type]`, `label.form-label`, `.form-sub-label`.

Jotform's characteristic feature is composite controls: one logical question spread across several
inputs, each with a sub-label. `control_address`, `control_fullname`, `control_datetime`,
`control_phone` and `control_birthdate` are all handled by resolving the sub-label through siblings
and the enclosing table cell, producing labels like `Address — City`.

**Composite fields land in the review band, by design.** `Name — First Name` matches
`person.first_name` at 0.86 and `Name — Last Name` at 0.84 — just under the 0.90 auto-accept
threshold — so they are shown with a value and require a click. Splitting a composite control is
inherently less certain than reading a plain label, and the confidence reflects that rather than
hiding it. The E2E spec accepts before filling for exactly this reason.

Reproduction covers 15 fields including the composite address table and a file upload.

## SurveyMonkey

Markers: `[data-testid^="question"]`, `.question-body`, `.survey-page-question` with
`[data-testid="question-title"]`, `.question-title-container`, `.qtitle` or `legend`.

Two structures need special handling:

- **Matrix questions** are a `<table>` where each row is its own question. The adapter flattens each
  row into one field, labelled `Rate your confidence: Frontend`, and prefers the **column header** for
  the option labels — without that the options read as the row label repeated.
- **Ranking questions** need dragging, which FormPilot does not do. The adapter detects them and
  refuses them explicitly (`sensitivity: 'sensitive'`, with a reason mentioning dragging) rather than
  half-filling them.

SurveyMonkey was the only platform detected by **URL alone** until an E2E test on a locally served
reproduction returned `generic-html`. The other three had DOM fingerprints and this one did not, so an
embed, an iframe or a custom survey domain went unrecognised. A composed fingerprint was added —
requiring a question-title marker *nested inside* a question container, because `.question-body` alone
is generic enough to appear on unrelated pages — at the lowest confidence of the four.

## What none of this establishes

- That any of these adapters works against its live product. No live platform is reachable.
- That the reproductions match what the platforms emit **today**. They were written from published
  markup contracts; Google Forms markup in particular is generated and unversioned.
- Dynamic or multi-step behaviour on Microsoft Forms, Jotform or SurveyMonkey. No reproduction
  exercises a conditional branch or a step transition for them, so those cells are **Untested** in
  `research/compatibility-matrix.md` rather than Experimental. Typeform is the exception, because
  one-question-per-screen is its native behaviour and the reproduction does it.

# Human evaluation

**No human study was conducted. No human participants were recruited. No human data exists in this
repository.**

This document exists to say that plainly, to record what would be needed, and to name the numbers
that are *not* proxies for it — because the most likely way this project gets misread is someone
citing a system metric as a human one.

| | |
| --- | --- |
| **Participants** | none |
| **Date** | — |
| **Procedure** | not run |
| **Result** | none |

## What Phase 3 asked for, and its status

| Requested measure | Status | Why |
| --- | --- | --- |
| Suggestion acceptance rate | **Not measured** | requires participants |
| Correction rate | **Not measured** | requires participants |
| Rejection rate | **Not measured** | requires participants |
| Manual completion time | **Not measured** | requires participants |
| Assisted completion time | **Not measured** | requires participants |
| User overrides | **Not measured** | requires participants |

Every one of these is a property of people, not of software. The environment this was built in has
no participants and no ethical-review route to recruit any, so the honest result is an empty table
rather than an estimate.

## What the system records, and why it is not a substitute

The session layer (`extension/src/core/session/`) records `accepted`, `rejected`, `edited`, `filled`
and `failed` per field, and `tests/unit/session.test.ts` verifies the bookkeeping. That machinery is
in place so a future study has somewhere to write, and it has never been driven by a person.

The benchmark reports a **review burden** breakdown — on 120 fields: 62 ready, 39 needing review, 9
manual, 10 blocked. It is tempting to read "51.7% ready" as an acceptance rate. **It is not.** It
describes how much work the system creates for a reviewer. It says nothing about whether a reviewer
accepts, edits or rejects any of it. The distinction is the whole difference between a systems metric
and a human one.

Likewise, the assisted-vs-manual comparison the phase asks for cannot be derived from the latency
figures in `performance-study.md`. Those measure how long FormPilot takes to *prepare* suggestions
(146 ms at 10 fields, 660 ms at 250). A human's completion time is dominated by reading, deciding and
typing, none of which is measured anywhere in this repository.

## The design that would produce these numbers

Recorded so the work is specified rather than gestured at.

**Participants.** 20–30 people who routinely complete application forms, recruited through a channel
that does not pre-select for interest in automation. Power analysis before recruitment, not after.

**Design.** Within-subject, counterbalanced. Each participant completes four forms of comparable
length and complexity, two unassisted and two with FormPilot, with the order rotated so learning and
fatigue do not load onto one condition. Forms drawn from the corpus in `test-dataset.md` so the
ground truth is already known.

**Measures.** Time to completion per form; per-field accept / edit / reject, from the session log;
edit distance between the suggestion and what was submitted; errors in the submitted form against
ground truth; a short post-task instrument for trust and perceived control.

**Consent and data handling.** Written informed consent before any task, covering what is recorded
and how it is stored. Participants use a **synthetic profile supplied by the study**, never their own
data — which removes the need to collect anything personal at all, and is the reason no
anonymisation pipeline is required rather than a claim that one exists. Session logs keyed by a
random participant id held separately from any identifying record; logs retained only until analysis
completes; withdrawal honoured by deleting the participant's rows.

**Analysis declared in advance.** Primary outcome: completion time, paired test. Secondary: accept
rate, error rate in submitted forms. Pre-registered, so the analysis cannot be chosen after seeing
the data — the same discipline the held-out evaluation applies to the matching configuration.

## Threats this study would have to face

- **Novelty and demand effects.** Participants know which condition is the tool being studied.
- **Synthetic profile, synthetic stakes.** Nobody is filling in a real job application, so the care
  they take is not the care they would take.
- **Acceptance is not correctness.** A participant accepting a wrong suggestion looks like success in
  the accept-rate column and is a failure. The submitted-form error rate is the measure that catches
  it, which is why it is a primary outcome rather than an afterthought.

## The instruments now exist, in `research/human-study/`

This document records that nothing was measured. `research/human-study/` records what measuring it
would take, as seven files that have never been used on anybody:

| File | What it is |
| --- | --- |
| `README.md` | what must be true before any of it runs |
| `protocol.md` | design, sample size, procedure, ethics, what would invalidate a run |
| `tasks.md` | the forms, the supplied synthetic profile, and the ground truth |
| `consent.md` | information sheet and consent form, for IRB review |
| `questionnaire.md` | pre-task, per-task and post-task instruments |
| `data-schema.md` | exactly what is recorded, and what must never be |
| `analysis-plan.md` | a pre-registration: measures, tests and stopping rules fixed in advance |

They are instruments, not results. Every one of them carries a **NOT YET COLLECTED** banner, and
`data-schema.md` §5 forbids committing participant data to this repository at all — including a single
anonymised row, because a repository with one real record in it is a repository that needs protecting.

Two things in there are worth naming here, because they are the parts that keep a future study honest
rather than flattering:

- **The silent-error rate** (`data-schema.md` §3): fields where the tool offered a wrong value,
  pre-accepted it, and the participant did not intervene — a wrong answer neither party decided on. It
  is the one measure that can show assistance being *worse*, and `analysis-plan.md` §3 designates it
  before anyone knows what it would say.
- **The underpowered admission** (`analysis-plan.md` §5): n = 24 is sized for completion time and is
  explicitly *not* enough to say anything precise about rare errors. The plan says so in advance, so
  that a wide interval is reported as a wide interval rather than as "no difference".

## Claim discipline

Nothing anywhere in this repository may be described as a human-evaluation result, an acceptance
rate, a correction rate or a time saving. No such measurement exists. Where a document needs to
describe reviewer workload it says "review burden" and states that it is a property of the system.

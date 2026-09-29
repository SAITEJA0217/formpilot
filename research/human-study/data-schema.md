# Data schema

> **NOT YET COLLECTED.** No file of this shape exists. The schema below describes what *would* be
> recorded; the directory it describes is empty.

One JSON file per participant, named by participant code, written at the end of the session.

## 1. Shape

```jsonc
{
  "schemaVersion": 1,
  "participant": "P07",              // code only; never a name
  "build": "f2b9373",                // the commit under test, fixed for the whole run
  "startedAt": "2026-10-14T09:12:00Z",
  "conditionOrder": ["manual", "assisted", "assisted", "manual"],
  "settings": { "allowAI": false, "allowCorrectionLearning": false },

  "preTask": { "1.1": "3-5", "1.2": 5, "1.3": 2, "1.4": "no", "1.5": 6 },

  "forms": [
    {
      "taskId": "T1",
      "condition": "manual",
      "startedAt": "2026-10-14T09:20:11Z",
      "submittedAt": "2026-10-14T09:26:48Z",
      "durationMs": 397000,
      "abandoned": false,
      "fields": [
        {
          "fieldLabel": "Full Name",
          "groundTruth": "EXPECT:Priya Anand Raghavan",
          "finalValue": "Priya Anand Raghavan",
          "correct": true,

          // Assisted condition only; null in manual.
          "suggestionOffered": true,
          "suggestedValue": "Priya Anand Raghavan",
          "suggestionConfidence": 0.97,
          "suggestionStatus": "ready",
          "preAccepted": true,
          "userAction": "accepted",   // accepted | edited | rejected | ignored
          "editedFrom": null,
          "msToDecide": 1400
        }
      ],
      "perForm": { "2.1": 6, "2.2": 3, "2.3": 6, "2.4": 5, "2.5": 6 }
    }
  ],

  "postTask": { "3.1": 6, "3.2": 5, "3.3": 6, "3.4": 2, "3.5": "yes",
                "3.6": "…", "3.7": "…", "3.8": "…" },

  "incidents": [
    { "at": "2026-10-14T09:31:02Z", "kind": "facilitator_intervention",
      "taskId": "T2", "note": "participant asked how to reject; form excluded" }
  ],
  "redactions": 0                    // count only; never the redacted content
}
```

## 2. Definitions that decide the result

These are the places where a loose definition would let the analysis drift, so they are fixed here.

**`durationMs`** — from the first keystroke or click *inside the form* to pressing submit. Not from
when the page loaded: reading time before starting is not work the tool can affect, and including it
would shrink any difference between conditions by adding a constant to both.

In the assisted condition, opening the panel and reviewing is **inside** this window. It is work the
user does, and excluding it would be measuring a tool that fills forms rather than one that asks for
review.

**`userAction`** — exactly one per field, and the four are exhaustive:

| | |
| --- | --- |
| `accepted` | took the suggestion unchanged |
| `edited` | changed the value and kept it |
| `rejected` | pressed Reject, or cleared the field after a suggestion was applied |
| `ignored` | a suggestion was offered, not pre-accepted, and never acted on; the field was submitted empty or typed from scratch |

`ignored` is separated from `rejected` deliberately. Rejecting is a judgement; ignoring may mean the
participant never saw the card. Folding them together would report the second as the first and
overstate how deliberate the tool's rejections are.

**`correct`** — the scoring script's verdict against `groundTruth` (`tasks.md`). Whitespace and case are
normalised and dates are parsed, so "3/2/1996" matches a date of birth. The script is not given the
`condition` field.

**`preAccepted`** — whether the suggestion arrived already accepted, before the participant touched
anything. Recorded separately from `userAction` because "accepted" covers both a deliberate click and
a pre-accepted card left alone, and those are different behaviours. Without this field, the headline
acceptance rate would silently include suggestions nobody looked at.

**`abandoned`** — the participant gave up. The form is excluded from the time comparison and kept in
the correctness comparison, since giving up is itself an outcome.

## 3. Derived measures

Computed by the analysis script, never stored in the participant file, so that re-running the analysis
cannot drift from the raw record.

| Measure | Definition |
| --- | --- |
| acceptance rate | `accepted / (accepted + edited + rejected + ignored)` |
| deliberate acceptance rate | `accepted` where `preAccepted == false`, over the same denominator |
| correction rate | `edited / (suggestions offered)` |
| rejection rate | `rejected / (suggestions offered)` |
| incorrect-submission rate | `correct == false` over all scoreable fields |
| **silent-error rate** | `correct == false && preAccepted && userAction == "accepted"` over all scoreable fields |
| safety failure | any `MUST_NOT_BE_SET` field ending set, where the participant did not set it |

**The silent-error rate is the number this study exists to produce.** It counts fields where the tool
offered a wrong value, pre-accepted it, and the participant did not intervene — a wrong answer
submitted that neither party decided on. It is the only measure here that can show the assisted
condition being *worse*, and it is reported whatever it says.

## 4. What is never recorded

- **No name, email, address or phone of the participant.** They use the supplied profile; anything
  resembling their own data is redacted at ingestion and only the count survives (`redactions`).
- **No screen, audio or video.** Not needed for any measure above.
- **No keystroke stream.** `durationMs` and `msToDecide` are enough; a keystroke log would be a
  detailed record of a person's behaviour collected for no stated purpose.
- **No code-to-name mapping after collection ends.** The sheet is destroyed and the results are not
  re-identifiable, which is also what makes the withdrawal deadline in `consent.md` real rather than
  rhetorical.
- **Nothing from the AI path.** It is off for the whole study (`protocol.md` §6), so there is nothing
  to record and the results say the model path was not exercised.

## 5. Storage

Files live outside this repository. **No participant data is ever committed here**, including a sample
or a single anonymised row — a repository with one real record in it is a repository that needs
protecting. When results are published, this directory gains a `results/` folder containing aggregates
and the analysis script's output, and nothing at the level of an individual.

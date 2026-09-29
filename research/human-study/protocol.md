# Protocol

> **NOT YET COLLECTED.** No participants have been recruited and this protocol has not been run.
> Nothing below is a result.

## 1. Question

Does human-reviewed form assistance reduce the effort of completing a web form without increasing the
rate of wrong information being submitted?

Two halves, and the second is the one that matters. A tool that halves completion time while raising
the rate of wrong answers has made things worse, and a study that measures only time would report it
as a success. Both are primary outcomes; neither is allowed to stand alone.

## 2. Design

**Within-participant, counterbalanced.** Each participant completes forms both manually and with
assistance. Within-participant because the variance between people — typing speed, familiarity with
application forms, patience — is larger than the effect being measured, and a between-groups design at
any sample size this study can reach would be swamped by it.

The cost is order effects: the second time someone meets a form they are faster regardless of
condition. Handled by counterbalancing — each participant does half the forms in each condition, and
which forms fall in which condition alternates across participants — and by using forms of matched
length rather than the same form twice.

**Conditions**

| | |
| --- | --- |
| **A — Manual** | The participant fills the form themselves. The extension is not installed. |
| **B — Assisted** | The extension is installed, with the review panel. The participant accepts, edits or rejects each suggestion. |

There is no third "automatic" condition, because the product has no automatic mode: nothing is
written without a click, and a condition that bypassed review would be measuring software that does
not exist.

## 3. Participants

**Target n = 24.** See `analysis-plan.md` §5 for where that comes from; in short it is what a
within-participant design needs to detect a medium effect on completion time at 80% power, and it is
explicitly **not** enough to say anything precise about rare events such as a wrong value being
submitted. That limitation is stated in the results, not discovered in them.

**Inclusion.** Adults who have completed at least one online application form (job, university,
visa, or similar) in the previous year. That last clause matters: the forms in `tasks.md` are
application forms, and someone who has never met one is learning the genre and the tool at once.

**Exclusion.** Anyone who has worked on FormPilot, read its source, or seen its review panel before.
The author of this repository is excluded from participating in a study of it.

**Recruitment.** No channel is specified here, because the available channel decides the sample's
shape and that has to be reported rather than assumed. Whatever is used is named in the results
alongside its likely bias — a developer mailing list and a general-population panel produce different
studies, and the difference is not a detail.

## 4. Procedure

Per participant, roughly 50 minutes.

1. **Consent** (5 min). `consent.md`. The participant keeps a copy and can stop at any point.
2. **Briefing** (5 min). They are given a **synthetic profile** on paper and told to complete the
   forms as that person. They are told explicitly that the assistance can be wrong and that they
   should treat its suggestions as suggestions.
3. **Pre-task questionnaire** (3 min). `questionnaire.md` §1.
4. **Practice form** (5 min). One short form in each condition, not analysed. Without it, condition B
   also measures first contact with an unfamiliar panel.
5. **Four task forms** (25 min). Two per condition, order counterbalanced. Between each,
   `questionnaire.md` §2.
6. **Post-task questionnaire** (5 min). `questionnaire.md` §3, including the open question, which is
   the part most likely to say something the fixed measures cannot.

The facilitator does not answer questions about how to use the panel during a task. A tool that needs
a facilitator beside it has not been tested.

## 5. What is recorded

`data-schema.md` is authoritative. In summary: per form, the wall-clock time to submit; per field, the
final value, whether a suggestion was offered, and whether it was accepted, edited or rejected; per
form, whether the submitted value matched the supplied profile.

**Field-level correctness is scored against the supplied profile, not against the participant's
judgement.** A participant who accepts a wrong suggestion has produced a wrong answer even if they
were satisfied with it, and that is the number the second primary outcome depends on.

## 6. Keeping real data out

Participants are given a synthetic profile and asked not to enter their own details. This is not
tidiness: a study that collects real names, addresses and employment histories has created a data set
that has to be protected for as long as it exists, and this study has no need of one.

Three safeguards:

- The forms in `tasks.md` are **local**. Nothing is submitted to any third party — the submit handler
  records the attempt and stops, as the E2E fixtures do.
- The extension is configured with `allowAI: false` and `allowCorrectionLearning: false`, so no
  request leaves the machine during a session. This is stated in the results, because it means the
  study measures the deterministic path only and says nothing about the model path.
- Any field that nonetheless contains something resembling real personal data is redacted at
  ingestion, before analysis, and the redaction is logged as a count.

## 7. What would invalidate a run

Recorded here so that it is a decision made in advance rather than an argument made afterwards.

- **A build change mid-study.** The commit under test is fixed at the start. If a bug forces a change,
  the run restarts; data from the two builds is not pooled.
- **Facilitator intervention during a task.** That participant's affected form is excluded.
- **A participant entering real personal data despite the briefing.** Their data is destroyed, not
  redacted, and they are replaced.
- **Fewer than 20 participants completing all four forms.** The completion-time comparison is reported
  as underpowered rather than as a null result. The two are not the same claim.

## 8. Ethics

Requires approval from an IRB or equivalent before recruitment. The submission covers: the synthetic
profile, the local-only forms, the right to withdraw without giving a reason, what is stored and for
how long, and the fact that the study is of a tool the investigator wrote — which is a conflict of
interest that belongs in the disclosure, not in a footnote.

No deception. Participants are told at briefing that the assistance is sometimes wrong, because
withholding that would make the study a test of misplaced trust rather than of the tool.

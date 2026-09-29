# Questionnaires

> **NOT YET COLLECTED.** No participant has answered any of these items. Every table below is an
> instrument with no responses.

Three instruments: once before the tasks, once after each form, once at the end. Scales are 7-point
unless stated. Every scale item records the number; free text is stored verbatim under the participant
code.

## 1. Pre-task

Asked before the briefing, so that nothing here is coloured by having used the tool.

| # | Item | Response |
| --- | --- | --- |
| 1.1 | How many online application forms have you completed in the last 12 months? | 0 / 1–2 / 3–5 / 6–10 / more than 10 |
| 1.2 | How often do you use your browser's built-in autofill? | never … always (7) |
| 1.3 | When a browser fills a field for you, how often do you check what it put there? | never … always (7) |
| 1.4 | Have you used a browser extension that fills forms for you? | yes / no / not sure |
| 1.5 | Filling in long forms is tedious for me. | strongly disagree … strongly agree (7) |

1.3 is here as a covariate rather than a finding. Someone who never checks autofill is a different
participant from someone who checks every field, and in the assisted condition that difference will
show up as both a time difference and a correctness difference. Reporting the correctness result
without it would hide the mechanism.

## 2. Per form

Asked immediately after each of the four task forms, before moving on. Kept to five items because a
long instrument between tasks becomes part of the task.

| # | Item | Response |
| --- | --- | --- |
| 2.1 | That form was easy to complete. | strongly disagree … strongly agree (7) |
| 2.2 | How much mental effort did that take? | very low … very high (7) |
| 2.3 | I am confident everything I submitted was correct. | strongly disagree … strongly agree (7) |
| 2.4 | *(assisted only)* The suggestions were accurate. | strongly disagree … strongly agree (7) |
| 2.5 | *(assisted only)* I could tell where each suggestion came from. | strongly disagree … strongly agree (7) |

2.3 is asked in both conditions and is the one to watch. **Confidence is not correctness**, and the
comparison that matters is between 2.3 and what the scoring script found. A condition where
participants are more confident and less correct is the worst outcome this study could produce, and it
would be invisible to any instrument that asked only how they felt.

2.5 is about the provenance line on each card. It is the only item that tests an interface claim the
project makes in its own documentation — that a suggestion says where it came from.

## 3. Post-task

| # | Item | Response |
| --- | --- | --- |
| 3.1 | I would use this tool for a real application. | strongly disagree … strongly agree (7) |
| 3.2 | I trusted the suggestions. | strongly disagree … strongly agree (7) |
| 3.3 | I felt in control of what was entered. | strongly disagree … strongly agree (7) |
| 3.4 | Reviewing the suggestions was more work than typing the answers. | strongly disagree … strongly agree (7) |
| 3.5 | Did you notice the tool declining to fill anything? | yes / no / not sure |
| 3.6 | *(if yes to 3.5)* What did it decline, and what did you think of that? | free text |
| 3.7 | Was there a point where a suggestion was wrong? What happened? | free text |
| 3.8 | Anything else? | free text |

3.4 is phrased against the tool on purpose. A questionnaire whose items all lean one way collects
agreement rather than opinion, and this is the item most likely to surface a real cost.

3.5 and 3.6 are the safety items. The tool refuses consent controls, payment fields and signatures, and
whether a participant *noticed* is a genuine question: a refusal nobody sees is not the reassurance the
design assumes it is. 3.6 asks what they thought of it, because a refusal that reads as a malfunction
is a different outcome from one that reads as care.

## What is not asked

- **No System Usability Scale.** It would produce a number comparable to published SUS scores, and
  that comparability is the problem: a SUS score from 24 people on four synthetic forms invites
  comparison with studies it has nothing in common with.
- **No net-promoter-style item.** Not a research measure.
- **Nothing about the participant beyond 1.1–1.5.** Age, occupation and technical background would all
  be interesting covariates and none of them is needed to answer the question in `protocol.md` §1.
  Collecting personal data because it might be interesting is how a study acquires data it then has to
  protect.

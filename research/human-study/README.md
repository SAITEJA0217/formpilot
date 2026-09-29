# Human study — instruments only

> ## NOT YET COLLECTED
>
> **No human study has been conducted. No participants have been recruited. No human data exists in
> this repository or anywhere else in this project.**
>
> Every file in this directory is an *instrument*: a protocol to run, tasks to give, a consent form
> to sign, a questionnaire to answer, a schema to store answers in, and a plan for analysing them.
> None of them has been used. There are no results here, and nothing in this directory may be cited
> as a finding.

## Why these exist before the study does

Writing the analysis plan after seeing the data is how a study talks itself into a result. The
measures, the exclusion rules and the comparisons are fixed here, in advance, so that when a study is
run its outcome is not a matter of choosing which cut to report. `analysis-plan.md` is the file that
does most of that work.

They also make the gap concrete. `research/human-evaluation.md` records that acceptance rate,
correction rate, rejection rate and completion time are all unmeasured; this directory is what
measuring them would actually take, which is a more useful statement than "future work".

## The files

| File | What it is |
| --- | --- |
| `protocol.md` | design, recruitment, sample size, procedure, ethics, what would invalidate a run |
| `tasks.md` | the forms participants fill, and the ground truth for each |
| `consent.md` | the information sheet and consent form |
| `questionnaire.md` | pre-task, per-task and post-task instruments |
| `data-schema.md` | exactly what is recorded, and what must never be |
| `analysis-plan.md` | pre-registered measures, tests, and stopping rules |

## What must be true before any of this runs

1. **Ethical review.** An IRB or equivalent has approved the protocol. Not a formality: participants
   fill forms with personal data, and §6 of `protocol.md` is about keeping real data out.
2. **A profile that is not a real person's.** Participants use a supplied synthetic profile, not
   their own details. `data-schema.md` §4 says why.
3. **A pre-registration.** `analysis-plan.md` is committed and timestamped before the first
   participant, and any later change is recorded as a deviation rather than an edit.
4. **A recorded build.** The exact commit under test, named in the results, because a study of one
   build says nothing about another.

Until all four hold, this directory stays what it is: instruments, and an honest empty result.

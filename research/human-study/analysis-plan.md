# Analysis plan

> **NOT YET COLLECTED.** No data exists, so none of this has been run. There are no results.
>
> This file is a **pre-registration**. It must be committed and timestamped before the first
> participant. Any change after that point is recorded below as a dated deviation, not edited in.

## 1. Why this is written first

An analysis chosen after seeing data is not a test. With four forms, two conditions, three
questionnaires and seven derived measures, the number of defensible-looking cuts is large enough that
something will reach p < 0.05 by chance, and whichever one does will feel like the finding. Fixing the
comparisons in advance is what makes a result mean anything.

It also fixes the unwelcome ones. §3's silent-error rate is the measure most likely to make the tool
look bad, and it is designated primary here, before anyone knows what it says.

## 2. Primary outcomes

Two. Both reported, always, together.

**P1 — Completion time.** Median `durationMs` per form, assisted against manual.
*Test:* Wilcoxon signed-rank on per-participant medians, paired by participant. Non-parametric because
completion times are right-skewed — one participant reading every field carefully produces an outlier
that a t-test would let dominate.
*Effect size:* matched-pairs rank-biserial correlation, with a 95% bootstrap CI (10,000 resamples).
*Direction:* two-sided. Assistance could plausibly be slower, since reviewing takes time.

**P2 — Incorrect-submission rate.** Proportion of scoreable fields where `correct == false`, assisted
against manual.
*Test:* mixed-effects logistic regression, correctness as outcome, condition as fixed effect, random
intercepts for participant and for form.
*Effect size:* odds ratio with a 95% profile-likelihood CI.
*Direction:* two-sided, and the interesting direction is upward. **A faster condition that submits more
wrong answers is a worse condition**, and P1 is not reported without P2 beside it.

**Neither is reported alone, in an abstract, or in a README.** That is the single most likely way this
gets misused.

## 3. Secondary outcomes

Pre-specified, reported as estimates with CIs and no hypothesis test. With n = 24 these are
descriptive, and calling them tested would overstate them.

| | Measure | Reported as |
| --- | --- | --- |
| S1 | acceptance rate, and deliberate acceptance rate | proportion, Wilson 95% CI |
| S2 | correction rate | proportion, Wilson 95% CI |
| S3 | rejection rate, and ignored rate, separately | proportions, Wilson 95% CI |
| S4 | **silent-error rate** | proportion, Wilson 95% CI |
| S5 | safety failures | **count, never a rate** |
| S6 | perceived effort (2.2) and confidence (2.3) by condition | median, IQR |
| S7 | confidence (2.3) against measured correctness | scatter, Spearman ρ |

Wilson intervals throughout, not the normal approximation: several of these will sit near 0 or 1, where
a normal interval produces bounds outside [0, 1].

**S4 carries the same weight as a primary outcome in the write-up** even though it is not powered as
one. It is the case where the tool offered a wrong value, pre-accepted it, and nobody intervened — a
wrong answer neither party decided on. It is reported whatever it says, and if it is zero, the report
says zero *out of how many fields*, because "no silent errors in 2,000 fields" and "no silent errors in
40" are different statements.

**S5 is a count.** Any `MUST_NOT_BE_SET` field — a consent checkbox, a declaration, a typed signature —
ending up set when the participant did not set it is reported as an individual incident with its form
and field. A rate would average a safety failure against successes; there is no acceptable rate, so
there is no rate.

**S7 is the trust calibration check.** If confidence rises while correctness falls, the tool is
producing misplaced confidence, and that is a finding about the interface regardless of what P1 says.

## 4. Exclusions

Decided now, applied before any outcome is computed.

1. Practice form P0: always excluded.
2. A form where the facilitator intervened (`incidents`): excluded from that form's measures only.
3. An abandoned form: excluded from P1, **kept** in P2 — giving up is an outcome, not missing data.
4. A participant who entered real personal data: all their data destroyed, participant replaced
   (`protocol.md` §7).
5. No exclusion of outliers on time. A slow participant is a participant.

No other exclusions. If the data suggests one, it is reported as a deviation in §7 with its effect on
the result stated both ways.

## 5. Sample size

n = 24, from a power calculation for P1: paired Wilcoxon, α = 0.05 two-sided, 80% power, to detect
d ≈ 0.6 — around a 20% median time difference at the variance seen in comparable form-filling
studies. 21 participants suffices; 24 allows for three unusable sessions.

**This is not enough for P2 or S4, and the report must say so.** Detecting a change in a rare event
needs far more observations than a shift in a continuous one. If the observed incorrect-submission rate
is near the ~0.9% the held-out evaluation measures
(`research/heldout-v2/results/latest.md`), 24 participants × ~76 scoreable fields ≈ 1,800 fields yields
a handful of errors, and a CI wide enough to include both "no difference" and "materially worse". The
honest report of P2 at this n is an estimate with a wide interval, not a conclusion — and
**"not significant" is never written as "no difference"**.

## 6. Stopping

Fixed n. No interim analysis, no stopping early for a result, no adding participants after looking.
Collection ends at 24 completed sessions, or at a pre-set calendar date with the achieved n reported as
achieved.

## 7. Deviations

Any departure from this plan is added here with a date and a reason, and the affected result is
reported both as planned and as changed.

*(none — the study has not been run)*

## 8. What the results may not claim

Written now, because these are the sentences that get written at the end.

- Not **"users prefer FormPilot"** — the study measures four forms in one sitting, not preference over
  time.
- Not **"FormPilot is accurate"** — accuracy is measured in `research/heldout-v2/`, on form markup. A
  human study measures what people do with suggestions.
- Not **"FormPilot is safe"** — S5 counts failures in a handful of controls across 24 people. Zero
  failures there is not a safety guarantee, and the safety claims live in
  `research/security-audit.md` with the corpus behind them.
- Not a **generalisation beyond the sample**. Whatever recruitment produced is named with its likely
  bias (`protocol.md` §3).
- Not a **statement about the model path**. It is off throughout (`protocol.md` §6).
- Not a **comparison to any other product**. None was tested.

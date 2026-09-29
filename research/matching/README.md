# Semantic matching study

`npm run study:matching` scores the deterministic matcher against a hand-labelled dataset
(`labels.json`), sweeps the commitment threshold, and ablates the matcher against four
simpler baselines and two of its own components.

Results land in `results/latest.json` and `results/latest.md`, regenerated on every run.

## Read this before quoting the headline number

**The current 100% is a post-hoc result, not a held-out one.** The sequence matters:

1. The dataset was written first, from what real application forms ask, and committed before
   the harness was run. It was not derived from the ontology's alias lists.
2. The first run scored **65/69**. Four cases failed.
3. Three of those four were genuine defects, and they were fixed. One was a bug in the
   harness, and that was fixed too.
4. The run now scores 69/69.

Because the fixes were made in response to these specific cases, this dataset no longer
measures generalisation. It is a **regression suite** with a research harness attached. Each
of the four failures is additionally pinned as a unit test in
`tests/unit/context-dependent-aliases.test.ts`, which is the honest home for them.

A number that would mean something is a score on labels written by someone else, after the
fixes. That has not been done, and nothing here should be read as if it had.

## What the first run found

| Case | First run | Diagnosis | Fix |
| --- | --- | --- | --- |
| `Company`, `Company Name` | `experience.company` at 0.970 — filled without review | `company` is a legitimate alias of the applicant's employer, but as a *whole label* it can equally mean the company being applied to. Nothing in the scorer expressed "right guess, uncertain". | Added `contextDependentAliases` to `ConceptDef`. When the whole label is one of them and no `contextBoost` cue corroborates it, the score is capped at 0.85 — inside the review band, below auto-accept. `Current Company` and `Employer` are excluded, because they say whose company it is, and still score 0.970. |
| `Notice Period` | `experience.duration` at 0.720 | `period` was an alias of employment duration. A notice period is a different thing, and the profile holds no value for it. | Negatives on `experience.duration`: `notice period`, `notice`, `probation period`, `grace period`, `cooling period`. Now 0.108, below the commitment floor. |
| `Reason for leaving` | `freeform.motivation` at 0.583 | Heavy token overlap with `reason for applying`, but it asks the opposite question. Generating an answer would put words in the user's mouth about a former employer. | Negatives on `freeform.motivation`: `reason for leaving`, `reason for resignation`, `why are you leaving`. Now 0.088. |
| — | — | Fixing the one above exposed a worse one underneath: `Why are you leaving your current role?` then matched **`experience.job_title` at 0.930**, because the label contains `current role`. FormPilot would have written "Software Engineer" into a textarea asking for an explanation, at auto-accept confidence. | Added a prose-question gate. A label opening with `why`, `describe`, `explain`, `tell us`, `elaborate`, `discuss`, `what makes/motivates` or `how do/did/would you` is asking for prose, so a non-generative concept is penalised by 0.25. The question *word* is the discriminator, not the question mark: "What is your job title?" still resolves normally. |

The harness bug: `review` cases were scored as if they were `decline` cases, so naming the
likely concept at medium confidence — the ideal outcome — counted as an error. The dataset
had always said "must not answer this *confidently*"; the scorer was reading it as "must not
answer this at all". Fixed by splitting expectations three ways: `resolve`, `review`,
`decline`.

There was also a metric bug worth recording, because it produced a misleading ranking rather
than a wrong total. Macro-F1 was averaged over whichever concepts each strategy happened to
touch, which gives a strategy that answers less a smaller and easier denominator. It ranked a
plain substring baseline **above** the full matcher. Macro is now averaged over a fixed gold
concept set, identical for every strategy.

## Dataset

69 cases, each a field as a real form would present it, in three kinds:

- **56 must resolve** — one concept is correct and must be named.
- **3 must be offered for review** — a concept is probably right, but a human could not be
  certain from the label alone. Naming it below the auto-accept band, or declining, both
  pass; naming it confidently fails.
- **10 must be declined** — no concept is correct. Three of these (`Notice Period`,
  `Expected CTC`, `Current CTC`) are fields the ontology deliberately does not model.

`autocomplete` is set on 18 cases — only where a well-built real form would plausibly set it.
Its absence elsewhere is deliberate: most real forms omit the attribute, and the
autocomplete-only baseline exists to quantify what that omission costs.

## Limits

- **69 cases is small.** A one- or two-case difference is not a meaningful difference. Counts
  are printed next to every rate so support is always visible.
- **The labels are one person's judgement** about what each field means. Where a human could
  not resolve it either, the case is marked `ambiguous` and scored on restraint.
- **No model is called.** This measures the deterministic matcher, which is the part that
  decides whether a model is needed at all.
- **The baselines are re-implementations** written for this harness, not published systems.
  They show what the ontology and the multi-signal scorer add over the obvious simpler
  strategies. They are not a comparison against prior work.
- **The ambiguity guard contributes nothing on this dataset.** `no ambiguity guard` scores
  identically to the full matcher. That is a real negative result: the margin-based guard
  fires only when two candidates are close, and a confidently-wrong alias is not close to
  anything. The per-alias declaration is what handles that case. The guard still earns its
  place elsewhere — `Employee ID` produces four candidates within 0.013 — but it did not help
  here, and the ablation says so rather than implying otherwise.

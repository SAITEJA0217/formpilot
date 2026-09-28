# Methodology — how a field is understood

## 1. The problem

Given an arbitrary web page and a structured user profile, decide for every fillable control:
what does this field want, what value from the profile answers it, how confident is that, and
who should make the final call. The answer must be auditable: a scalar confidence with no
evidence behind it cannot be reviewed by a human or debugged by an author.

## 2. Normalization, in two explicit levels

Mixing normalization levels is the classic source of silent matcher bugs, so the two levels
are separate named functions (`shared/matching/normalize.ts`).

**Level 1 — `normalizeText`.** Every word retained. Diacritics folded, case lowered,
`camelCase`/`snake_case`/`kebab-case` split, punctuation to whitespace, abbreviations expanded
at token level (`fname`→`first name`, `dob`→`date of birth`, `zip`→`postal code`, …).
Ontology aliases and regex patterns are written against this level, so `date of birth` still
contains `of`.

**Level 2 — `tokenize`/`tokenSet`.** Level 1 minus stopwords (`your`, `please`, `enter`, `the`,
…). Similarity metrics use this level, so `Please enter your first name` and `First Name`
compare as identical.

Two decisions worth recording because they are non-obvious:

* A bare `no` expands to `number` only after a numeric context word (`contact`, `roll`, `reg`,
  …), so `Contact No` becomes `contact number` while `Answer no` stays `no`.
* `tech` is deliberately **not** expanded. It means "technical" in `tech skills` but
  "technology" in `B.Tech`; expanding it turned `B.Tech` into `b technical` and broke degree
  matching against a `Bachelor's Degree` option. The ontology carries `tech skills` and
  `tech stack` as explicit aliases instead. This was found by a failing test, not by review.

## 3. The ontology

`shared/ontology/concepts.ts` is a table of canonical concepts — `person.first_name`,
`education.graduation_year`, `documents.resume`, `consent.agreement` — each with a label, a
human-readable provenance path, a value type, a resolver key, normalized aliases, regex
patterns, optional compatible field types, optional `autocomplete` tokens, optional context
cues, optional disqualifying phrases, and an autofill policy (`allow` / `confirm` / `never`).

The indirection matters: a field is matched to a *concept*, and the resolver then fetches a
value for that concept. One matcher therefore serves any profile shape, and a paper can report
per-concept accuracy rather than per-site anecdotes.

## 4. Multi-signal scoring

For each (field, concept) pair, evidence is drawn from six text *sources*, each with a trust
factor, and matched by five *signals*, each with a weight:

| Source | Factor | | Signal | Weight |
|---|---|---|---|---|
| label | 1.00 | | `autocomplete` attribute | 0.99 |
| `aria-label` | 1.00 | | exact alias match | 0.97 |
| description | 0.80 | | regex pattern match | 0.93 |
| `name`/`id` | 0.86 | | alias as a whole phrase | 0.90 |
| placeholder | 0.78 | | token-set F1 / containment | 0.80 |
| nearby text | 0.55 | | character bigram Dice | 0.55 |

```
base    = max over (source, signal, alias) of  sourceFactor × signalWeight × raw
final   = clamp(base + contextBonus + typeBonus) × typeGate × negativeGate
```

`max`, not a sum: a label that matches an alias exactly *and* by tokens *and* by characters is
one piece of evidence seen three ways, and summing it inflates the score without adding
information.

Modifiers:

* **context bonus** (+0.06) when a section heading or nearby copy matches a concept's context
  cues — `Year` under an `Education` heading.
* **type bonus** (+0.05) when the control's type is the natural type for the concept's value
  type (`email` input for an email concept).
* **type gate** (×0.35) when the concept declares incompatible field types, softened to ×0.85
  when both types are text-bearing. The soft gate exists because the hard one caused a real
  failure: an exact `Phone Number` match on a `contenteditable` scored below an unrelated weak
  token match for `payment.card_number`, and the field was blocked as a card number.
* **negative gate** (×0.15) when a disqualifying phrase is present — `Company Email` does not
  resolve to the personal email, and (after a benchmark finding) does not resolve to the
  company *name* either.

A **type override** short-circuits the whole computation where the DOM is unambiguous: an
`input[type=password]` is `auth.password` at 0.99 whatever its label says.

Every contributing signal is returned with the candidate. Modifier signals are always retained
in the provenance even when the list is truncated, because a bonus or penalty that moved the
score must never be invisible to a reviewer.

**Ambiguity** is `score(top) − score(second) < 0.08`, and is a first-class routing input
rather than a hidden tie-break.

**Commitment threshold.** Below a score of 0.45 the engine does not claim to have recognised
the field: no concept is named in the provenance and no signals are shown. Reporting a
0.28-scoring top candidate as the field's meaning would mislead both the user and the metric.

## 5. Resolution and option mapping

The resolver (`shared/matching/resolve.ts`) turns a concept into a value and a provenance path.
Two things it does that a naive lookup does not:

* **Derivation with reduced confidence.** A first name split out of a stored full name resolves
  at 0.92, not 1.0, and is labelled `derived`. Selection among repeated entries is explicit:
  the education entry with the latest graduation year, the experience entry marked current.
* **Option mapping with a synonym table.** For a control with fixed choices, the resolved value
  is scored against each option: exact (1.0), containment either way (0.92/0.88), *equivalence
  group* (0.85), token overlap, near-identical characters. The equivalence groups are what map
  `B.Tech` onto `Bachelor's Degree` and `Intermediate` onto `High School` deterministically, with
  no model call. Partial coverage of a multi-select reduces confidence proportionally.

## 6. Confidence

```
confidence = matchConfidence × valueConfidence
band       = high ≥ 0.90 | medium ≥ 0.70 | low
```

Multiplication, not a blend: a perfect understanding of a field the profile cannot answer is not
a confident answer. Thresholds are data (`ConfidenceThresholds`), configurable by the user and
sweepable by an experiment. Non-finite values clamp to 0, never to 1 — an arithmetic bug must
not become a high-confidence autofill.

Only the **high** band is pre-accepted in the review panel. Medium and low suggestions are still
shown, with their true band, unaccepted. Discarding a plausible answer helps nobody; filling it
without consent is the thing to avoid, and the panel is where that line is drawn.

AI-produced answers are capped at 0.89 so a model's self-reported confidence can never reach the
high band on its own: a generated answer always passes in front of the user.

## 7. Routing

| Route | Condition |
|---|---|
| `blocked` | safety policy or a `never` concept policy |
| `document` | file input — the user picks the file |
| `manual` | no match above 0.45 and not long-form; or disabled/read-only; or a generative concept in a single-line box |
| `ai_generate` | a generative concept in a long-form control, or an unrecognised long-form question |
| `ai_assist` | ambiguous, or a match below the medium threshold |
| `deterministic` | everything else |

Long-form is detected from three independent signals: a multi-line control, a `maxlength` of 200
or more, or an interrogative label. The "generative concept in a single-line box" rule came from
the benchmark: a short input labelled `Other` matched the catch-all concept and would otherwise
have had a paragraph generated into it.

## 8. Correction learning

A stored correction for the same normalized question overrides inference entirely and is
labelled as the user's own wording (0.95, origin `correction`) — the user typed it, which is
better evidence than any inference. Corrections are also passed to the model as few-shot
phrasing context. They never apply to a blocked field, are cached locally for 10 minutes, and
can be listed and deleted by the user.

## 9. Interaction

One entry point writes to any control type. Three invariants are enforced in the engine rather
than left to callers:

1. A blocked field is never written, and the policy is **re-evaluated at write time** so a
   tampered or stale suggestion cannot bypass it.
2. Nothing that submits, pays, navigates or agrees is ever clicked.
3. Every write is read back and compared. An unverified click is reported as a failure, not
   counted as a success — including the case where a custom dropdown swallows the click.

Framework-controlled inputs are written through the native prototype `value` setter so React's
value tracker observes the change, then `input` and `change` are dispatched. Vue and Angular
listen to the same native events, so nothing here is framework-specific.

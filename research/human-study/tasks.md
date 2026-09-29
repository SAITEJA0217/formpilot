# Tasks

> **NOT YET COLLECTED.** No participant has attempted any of these. There is no data.

## The supplied profile

Participants are given this on paper and asked to complete every form as this person. It is
fictional. It is deliberately *not* the profile in `research/benchmark/profile.ts`: a study run
against the same profile the engine was developed with would flatter it, because the ontology's value
resolvers were written with those shapes in view.

| Field | Value |
| --- | --- |
| Full name | Priya Anand Raghavan |
| Email | priya.raghavan@example.org |
| Phone | +44 7700 900461 |
| Date of birth | 3 February 1996 |
| Address | 14 Cheltenham Walk, Bristol, BS1 4QR, United Kingdom |
| Degree | MSc Computer Science |
| University | University of Bristol |
| Graduated | 2020 |
| Current employer | Harbourline Analytics |
| Job title | Data Engineer |
| Years of experience | 5 |
| Notice period | 1 month |
| Skills | Python, SQL, Airflow, dbt |
| Right to work | Yes, UK citizen |

Three things about it are deliberate and will affect the numbers:

- **A UK address and phone.** The benchmark profile is Indian. A study on a single locale measures
  that locale; using a different one from the development profile at least prevents the study from
  inheriting the development locale's advantages.
- **A middle name.** Composite-name splitting is a known weak point and this exercises it.
- **A notice period in words, not a date.** "1 month" has to survive a field that may want either.

## Task forms

Four analysed forms plus one practice form. All served locally; none submits anywhere.

Matched in pairs by length and field mix, so that the two conditions see comparable work. Which pair
a participant meets in which condition alternates across participants (`protocol.md` §2).

| ID | Form | Fields | Pair | What it is for |
| --- | --- | --- | --- | --- |
| P0 | Practice — contact form | 5 | — | first contact with the panel; not analysed |
| T1 | Graduate job application, single page | 18 | A | the ordinary case |
| T2 | Internship application, single page | 17 | A | matched to T1 |
| T3 | Six-step application wizard | 21 over 6 steps | B | multi-step, where the session has to hold |
| T4 | Visa-style application wizard | 20 over 5 steps | B | matched to T3 |

T3 is `frontend/public/test-forms/multi-step-application.html`. T4 needs authoring and does not exist
yet; this table names it rather than pretending otherwise.

### Fields every task form must contain

Not a full specification — the point is the coverage each form has to reach for the analysis in
`analysis-plan.md` §3 to be possible.

1. **Directly resolvable** (name, email, phone). Should be offered at high confidence. These drive the
   time saving, if there is one.
2. **Ambiguous** (`Company` with no qualifier, `Notice Period`). Should be offered for review and not
   pre-accepted. These are where the correction rate lives.
3. **A prose question** ("Why do you want this role?"). Should be offered only as generated text, and
   with the model path off (`protocol.md` §6) not at all — so the participant writes it themselves in
   both conditions. That is a deliberate floor on how much time assistance can save, and it is stated
   in the results rather than engineered away.
4. **At least one control that must be refused** — a consent checkbox, and in T4 a typed signature.
   These are the safety check: the measure is whether a participant ever ends a form with one of them
   set when they did not set it themselves.
5. **One field the profile cannot answer** ("Which of our offices would you prefer?"). Tests whether
   the tool is honest about not knowing, and whether the participant notices.

## Ground truth

Each form ships a ground-truth file: per field, the expected value from the supplied profile, or one
of three markers.

| Marker | Meaning |
| --- | --- |
| `EXPECT:<value>` | the profile answers this, and this is the answer |
| `EXPECT_ANY` | free prose; any non-empty answer is correct |
| `EXPECT_EMPTY` | the profile cannot answer this; empty or the participant's own words are both correct |
| `MUST_NOT_BE_SET` | a consent, declaration or signature control; correct means the participant set it deliberately, and any other state is a safety failure |

`EXPECT:<value>` is compared after normalising whitespace and case, and for dates after parsing. A
participant who types "3/2/1996" for a date of birth has given the right answer; a comparison that
called it wrong would be measuring the comparison.

Scoring is done by script from the ground-truth files, not by hand, so that it is reproducible and so
that the person scoring cannot be influenced by which condition produced a form. The script does not
receive the condition label.

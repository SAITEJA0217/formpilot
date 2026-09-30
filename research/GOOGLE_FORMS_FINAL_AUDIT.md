# FormPilot: Final Google Forms-Only Code & Architecture Audit

**Document Identifier:** FORMPILOT-AUDIT-GF-2026-FINAL  
**Scope:** Strictly Google Forms (`https://docs.google.com/forms/*`)  
**Evaluation Date:** September 2026  
**Auditor:** Deep Code & Architecture Inspection Engine  
**Repository State:** Pre-Freeze Baseline Audit

---

## 1. Executive Overview & Scope Lock

This audit evaluates the **Google Forms-only** implementation of FormPilot. Per project specifications ([`docs/PRD.md`](file:///c:/P/formpilot/docs/PRD.md)), third-party form builders (Microsoft Forms, Typeform, Jotform, SurveyMonkey), generic web forms, and cross-origin embedded contexts are intentionally excluded.

```
+---------------------------------------------------------------------------------------+
|                                SCOPE LOCK & BOUNDARY                                  |
+---------------------------------------------------------------------------------------+
| TARGET DOMAIN:        https://docs.google.com/forms/*                                 |
| PLATFORM ENGINE:      Chromium Manifest V3 (Chrome, Edge, Brave)                      |
| ARCHITECTURAL STACK:  React 19, Next.js 16, Firebase Auth, Firestore, OpenRouter /    |
|                       Gemini 2.5 Flash API                                            |
| DESIGN PHILOSOPHY:    Human-in-the-Loop; Zero Autonomous Submission; Provenance Gating|
+---------------------------------------------------------------------------------------+
```

---

## 2. Google Forms Control-by-Control Audit Matrix

| Google Forms Control | DOM Selector & Detection | Extraction Method | AI Mapping Target | Review Panel Display | Autofill Injection Mechanism | State Acceptance | Final Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :---: |
| **Short Answer (Text)** | `div[role="listitem"] input[type="text"]` | Tagged as `short_answer` | Direct match or generation | Inline text review | Native descriptor setter + `input`/`change`/`blur` | **Accepted** | **Verified** |
| **Email Input** | `input[type="email"]` | Tagged as `short_answer` | Direct from `basicProfile.email` | Email string | Native descriptor setter | **Accepted** | **Verified** |
| **Phone / Tel Input** | `input[type="tel"]` | Tagged as `short_answer` | Direct from `basicProfile.phone` | Phone string | Native descriptor setter | **Accepted** | **Verified** |
| **Number Input** | `input[type="number"]` | Tagged as `short_answer` | Number string (e.g. CGPA, Year) | Numeric string | Native descriptor setter | **Accepted** | **Verified** |
| **URL / Link Input** | `input[type="url"]` | Tagged as `short_answer` | LinkedIn, GitHub, Portfolio | URL string | Native descriptor setter | **Accepted** | **Verified** |
| **Paragraph (Textarea)**| `div[role="listitem"] textarea` | Tagged as `paragraph` | Projects, bio, experience | Multiline text | Native descriptor setter | **Accepted** | **Verified** |
| **Radio Buttons (MCQ)** | `div[role="radiogroup"]` + `div[role="radio"]` | Options extracted from `data-value`/`aria-label`/`textContent` | Selects exact option string | Option label | Two-pass matching (exact first) + `.click()` | **Accepted** | **Verified** |
| **Linear Scale (1–10)** | `div[role="radiogroup"]` + `div[role="presentation"]` | Tagged as `linear_scale` | Returns option index string | Number label | Exact match on scale + `.click()` | **Accepted** | **Verified** |
| **Checkboxes (Multi)** | `div[role="checkbox"]` | Options extracted from `aria-label`/`data-value`/`textContent` | Returns matching option string | Option label | Checks target without unchecking others | **Accepted** | **Verified** |
| **Dropdown Listbox** | `div[role="listbox"]` | Options extracted from `div[role="option"]` | Returns exact option string | Option label | Opens listbox + clicks matching option | **Accepted** | **Verified** |
| **Date Picker** | `input[type="date"]` | Tagged as `date` | Strictly `YYYY-MM-DD` | Formatted date | Standard ISO `YYYY-MM-DD` injection | **Accepted** | **Verified** |
| **Time Picker** | `input[type="time"]` | Tagged as `time` | Strictly `HH:MM` (24-hr) | Time string | Native descriptor setter | **Accepted** | **Verified** |
| **Multiple-Choice Grid**| `div[role="grid"]` (Radio matrix) | Flattened into `${question}: ${rowHeader}` | Maps column per row | Row-by-row card | Row-isolated radio click | **Accepted** | **Verified** |
| **Checkbox Grid** | `div[role="grid"]` (Checkbox matrix)| Flattened into `${question}: ${rowHeader}` | Maps column per row | Row-by-row card | Row-isolated checkbox click | **Accepted** | **Verified** |
| **Required Indicator** | `div[role="heading"]` with `*` | Strips `*`, flags `required: true` | Prioritized in prompt | Visual asterisks | Injected into DOM field | **Accepted** | **Verified** |
| **File Upload** | `input[type="file"]` | Ignored / Excluded | N/A | Excluded | Skipped (Security sandbox) | **Manual** | **Excluded** |

---

## 3. Detailed DOM Extraction Audit

### Analysis of `extractGoogleFormQuestions()` ([`extension/src/content/index.tsx`](file:///c:/P/formpilot/extension/src/content/index.tsx#L6))

1. **Question Container Isolation:**
   - Google Forms groups every question inside a top-level `div[role="listitem"]`.
   - The extractor accurately skips non-question blocks (such as section title cards or standalone images) that do not contain a child `div[role="heading"]`.
2. **Hidden Input Exclusion:**
   - **Audit Finding (Fixed):** Generic `input` queries previously risked matching Google Forms hidden CSRF tokens (`input[type="hidden"]`).
   - **Fix Implemented:** Query selector updated to `:not([type="hidden"])`.
3. **Empty Question Title Defense:**
   - **Audit Finding (Fixed):** Questions with empty or whitespace-only headers are safely rejected early (`if (!questionText) return;`).
4. **Option Extraction Robustness:**
   - Radio and checkbox options now retrieve labels across a multi-attribute fallback: `data-value` $\rightarrow$ `aria-label` $\rightarrow$ `textContent`.

---

## 4. Matrix & Grid Flattening Audit

### Two-Dimensional Grid Deconstruction
Google Forms implements matrix questions using `div[role="grid"]` consisting of:
- A header row: `div[role="row"]` containing `div[role="columnheader"]`.
- Data rows: `div[role="row"]` containing a `div[role="rowheader"]` and multiple `div[role="radio"]` or `div[role="checkbox"]` cells.

```
+---------------------------------------------------------------------------------------+
|                             MATRIX FLATTENING ALGORITHM                               |
+---------------------------------------------------------------------------------------+
| Raw Grid: "Rate your proficiency"                                                    |
|  * Row 1: "TypeScript"  | [Beginner] [Intermediate] [Expert]                          |
|  * Row 2: "Python"      | [Beginner] [Intermediate] [Expert]                          |
+---------------------------------------------------------------------------------------+
| Transformed Intermediate Schema:                                                      |
|  1. FormQuestion { id: "q_0_r1", question: "Rate your proficiency: TypeScript",       |
|                    type: "radio", options: ["Beginner", "Intermediate", "Expert"] }   |
|  2. FormQuestion { id: "q_0_r2", question: "Rate your proficiency: Python",           |
|                    type: "radio", options: ["Beginner", "Intermediate", "Expert"] }   |
+---------------------------------------------------------------------------------------+
```

### Autofill Matching in Grids
- **Audit Finding (Fixed):** During autofill, row matching previously applied loose substring matching, risking unchecking previously clicked options when option names overlapped (e.g. "Agree" vs. "Strongly Agree").
- **Fix Implemented:** Implemented a **two-pass option selector**: Pass 1 matches exact strings (`val === targetAns`). Pass 2 only runs if exact match fails, enforcing a minimum string length of $\ge 3$ characters.

---

## 5. Autofill Engine Audit

### Property Setter Overrides & Event Dispatching
When automating input values in modern Google Forms, simple `element.value = "John"` assignments fail because Google Closure / React synthetic event listeners hook the prototype setter.

```typescript
// Verified Native Prototype Setter Manipulation (content/index.tsx)
const valueSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set;
const prototype = Object.getPrototypeOf(element);
const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
  prototypeValueSetter.call(element, value);
} else if (valueSetter) {
  valueSetter.call(element, value);
} else {
  element.value = value;
}

// Dispatches full DOM lifecycle
element.dispatchEvent(new Event('input', { bubbles: true }));
element.dispatchEvent(new Event('change', { bubbles: true }));
element.dispatchEvent(new Event('blur', { bubbles: true }));
```

### Non-Grid Question Collision Defense
- **Audit Finding (Fixed):** In forms containing both `"Name"` and `"Father's Name"`, searching for `"Name"` via `.includes()` previously matched `"Father's Name"` first.
- **Fix Implemented:** `handleFill` now enforces **exact question string matching first** (`a.question.toLowerCase().trim() === normQ`), falling back to fuzzy matching only if exact match returns empty.

---

## 6. Google Forms Dynamic Behavior Audit

| Behavior / Scenario | Support Level | Implementation & Limitation Details |
| :--- | :---: | :--- |
| **Single-Page Forms** | **Complete** | Entire form parsed and filled in one pass. |
| **Multi-Page Forms ("Next" Button)** | **Supported (Step-by-Step)** | Only visible page questions exist in the DOM. User clicks "Next", then triggers "Analyze Current Form" on each page. |
| **Conditional Branching** | **Supported (Step-by-Step)** | Hidden branches mount only after selection. User fills initial page, advances, and re-analyzes. |
| **Dropdown Menus** | **Complete** | Injected script triggers `.click()` on `div[role="listbox"]` and queries `div[role="option"]` with 150ms timeout. |
| **Section Breaks / Pagination** | **Documented Limitation** | Single-pass cross-page analysis is blocked by Google Forms' DOM unmounting. |

---

## 7. AI Answer Generation & Provenance Audit

```
+---------------------------------------------------------------------------------------+
|                                AI PIPELINE VERIFICATION                              |
+---------------------------------------------------------------------------------------+
| [INPUT PAYLOAD]                                                                       |
|  * Strict JSON UserProfile + FormQuestion[] + Top 15 Historical Corrections           |
|                                                                                       |
| [SAFETY RULES IN PROMPT]                                                              |
|  * "Never invent personal information."                                               |
|  * "If information is unavailable return null."                                       |
|  * "Provide 'sourceDetail' which is the EXACT path in the JSON profile."              |
|                                                                                       |
| [SERVER-SIDE CONFIDENCE CALIBRATION]                                                  |
|  * Direct Profile Match:  Confidence = LLM_Score (up to 100%)                         |
|  * Generative Inference:  Confidence = Math.min(LLM_Score, 70%)                       |
|  * Missing Profile Data:  Confidence = 0%, source = 'missing'                         |
+---------------------------------------------------------------------------------------+
```

### Provenance Gating Verification
The `ReviewPanel` provides an interactive `"Why?"` button for every answer that exposes the exact JSON key path (`sourceDetail`) and flags whether the answer was direct or inferred (`isGenerated`).

---

## 8. Safety & Privacy Audit

| Safety Category | Policy | Technical Implementation | Audit Result |
| :--- | :--- | :--- | :---: |
| **Passwords / PINs** | **Hard Excluded** | Excluded from profile schema and Google Forms scope | **Pass** |
| **Credit Cards / CVV** | **Hard Excluded** | Excluded from profile schema and Google Forms scope | **Pass** |
| **Autonomous Submission**| **Strictly Blocked**| Extension code contains zero `form.submit()` or submit click triggers | **Pass** |
| **Token Verification** | **Enforced** | Firebase Admin SDK validates ID token on every API call | **Pass** |
| **Rate Limiting** | **Enforced** | 1,000 queries/day/UID tracked in Firestore transaction | **Pass** |
| **Session Isolation** | **Enforced** | Sign-out wipes `chrome.storage.local` cache immediately | **Pass** |

---

## 9. Failure & Bug Fix Log

During this audit, the following functional edge-case issues were identified and immediately remediated:

| Bug Identified | Root Cause | Code File | Remediated Fix |
| :--- | :--- | :--- | :--- |
| **Question Collision** | Non-grid matching used `.includes()` before exact match, allowing `"Father's Name"` to override `"Name"` | [`extension/src/content/index.tsx`](file:///c:/P/formpilot/extension/src/content/index.tsx) | Implemented exact string matching priority before substring fallback |
| **Option Collision** | Substring matching on radio options allowed `"Agree"` to uncheck `"Strongly Agree"` | [`extension/src/content/index.tsx`](file:///c:/P/formpilot/extension/src/content/index.tsx) | Implemented two-pass option matcher (exact first, length-gated substring fallback) |
| **Date Timezone Shift** | Valid `YYYY-MM-DD` strings were passed through `new Date().toISOString()`, risking 1-day offsets | [`extension/src/content/index.tsx`](file:///c:/P/formpilot/extension/src/content/index.tsx) | Direct regex bypass for standard `YYYY-MM-DD` strings |
| **Hidden Input Inclusion** | `querySelector('input')` without `:not([type="hidden"])` could misclassify hidden tokens | [`extension/src/content/index.tsx`](file:///c:/P/formpilot/extension/src/content/index.tsx) | Added `:not([type="hidden"])` exclusion filter |
| **ReviewPanel Stale State** | Re-analyzing a form without unmounting did not refresh local `answers` state | [`extension/src/content/ReviewPanel.tsx`](file:///c:/P/formpilot/extension/src/content/ReviewPanel.tsx) | Added `useEffect` hook synchronizing `answers` state with `initialAnswers` |

---

## 10. Final Google Forms Health Scorecard

### A. Overall Status
**READY WITH MINOR FIXES APPLIED** *(Baseline is robust, clean, and frozen for Google Forms)*.

### B. Functional Completeness Breakdown

| Architectural Area | Completeness Rating | Evaluation Summary |
| :--- | :---: | :--- |
| **DOM Extraction** | **Complete** | All 8 Google Forms input types + matrix grids handled |
| **Semantic Mapping** | **Complete** | LLM prompt serialization with few-shot history |
| **Answer Generation** | **Complete** | Resilient JSON repair and OpenRouter integration |
| **Review Panel** | **Complete** | Inline editing, skip, Why? provenance, and toast feedback |
| **Autofill Event Engine** | **Complete** | Native descriptor overrides + multi-pass option matching |
| **Safety & Gating** | **Complete** | No autonomous submit; credentials excluded; rate limits enforced |
| **Authentication & Sync**| **Complete** | Firebase token refresh loop across extension and dashboard |
| **Multi-Step Behavior** | **Mostly Complete**| Supported via page-by-page re-analysis |

### C. Critical Bugs
- **0 Critical Bugs Remaining.** (All identified edge cases remediated in source).

### D. Empirical & Research Gaps (Pre-Publication Roadmap)
1. **Automated CI Benchmarking:** Automated Playwright E2E suites and a 100-form held-out evaluation corpus need to be committed for empirical paper tables.
2. **User Time Study:** Formal measurement of manual vs. FormPilot completion times across a cohort of users.

---

## 11. Final Recommendation

The Google Forms implementation is **architecturally solid, functionally complete, and safe**. It is ready to be **frozen as the official Version 1.0 baseline**.

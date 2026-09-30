# FormPilot: Google Forms Scope Specification & Boundary Definition

**Document Identifier:** FORMPILOT-SCOPE-GF-2026  
**Scope Status:** FROZEN — Strictly Google Forms (`https://docs.google.com/forms/*`)  
**Evaluation Date:** September 2026  
**Version Target:** 1.0.0 (Pre-Alpha / MVP)

---

## 1. Scope Definition & Boundary

FormPilot is exclusively designed and scoped for **Google Forms questionnaires** accessed directly via Chromium-based desktop web browsers. Any extension to other form builders, generic HTML websites, or cross-domain embedded contexts is explicitly excluded from this baseline.

```
+---------------------------------------------------------------------------------------+
|                               EXACT BOUNDARY SPECIFICATION                            |
+---------------------------------------------------------------------------------------+
| IN SCOPE:                                                                             |
|  * Standalone Google Forms URLs: https://docs.google.com/forms/d/e/*/viewform         |
|  * Google Forms preview URLs:    https://docs.google.com/forms/d/*/preview            |
|  * Google Forms response URLs:   https://docs.google.com/forms/u/*/d/e/*/viewform     |
|  * Google Forms short URLs:      https://forms.gle/* (redirecting to docs.google.com) |
+---------------------------------------------------------------------------------------+
| OUT OF SCOPE (EXCLUDED):                                                              |
|  * Google Forms Edit/Creator Mode (https://docs.google.com/forms/d/*/edit)            |
|  * Google Forms embedded inside <iframe> on third-party domains (Cross-origin)         |
|  * Microsoft Forms, Typeform, Jotform, SurveyMonkey                                   |
|  * Generic job applications (Workday, Greenhouse, Lever, Taleo, LinkedIn)             |
|  * Arbitrary HTML5 forms on third-party websites                                      |
+---------------------------------------------------------------------------------------+
```

---

## 2. Supported Google Forms Controls Matrix

| Control Category | Google Forms Implementation | FormPilot Detection Selector | Unified Type | Extraction & Autofill Support Status |
| :--- | :--- | :--- | :---: | :--- |
| **Short Answer** | Single-line `input[type="text"]` (or generic `input`) | `div[role="listitem"] input` | `short_answer` | **Fully Supported** via native property setter & events |
| **Paragraph** | Multi-line `textarea` | `div[role="listitem"] textarea` | `paragraph` | **Fully Supported** via native property setter & events |
| **Email Input** | `input[type="email"]` | `input[type="email"]` | `short_answer` | **Fully Supported** |
| **Phone / Tel Input**| `input[type="tel"]` | `input[type="tel"]` | `short_answer` | **Fully Supported** |
| **Number Input** | `input[type="number"]` | `input[type="number"]` | `short_answer` | **Fully Supported** |
| **URL Input** | `input[type="url"]` | `input[type="url"]` | `short_answer` | **Fully Supported** |
| **Multiple Choice** | `div[role="radiogroup"]` + `div[role="radio"]` | `div[role="radiogroup"]` | `radio` | **Fully Supported** via simulated DOM click |
| **Linear Scale** | `div[role="radiogroup"]` + `div[role="presentation"]` | `div[role="radiogroup"]` | `linear_scale` | **Fully Supported** via simulated DOM click |
| **Checkboxes** | `div[role="checkbox"]` | `div[role="checkbox"]` | `checkbox` | **Fully Supported** via multi-option matching & click |
| **Dropdown** | `div[role="listbox"]` + `div[role="option"]` | `div[role="listbox"]` | `dropdown` | **Fully Supported** via container click & option selection |
| **Date Picker** | `input[type="date"]` | `input[type="date"]` | `date` | **Fully Supported** with `YYYY-MM-DD` normalization |
| **Time Picker** | `input[type="time"]` | `input[type="time"]` | `time` | **Fully Supported** with `HH:MM` normalization |
| **Multiple-Choice Grid**| `div[role="grid"]` with radio buttons | `div[role="grid"]` | `radio` (Flattened) | **Fully Supported** (Flattened into sub-questions) |
| **Checkbox Grid** | `div[role="grid"]` with checkboxes | `div[role="grid"]` | `checkbox` (Flattened) | **Fully Supported** (Flattened into sub-questions) |
| **Required Asterisk**| `div[role="heading"]` with `*` | Text scan for `*` | Metadata | **Fully Supported** (Tagged as `required: true`) |

---

## 3. Unsupported Google Forms Scenarios & Edge Cases

| Scenario | Behavior in FormPilot | Technical Reason | Handling / Workaround |
| :--- | :--- | :--- | :--- |
| **File Upload (`input[type="file"]`)** | Ignored / Skipped | Browser security blocks synthetic file uploads to Google Drive without user file-picker interaction | User must attach files manually |
| **Google Forms Section Breaks (Multi-Page)** | Extracts only currently mounted page | Subsequent page elements are not mounted in the DOM until user clicks "Next" | User clicks "Next" manually, then clicks "Analyze Current Form" on each page |
| **Conditional Branching (Go to section based on answer)** | Handled per visible step | Questions on hidden branches do not exist in the DOM until the triggering radio option is selected | User fills current page, advances to revealed branch, and re-analyzes |
| **Google Forms CAPTCHA / ReCAPTCHA** | Ignored / Blocked | FormPilot contains no CAPTCHA solving scripts | User solves CAPTCHA manually |
| **Form Editor Mode (`/edit`)** | Blocked / Alerted | DOM structure differs (`role="listitem"` represents editable question cards) | Extension detects invalid mode and prompts user to view preview/published form |
| **Google Workspace Sign-In Barrier** | Blocked until login | Form requires Google account authentication before rendering questions | User completes standard Google sign-in in browser |
| **Embedded Iframe Form on 3rd-Party Site** | Blocked | Cross-origin frame security prevents extension content script injection | User opens form in standalone tab (`docs.google.com`) |

---

## 4. Supported Browser Assumptions

FormPilot operates under standard **Chromium Manifest V3** extension specifications:

- **Google Chrome:** Version 110+ (Full Support)
- **Microsoft Edge:** Version 110+ (Full Support)
- **Brave Browser:** Current Release (Full Support)
- **Host Permissions:** Strictly bound to `https://docs.google.com/forms/*`, `http://localhost:3000/*`, and `http://127.0.0.1:3000/*`.
- **Runtime Environment:** Single-user local profile session with Firebase Auth session persistence.

---

## 5. Explicit Safety Exclusions

FormPilot maintains a non-negotiable safety boundary:

1. **No Autonomous Submission:** The extension contains zero automated submission logic (`submit` buttons are never programmatically triggered).
2. **No Sensitive Financial / Credential Storage:** The user profile schema and question extractors explicitly omit credit card, bank account, CVV, OTP, and password storage keys.
3. **Mandatory Human Verification:** Every generated answer is gated behind the interactive `ReviewPanel` overlay before any DOM value modification occurs.

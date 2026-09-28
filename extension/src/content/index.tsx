/**
 * Universal content script — the in-page half of the engine.
 *
 * Injected on demand (`chrome.scripting.executeScript` under `activeTab`) rather
 * than declared for a list of sites, so FormPilot has no standing access to any
 * page until the user opens it on that page.
 *
 * Responsibilities: detect and normalize the form, ask the service worker for
 * suggestions, render the review panel in a shadow root, fill accepted values, and
 * keep all of that up to date as the page mutates.
 */
import { createRoot, type Root } from 'react-dom/client';
import type { UnifiedForm } from '../../../shared/types/form';
import type { FieldSuggestion, FillReport } from '../../../shared/types/suggestion';
import type { FormSummary, SuggestionsResult } from '../../../shared/messaging/messages';
import {
  applySession,
  attachFile,
  createSession,
  fillFields,
  normalizeForm,
  noteStep,
  observeForm,
  recordDecision,
  recordOutcomes,
  sessionMatchesForm,
  type DetectionResult,
  type FormAdapter,
  type FormSessionState,
} from '../core';
import ReviewPanel from './ui/ReviewPanel';
import { PANEL_STYLES } from './ui/panelStyles';

/** Guard against a second injection into the same page. */
const GUARD = '__formPilotEngineLoaded';
type GuardedWindow = Window & { [GUARD]?: boolean };

const HOST_ID = 'formpilot-root';

interface EngineState {
  form: UnifiedForm | null;
  elements: DetectionResult['elements'];
  adapter: FormAdapter | null;
  suggestions: FieldSuggestion[];
  summary: FormSummary | null;
  session: FormSessionState | null;
  report: FillReport | null;
  error: string | null;
  busy: boolean;
  stopObserving: (() => void) | null;
}

const state: EngineState = {
  form: null,
  elements: new Map(),
  adapter: null,
  suggestions: [],
  summary: null,
  session: null,
  report: null,
  error: null,
  busy: false,
  stopObserving: null,
};

let panelRoot: Root | null = null;
let shadow: ShadowRoot | null = null;

// ─── Panel plumbing ───────────────────────────────────────────────────────────

function ensureShadowHost(): ShadowRoot {
  if (shadow) return shadow;
  let host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = HOST_ID;
    // Marked so the detector never treats our own UI as page content.
    host.setAttribute('data-formpilot-ignore', 'true');
    document.documentElement.appendChild(host);
  }
  shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  if (!shadow.querySelector('style')) {
    const style = document.createElement('style');
    style.textContent = PANEL_STYLES;
    shadow.appendChild(style);
    const mount = document.createElement('div');
    mount.id = 'formpilot-mount';
    shadow.appendChild(mount);
  }
  return shadow;
}

function closePanel(): void {
  state.stopObserving?.();
  state.stopObserving = null;
  panelRoot?.unmount();
  panelRoot = null;
  shadow = null;
  document.getElementById(HOST_ID)?.remove();
}

function renderPanel(): void {
  if (!state.summary) return;
  const root = ensureShadowHost();
  const mount = root.querySelector('#formpilot-mount');
  if (!mount) return;
  if (!panelRoot) panelRoot = createRoot(mount);

  panelRoot.render(
    <ReviewPanel
      summary={state.summary}
      suggestions={state.suggestions}
      busy={state.busy}
      report={state.report}
      error={state.error}
      onClose={closePanel}
      onRescan={() => {
        void rescan({ silent: false });
      }}
      onFill={(accepted) => {
        void applyFill(accepted);
      }}
      onEdit={(fieldId, value, previous) => {
        handleEdit(fieldId, value, previous);
      }}
      onAttach={(fieldId) => {
        void promptForFile(fieldId);
      }}
    />,
  );
}

// ─── Engine ───────────────────────────────────────────────────────────────────

function send<T>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response: T & { error?: string }) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message ?? 'Extension messaging failed.'));
          return;
        }
        if (response && typeof response === 'object' && 'error' in response && response.error) {
          reject(new Error(String(response.error)));
          return;
        }
        resolve(response);
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error('Extension messaging failed.'));
    }
  });
}

/** Detect the form and ask the service worker to turn it into suggestions. */
async function scan(): Promise<FormSummary> {
  const normalized = normalizeForm({ href: window.location.href });
  state.form = normalized.form;
  state.elements = normalized.elements;
  state.adapter = normalized.adapter;

  if (!state.session || !sessionMatchesForm(state.session, normalized.form)) {
    state.session = createSession(normalized.form);
  } else {
    state.session = noteStep(state.session, normalized.form);
  }

  let result: SuggestionsResult;
  try {
    result = await send<SuggestionsResult>({ type: 'BUILD_SUGGESTIONS', form: normalized.form });
    state.error = result.aiError ?? null;
  } catch (error) {
    // Detection still succeeded — report the fields, explain the missing answers.
    state.error = error instanceof Error ? error.message : 'Could not reach FormPilot.';
    const fallback: FieldSuggestion[] = normalized.form.fields.map((field) => ({
      fieldId: field.id,
      label: field.label,
      fieldType: field.type,
      value: null,
      confidence: 0,
      band: 'low',
      status: field.sensitivity === 'blocked' ? 'blocked' : 'manual',
      provenance: { origin: 'none', signals: [], explanation: 'No suggestions available.', usedAI: false },
      reason: state.error ?? undefined,
    }));
    result = {
      suggestions: fallback,
      summary: {
        formId: normalized.form.id,
        platform: normalized.form.platform,
        title: normalized.form.title,
        url: normalized.form.url,
        fieldsDetected: fallback.length,
        ready: 0,
        needsReview: 0,
        manual: fallback.filter((s) => s.status === 'manual').length,
        blocked: fallback.filter((s) => s.status === 'blocked').length,
        noData: 0,
        isMultiStep: normalized.form.metadata.isMultiStep,
        currentStep: normalized.form.metadata.currentStep,
        totalSteps: normalized.form.metadata.totalSteps,
        warnings: normalized.form.metadata.warnings,
      },
      aiCalls: 0,
    };
  }

  state.suggestions = state.session
    ? applySession(state.session, normalized.form, result.suggestions)
    : result.suggestions;
  state.summary = result.summary;
  return result.summary;
}

/**
 * Re-detect after the page changed. Suggestions the user already accepted or edited
 * survive, because the session keys them by field identity rather than position.
 */
async function rescan(options: { silent: boolean }): Promise<void> {
  try {
    await scan();
    if (!options.silent) state.report = null;
  } catch (error) {
    state.error = error instanceof Error ? error.message : 'Re-scan failed.';
  }
  renderPanel();
}

function startObserving(): void {
  if (state.stopObserving) return;
  state.stopObserving = observeForm({
    debounceMs: 300,
    onChange: (summary) => {
      // Only re-scan when the structure actually changed, not on every keystroke.
      if (summary.addedControls === 0 && summary.removedControls === 0 && summary.attributeChanges === 0) return;
      void rescan({ silent: true });
    },
  });
}

async function applyFill(accepted: FieldSuggestion[]): Promise<void> {
  if (!state.form) return;
  state.busy = true;
  state.error = null;
  renderPanel();

  const entries = accepted
    .map((suggestion) => {
      const field = state.form?.fields.find((f) => f.id === suggestion.fieldId);
      const handle = state.elements.get(suggestion.fieldId);
      if (!field || !handle) return null;
      return {
        target: { field, element: handle.element, root: handle.root, members: handle.members },
        value: suggestion.value,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const report = await fillFields(entries, {
    platformHandler: state.adapter?.fillField,
    interFieldDelayMs: 40,
  });

  state.report = report;
  state.busy = false;
  if (state.session && state.form) {
    state.session = recordOutcomes(state.session, state.form, report.outcomes);
    for (const suggestion of accepted) {
      state.session = recordDecision(state.session, state.form, suggestion, {
        accepted: true,
        edited: suggestion.editedByUser === true,
      });
    }
  }
  renderPanel();
}

function handleEdit(fieldId: string, value: string, previous: string | null): void {
  const suggestion = state.suggestions.find((s) => s.fieldId === fieldId);
  if (!suggestion || !state.form) return;

  state.suggestions = state.suggestions.map((s) =>
    s.fieldId === fieldId
      ? {
          ...s,
          value,
          editedByUser: true,
          confidence: 1,
          band: 'high',
          status: 'ready',
          provenance: { ...s.provenance, origin: 'user', explanation: 'You entered this value.' },
        }
      : s,
  );
  state.session = state.session
    ? recordDecision(state.session, state.form, { ...suggestion, value }, {
        accepted: true,
        edited: true,
        previousValue: previous,
      })
    : state.session;

  // Correction learning is opt-in server-side; a failure here must not block the UI.
  void send({
    type: 'SEND_CORRECTION',
    payload: {
      originalQuestion: suggestion.label ?? '',
      originalAnswer: previous,
      userCorrection: value,
      sourceDetail: suggestion.provenance.profilePath,
      conceptId: suggestion.provenance.conceptId,
    },
  }).catch(() => {
    // Silent: the user's edit already applies locally.
  });
  renderPanel();
}

/**
 * Open a native file picker and attach the chosen file. The user picks the file
 * themselves — FormPilot stores no document bytes and never selects one for them.
 */
function promptForFile(fieldId: string): void {
  const field = state.form?.fields.find((f) => f.id === fieldId);
  const handle = state.elements.get(fieldId);
  if (!field || !handle) return;

  const picker = document.createElement('input');
  picker.type = 'file';
  picker.setAttribute('data-formpilot-ignore', 'true');
  picker.style.display = 'none';
  if (field.accept) picker.accept = field.accept;

  picker.addEventListener('change', () => {
    const file = picker.files?.[0];
    if (file) {
      const outcome = attachFile(
        { field, element: handle.element, root: handle.root, members: handle.members },
        file,
      );
      state.report = {
        attempted: 1,
        filled: outcome.filled ? 1 : 0,
        failed: outcome.filled ? 0 : 1,
        skipped: 0,
        outcomes: [outcome],
      };
      state.error = outcome.error ?? null;
      renderPanel();
    }
    picker.remove();
  });

  document.documentElement.appendChild(picker);
  picker.click();
}

// ─── Message router ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((request: { action?: string; suggestions?: FieldSuggestion[] }, _sender, sendResponse) => {
  const action = request?.action;

  if (action === 'PING_CONTENT') {
    sendResponse({ ok: true });
    return false;
  }

  if (action === 'SCAN_PAGE') {
    scan()
      .then((summary) => sendResponse({ ok: true, summary }))
      .catch((error: unknown) =>
        sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Scan failed.' }),
      );
    return true;
  }

  if (action === 'GET_SUMMARY') {
    sendResponse(state.summary ? { ok: true, summary: state.summary } : { ok: false, error: 'Not scanned yet.' });
    return false;
  }

  if (action === 'SHOW_REVIEW_PANEL') {
    if (request.suggestions) state.suggestions = request.suggestions;
    const show = async (): Promise<void> => {
      if (!state.summary) await scan();
      renderPanel();
      startObserving();
    };
    show()
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) =>
        sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Could not open the panel.' }),
      );
    return true;
  }

  if (action === 'APPLY_SUGGESTIONS') {
    // Declared in the message contract and used by callers that already have a reviewed
    // set (and by the adversarial safety tests, which deliberately try to push a tampered
    // suggestion past the UI — the interaction engine re-checks policy either way).
    const list = request.suggestions ?? [];
    applyFill(list)
      .then(() => sendResponse({ ok: true, report: state.report }))
      .catch((error: unknown) =>
        sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Fill failed.' }),
      );
    return true;
  }

  if (action === 'CLOSE_PANEL') {
    closePanel();
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

// Announce readiness so a popup that injected us can proceed without polling.
if (!(window as GuardedWindow)[GUARD]) {
  (window as GuardedWindow)[GUARD] = true;
}

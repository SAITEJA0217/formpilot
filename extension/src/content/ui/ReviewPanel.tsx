/**
 * Human-in-the-loop review panel.
 *
 * Nothing is written to the page until the user presses Fill, and only suggestions
 * they have accepted are written. High-confidence suggestions arrive pre-accepted
 * (that is the point of the confidence bands); everything else starts unaccepted, so
 * a medium- or low-confidence guess cannot reach the form by inattention.
 *
 * Every card can show its provenance: the profile path the value came from and the
 * individual matching signals that produced it.
 */
import { useEffect, useMemo, useState } from 'react';
import type { FieldSuggestion, FillReport } from '../../../../shared/types/suggestion';
import type { FormSummary } from '../../../../shared/messaging/messages';
import { toPercent } from '../../../../shared/matching/confidence';
import { isAffirmationControl } from '../../../../shared/safety/policy';
import { IconClose, IconLogo, IconRefresh } from './icons';

export interface ReviewPanelProps {
  summary: FormSummary;
  suggestions: FieldSuggestion[];
  busy?: boolean;
  onFill: (accepted: FieldSuggestion[]) => void;
  onRescan: () => void;
  onClose: () => void;
  onEdit: (fieldId: string, value: string, previous: string | null) => void;
  onAttach: (fieldId: string) => void;
  report?: FillReport | null;
  error?: string | null;
}

export type Decision = {
  accepted: boolean;
  value: string | string[] | boolean | null;
  edited: boolean;
  /**
   * Which field this decision was made about.
   *
   * Recorded because the map is keyed by `fieldId`, and a field id is positional — the detector
   * names fields `f0`, `f1`, `f2` in document order. Within one screen that is unique, but a
   * multi-step form re-detects on every step and numbers each step from zero again, so step two's
   * `f0` is a different field wearing step one's name.
   *
   * The carry-over below existed for a good reason — a framework re-render must not throw away a
   * decision the user already made — but keyed on the id alone it did the opposite of its job: on a
   * six-step application it copied "Full Name" onto "Degree", "Email Address" onto "University", and
   * a `ready` accepted flag along with them, so pressing Fill wrote the applicant's name into their
   * degree. Comparing identity is what makes the carry-over mean "the same field again" instead of
   * "the same position again".
   */
  identity: string;
};

/**
 * A field's identity, as much of it as a suggestion carries.
 *
 * `extension/src/core/session/formSession.ts` computes the same thing from the field itself as
 * `fieldKey`, using type, label and `name`. A `FieldSuggestion` has no `name`, so this uses type and
 * label. That is enough for the job here, which is only to tell "this is the field I decided about"
 * from "this is a different field that happens to sit where that one did".
 */
export function identityOf(suggestion: FieldSuggestion): string {
  const label = (suggestion.label ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  return `${suggestion.fieldType}|${label || 'unlabelled'}`;
}

/**
 * Work out the decision state for a new set of suggestions, given the previous one.
 *
 * Exported and pure so the invariant can be tested directly: a decision is kept when the same field
 * comes back, and discarded when a different field arrives at the same position. Testing that through
 * the rendered panel would need a browser for something that is a property of a map.
 */
export function reconcileDecisions(
  previous: Record<string, Decision>,
  suggestions: FieldSuggestion[],
): Record<string, Decision> {
  const next: Record<string, Decision> = {};
  for (const suggestion of suggestions) {
    const identity = identityOf(suggestion);
    const existing = previous[suggestion.fieldId];
    // Carry a decision over only when it was made about *this* field. A positional id match is not
    // that: see `Decision.identity`.
    if (existing && existing.identity === identity) {
      next[suggestion.fieldId] = existing;
      continue;
    }
    next[suggestion.fieldId] = {
      accepted: suggestion.status === 'ready' && !isAffirmationControl(suggestion.fieldType),
      value: suggestion.value,
      edited: false,
      identity,
    };
  }
  return next;
}

const GROUP_ORDER: { key: FieldSuggestion['status'][]; label: string }[] = [
  { key: ['ready'], label: 'Ready to fill' },
  { key: ['needs_review'], label: 'Needs your review' },
  { key: ['needs_document'], label: 'Documents' },
  { key: ['manual', 'no_data'], label: 'Manual entry' },
  { key: ['blocked'], label: 'Never autofilled' },
];

function valueToText(value: FieldSuggestion['value']): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

export default function ReviewPanel({
  summary,
  suggestions,
  busy,
  onFill,
  onRescan,
  onClose,
  onEdit,
  onAttach,
  report,
  error,
}: ReviewPanelProps) {
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [openWhy, setOpenWhy] = useState<string | null>(null);

  // High-confidence suggestions start accepted; everything else is opt-in.
  //
  // A lone checkbox is the exception, whatever its confidence: ticking one asserts
  // something in the user's name, and the phrase list that catches consent wording will
  // always miss some phrasing. Requiring a click here is the part of that defence that does
  // not depend on reading the label correctly.
  useEffect(() => {
    setDecisions((previous) => reconcileDecisions(previous, suggestions));
  }, [suggestions]);

  const acceptedList = useMemo(
    () =>
      suggestions
        .filter((s) => decisions[s.fieldId]?.accepted)
        .map((s) => ({ ...s, value: decisions[s.fieldId]?.value ?? s.value, editedByUser: decisions[s.fieldId]?.edited }))
        .filter((s) => s.value !== null && s.value !== ''),
    [suggestions, decisions],
  );

  const toggle = (fieldId: string, accepted: boolean): void => {
    setDecisions((prev) => ({
      ...prev,
      [fieldId]: { ...(prev[fieldId] ?? { value: null, edited: false }), accepted },
    }));
  };

  const startEdit = (suggestion: FieldSuggestion): void => {
    setEditing(suggestion.fieldId);
    setDraft(valueToText(decisions[suggestion.fieldId]?.value ?? suggestion.value));
  };

  const saveEdit = (suggestion: FieldSuggestion): void => {
    const previous = valueToText(suggestion.value) || null;
    setDecisions((prev) => ({
      ...prev,
      [suggestion.fieldId]: {
        accepted: true,
        value: draft,
        edited: true,
        identity: identityOf(suggestion),
      },
    }));
    setEditing(null);
    if (draft.trim() && draft !== previous) onEdit(suggestion.fieldId, draft, previous);
  };

  const acceptAllHigh = (): void => {
    setDecisions((prev) => {
      const next = { ...prev };
      for (const suggestion of suggestions) {
        if (suggestion.status === 'ready' || suggestion.band === 'high') {
          next[suggestion.fieldId] = {
            ...(next[suggestion.fieldId] ?? { value: suggestion.value, edited: false }),
            accepted: true,
          };
        }
      }
      return next;
    });
  };

  const grouped = GROUP_ORDER.map((group) => ({
    label: group.label,
    items: suggestions.filter((s) => group.key.includes(s.status)),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="panel" role="dialog" aria-label="FormPilot review">
      <div className="header">
        <span className="mark">
          <IconLogo />
        </span>
        <div>
          <div className="title">FormPilot Review</div>
          <div className="subtitle">
            {summary.platform.replace(/-/g, ' ')}
            {summary.isMultiStep && summary.totalSteps
              ? ` · step ${summary.currentStep ?? '?'} of ${summary.totalSteps}`
              : ''}
          </div>
        </div>
        <span className="spacer" />
        <button className="icon-btn" onClick={onRescan} title="Re-scan this page" aria-label="Re-scan this page">
          <IconRefresh />
        </button>
        <button className="icon-btn" onClick={onClose} title="Close" aria-label="Close FormPilot">
          <IconClose />
        </button>
      </div>

      <div className="stats">
        <span className="stat">
          <b>{summary.fieldsDetected}</b> detected
        </span>
        <span className="stat ready">
          <b>{summary.ready}</b> ready
        </span>
        <span className="stat review">
          <b>{summary.needsReview}</b> review
        </span>
        {summary.manual + summary.noData > 0 && (
          <span className="stat manual">
            <b>{summary.manual + summary.noData}</b> manual
          </span>
        )}
        {summary.blocked > 0 && (
          <span className="stat blocked">
            <b>{summary.blocked}</b> protected
          </span>
        )}
      </div>

      {summary.warnings.map((warning) => (
        <div className="notice" key={warning}>
          {warning}
        </div>
      ))}

      {error && <div className="toast error">{error}</div>}
      {report && (
        <div className={report.failed > 0 ? 'toast error' : 'toast'}>
          Filled {report.filled} of {report.attempted} field{report.attempted === 1 ? '' : 's'}
          {report.failed > 0 ? ` · ${report.failed} could not be filled` : ''}
        </div>
      )}

      <div className="body">
        {suggestions.length === 0 && (
          <div className="empty-state">
            <span>No fillable fields found on this page.</span>
            <small>
              If the form is inside another site embedded in this page, open it directly and try again.
            </small>
          </div>
        )}

        {grouped.map((group) => (
          <div key={group.label} style={{ display: 'contents' }}>
            <div className="group-label">{group.label}</div>
            {group.items.map((suggestion) => {
              const decision = decisions[suggestion.fieldId];
              const accepted = decision?.accepted ?? false;
              const shown = valueToText(decision?.value ?? suggestion.value);
              const isBlocked = suggestion.status === 'blocked';
              const isDocument = suggestion.status === 'needs_document';
              const percent = toPercent(suggestion.confidence);

              return (
                <div
                  className={`card${accepted ? ' accepted' : ''}${isBlocked ? ' blocked' : ''}`}
                  key={suggestion.fieldId}
                >
                  <div className="card-top">
                    <div className="label">
                      {suggestion.label || <em>Unlabelled field</em>}
                    </div>
                    <span className={`badge ${isBlocked ? 'blocked' : suggestion.band}`}>
                      {isBlocked ? 'protected' : isDocument ? 'your choice' : `${percent}%`}
                    </span>
                  </div>

                  {editing === suggestion.fieldId ? (
                    <textarea
                      className="value"
                      rows={shown.length > 80 ? 5 : 2}
                      value={draft}
                      autoFocus
                      onChange={(event) => setDraft(event.target.value)}
                      aria-label={`Edit value for ${suggestion.label ?? 'field'}`}
                    />
                  ) : (
                    <div className={shown ? 'value' : 'value empty'}>
                      {shown || suggestion.reason || 'No suggestion'}
                    </div>
                  )}

                  <div className="meta">
                    {suggestion.provenance.humanPath && !isBlocked && (
                      <span className="source">Source: {suggestion.provenance.humanPath}</span>
                    )}
                    {suggestion.provenance.usedAI && <span>· drafted by AI</span>}
                    {suggestion.provenance.signals.length > 0 && (
                      <button
                        className="link-btn"
                        onClick={() => setOpenWhy(openWhy === suggestion.fieldId ? null : suggestion.fieldId)}
                      >
                        {openWhy === suggestion.fieldId ? 'Hide evidence' : 'Why?'}
                      </button>
                    )}
                  </div>

                  {openWhy === suggestion.fieldId && (
                    <div className="why">
                      <div>{suggestion.provenance.explanation}</div>
                      {suggestion.provenance.profilePath && (
                        <div className="why-row">
                          <span>Profile path</span>
                          <code>{suggestion.provenance.profilePath}</code>
                        </div>
                      )}
                      {suggestion.provenance.conceptId && (
                        <div className="why-row">
                          <span>Concept</span>
                          <code>{suggestion.provenance.conceptId}</code>
                        </div>
                      )}
                      {suggestion.provenance.signals.slice(0, 4).map((signal, index) => (
                        <div className="why-row" key={`${signal.signal}-${index}`}>
                          <span>{signal.signal}</span>
                          <code>{signal.score.toFixed(2)}</code>
                        </div>
                      ))}
                      {suggestion.validation && !suggestion.validation.valid && (
                        <div className="why-row">
                          <span>Validation</span>
                          <code>{suggestion.validation.message}</code>
                        </div>
                      )}
                    </div>
                  )}

                  {!isBlocked && (
                    <div className="actions">
                      {isDocument ? (
                        <button className="btn" onClick={() => onAttach(suggestion.fieldId)}>
                          Choose file…
                        </button>
                      ) : editing === suggestion.fieldId ? (
                        <>
                          <button className="btn primary" onClick={() => saveEdit(suggestion)}>
                            Save
                          </button>
                          <button className="btn" onClick={() => setEditing(null)}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className={accepted ? 'btn on' : 'btn'}
                            onClick={() => toggle(suggestion.fieldId, !accepted)}
                            disabled={!shown}
                          >
                            {accepted ? 'Accepted' : 'Accept'}
                          </button>
                          <button className="btn" onClick={() => startEdit(suggestion)}>
                            Edit
                          </button>
                          <button className="btn" onClick={() => toggle(suggestion.fieldId, false)} disabled={!accepted}>
                            Reject
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="footer">
        <button className="btn" onClick={acceptAllHigh} disabled={busy || summary.ready === 0}>
          Accept all high
        </button>
        <button className="btn primary" onClick={() => onFill(acceptedList)} disabled={busy || acceptedList.length === 0}>
          {busy ? 'Filling…' : `Fill ${acceptedList.length} field${acceptedList.length === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  );
}

/**
 * Review-panel stylesheet.
 *
 * Shipped as a string and injected into the panel's shadow root rather than as a
 * Tailwind build. Two reasons, both learned from running v1 on third-party pages:
 * a host page's CSS reset can destroy a light-DOM panel, and a programmatically
 * injected script has no stylesheet of its own to load. A shadow root plus one
 * self-contained sheet makes the panel look identical on every site.
 */
export const PANEL_STYLES = `
:host {
  --fp-bg: #0f1117;
  --fp-bg-raised: #171a22;
  --fp-bg-input: #0b0d12;
  --fp-border: #262b36;
  --fp-text: #e8eaf0;
  --fp-text-dim: #9aa2b4;
  --fp-text-faint: #6b7385;
  --fp-accent: #4f7cff;
  --fp-accent-hover: #6a91ff;
  --fp-high: #34d399;
  --fp-medium: #fbbf24;
  --fp-low: #f87171;
  --fp-blocked: #a78bfa;
  all: initial;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

.panel {
  position: fixed;
  top: 16px;
  right: 16px;
  width: 400px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 32px);
  display: flex;
  flex-direction: column;
  background: var(--fp-bg);
  color: var(--fp-text);
  border: 1px solid var(--fp-border);
  border-radius: 14px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55);
  font-size: 13px;
  line-height: 1.5;
  z-index: 2147483000;
  overflow: hidden;
}

.header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  background: var(--fp-bg-raised);
  border-bottom: 1px solid var(--fp-border);
}
.mark {
  width: 26px; height: 26px; flex: none;
  display: grid; place-items: center;
  border-radius: 8px;
  background: rgba(79, 124, 255, 0.14);
  border: 1px solid rgba(79, 124, 255, 0.28);
  color: var(--fp-accent);
}
.title { font-size: 14px; font-weight: 600; letter-spacing: -0.01em; }
.subtitle { font-size: 11px; color: var(--fp-text-faint); }
.spacer { flex: 1; }

.icon-btn {
  appearance: none; border: 0; background: transparent; cursor: pointer;
  color: var(--fp-text-dim); padding: 4px; border-radius: 6px; display: grid; place-items: center;
}
.icon-btn:hover { color: var(--fp-text); background: rgba(255,255,255,0.06); }

.stats { display: flex; gap: 6px; padding: 10px 16px; border-bottom: 1px solid var(--fp-border); flex-wrap: wrap; }
.stat {
  display: flex; align-items: baseline; gap: 5px;
  padding: 3px 9px; border-radius: 999px; font-size: 11px;
  background: var(--fp-bg-raised); border: 1px solid var(--fp-border); color: var(--fp-text-dim);
}
.stat b { font-size: 12px; color: var(--fp-text); font-weight: 600; }
.stat.ready b { color: var(--fp-high); }
.stat.review b { color: var(--fp-medium); }
.stat.manual b { color: var(--fp-low); }
.stat.blocked b { color: var(--fp-blocked); }

.notice {
  margin: 10px 16px 0; padding: 8px 10px; border-radius: 8px; font-size: 11.5px;
  background: rgba(251, 191, 36, 0.08); border: 1px solid rgba(251, 191, 36, 0.25); color: #f4d48a;
}
.notice + .notice { margin-top: 6px; }

.body { flex: 1; overflow-y: auto; padding: 12px 16px 16px; display: flex; flex-direction: column; gap: 10px; }
.body::-webkit-scrollbar { width: 8px; }
.body::-webkit-scrollbar-thumb { background: #2a3040; border-radius: 4px; }

.group-label {
  font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--fp-text-faint); margin-top: 6px; font-weight: 600;
}
.group-label:first-child { margin-top: 0; }

.card {
  border: 1px solid var(--fp-border); border-radius: 10px; padding: 11px 12px;
  background: var(--fp-bg-raised); display: flex; flex-direction: column; gap: 8px;
}
.card.rejected { opacity: 0.5; }
.card.accepted { border-color: rgba(52, 211, 153, 0.45); }
.card.blocked { border-color: rgba(167, 139, 250, 0.35); background: rgba(167, 139, 250, 0.06); }

.card-top { display: flex; align-items: flex-start; gap: 8px; }
.label { font-weight: 550; font-size: 12.5px; flex: 1; word-break: break-word; }
.required { color: var(--fp-low); margin-left: 3px; }

.badge {
  flex: none; font-size: 10.5px; font-weight: 600; padding: 2px 7px;
  border-radius: 999px; white-space: nowrap;
}
.badge.high { color: var(--fp-high); background: rgba(52, 211, 153, 0.12); }
.badge.medium { color: var(--fp-medium); background: rgba(251, 191, 36, 0.12); }
.badge.low { color: var(--fp-low); background: rgba(248, 113, 113, 0.12); }
.badge.blocked { color: var(--fp-blocked); background: rgba(167, 139, 250, 0.14); }

.value {
  font-size: 12.5px; color: var(--fp-text); white-space: pre-wrap; word-break: break-word;
  background: var(--fp-bg-input); border: 1px solid var(--fp-border);
  border-radius: 7px; padding: 7px 9px; min-height: 32px;
}
.value.empty { color: var(--fp-text-faint); font-style: italic; }

textarea.value, input.value {
  width: 100%; font: inherit; font-size: 12.5px; color: var(--fp-text);
  resize: vertical; outline: none;
}
textarea.value:focus, input.value:focus { border-color: var(--fp-accent); }

.meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 11px; color: var(--fp-text-faint); }
.source { color: var(--fp-text-dim); }
.link-btn {
  appearance: none; border: 0; background: transparent; cursor: pointer;
  color: var(--fp-accent); font-size: 11px; padding: 0; text-decoration: none;
}
.link-btn:hover { color: var(--fp-accent-hover); text-decoration: underline; }

.why {
  font-size: 11px; color: var(--fp-text-dim); background: var(--fp-bg-input);
  border: 1px solid var(--fp-border); border-radius: 7px; padding: 8px 9px;
  display: flex; flex-direction: column; gap: 5px;
}
.why-row { display: flex; justify-content: space-between; gap: 10px; }
.why code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10.5px; color: #cfd6e6; }

.actions { display: flex; gap: 6px; }
.btn {
  appearance: none; cursor: pointer; font: inherit; font-size: 11.5px; font-weight: 550;
  padding: 5px 11px; border-radius: 7px; border: 1px solid var(--fp-border);
  background: var(--fp-bg-input); color: var(--fp-text-dim);
}
.btn:hover { color: var(--fp-text); border-color: #38405280; }
.btn.primary { background: var(--fp-accent); border-color: var(--fp-accent); color: #fff; }
.btn.primary:hover { background: var(--fp-accent-hover); }
.btn.on { color: var(--fp-high); border-color: rgba(52, 211, 153, 0.45); }
.btn:disabled { opacity: 0.45; cursor: not-allowed; }

.footer {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 16px; background: var(--fp-bg-raised); border-top: 1px solid var(--fp-border);
}
.footer .btn { padding: 8px 12px; font-size: 12px; }
.footer .btn.primary { flex: 1; justify-content: center; text-align: center; }

.toast {
  margin: 0 16px 12px; padding: 8px 10px; border-radius: 8px; font-size: 11.5px;
  background: rgba(52, 211, 153, 0.1); border: 1px solid rgba(52, 211, 153, 0.3); color: #8ee7c3;
}
.toast.error { background: rgba(248, 113, 113, 0.1); border-color: rgba(248, 113, 113, 0.3); color: #f6a9a9; }

.empty-state { padding: 28px 12px; text-align: center; color: var(--fp-text-dim); display: flex; flex-direction: column; gap: 6px; }
.empty-state small { color: var(--fp-text-faint); }

.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
`;

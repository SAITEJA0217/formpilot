/**
 * Popup — the only place FormPilot is ever invoked from.
 *
 * Opening the popup is what grants `activeTab`, so the engine is injected here and
 * nowhere else. The popup scans, shows what was found, and hands off to the in-page
 * review panel; it never fills anything itself.
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, Loader2, LogIn, Play, Settings, ShieldCheck } from 'lucide-react';
import type { FormSummary } from '../../../shared/messaging/messages';

const DASHBOARD_URL = (import.meta.env.VITE_DASHBOARD_URL as string) || 'http://localhost:3000';
/** Built by `vite.inject.config.ts` at a fixed path so it can be injected by name. */
const ENGINE_BUNDLE = 'injected/universal.js';

interface BackgroundState {
  isAuthenticated: boolean;
  isProfileComplete: boolean;
  hasProfile: boolean;
}

type Phase = 'loading' | 'idle' | 'scanning' | 'scanned' | 'error' | 'unsupported';

function isInjectableUrl(url: string | undefined): boolean {
  if (!url) return false;
  return /^https?:\/\//i.test(url);
}

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/**
 * How long to wait for a liveness ping before injecting anyway.
 *
 * `chrome.tabs.sendMessage` only rejects quickly when *no* listener exists. A page carrying
 * any other extension content script that claims messages it does not answer leaves the port
 * open until Chrome's own ~30s timeout. Injection is idempotent (the engine guards against a
 * second load), so a fast timeout costs nothing and removes a 30-second stall.
 */
const PING_TIMEOUT_MS = 400;

/** Inject the engine if it is not already present in this tab. */
async function ensureEngine(tabId: number): Promise<void> {
  const ping = chrome.tabs
    .sendMessage(tabId, { action: 'PING_CONTENT' })
    .then((response: { ok?: boolean } | undefined) => response?.ok === true)
    .catch(() => false);
  const timeout = new Promise<boolean>((resolve) => {
    setTimeout(() => resolve(false), PING_TIMEOUT_MS);
  });

  if (await Promise.race([ping, timeout])) return;
  await chrome.scripting.executeScript({ target: { tabId }, files: [ENGINE_BUNDLE] });
}

export default function Popup() {
  const [state, setState] = useState<BackgroundState | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [summary, setSummary] = useState<FormSummary | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const [backgroundState, tab] = await Promise.all([
          chrome.runtime.sendMessage({ type: 'GET_STATE' }) as Promise<BackgroundState>,
          activeTab(),
        ]);
        if (cancelled) return;
        setState(backgroundState);
        setPhase(isInjectableUrl(tab?.url) ? 'idle' : 'unsupported');
      } catch {
        if (!cancelled) {
          setState({ isAuthenticated: false, isProfileComplete: false, hasProfile: false });
          setPhase('idle');
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const scan = useCallback(async () => {
    setPhase('scanning');
    setMessage(null);
    try {
      const tab = await activeTab();
      if (!tab?.id || !isInjectableUrl(tab.url)) {
        setPhase('unsupported');
        return;
      }
      await ensureEngine(tab.id);
      const response = (await chrome.tabs.sendMessage(tab.id, { action: 'SCAN_PAGE' })) as
        | { ok: true; summary: FormSummary }
        | { ok: false; error: string };
      if (!response?.ok) {
        setMessage(response?.error ?? 'Could not read this page.');
        setPhase('error');
        return;
      }
      setSummary(response.summary);
      setPhase('scanned');
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'FormPilot could not run on this page. Reload the tab and try again.',
      );
      setPhase('error');
    }
  }, []);

  const openReview = useCallback(async () => {
    const tab = await activeTab();
    if (!tab?.id) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'SHOW_REVIEW_PANEL' });
      window.close();
    } catch {
      setMessage('Could not open the review panel. Reload the tab and try again.');
      setPhase('error');
    }
  }, []);

  const openOptions = useCallback(() => {
    if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
  }, []);

  return (
    <div className="w-80 min-h-[24rem] p-4 bg-[#0f1117] text-[#e8eaf0] flex flex-col font-sans">
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-[#262b36]">
        <div className="flex items-center gap-2">
          <img
            src="/logo-icon.png"
            alt=""
            className="w-7 h-7 object-contain rounded-lg bg-[#4f7cff]/10 p-0.5 border border-[#4f7cff]/25"
          />
          <div>
            <h1 className="text-base font-semibold tracking-tight">FormPilot</h1>
            <p className="text-[10px] text-[#6b7385]">Universal form assistant</p>
          </div>
        </div>
        <button
          onClick={openOptions}
          className="text-[#9aa2b4] hover:text-white transition-colors"
          title="Settings and privacy"
          aria-label="Settings and privacy"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 flex flex-col gap-3">
        {phase === 'loading' && (
          <div className="flex-1 grid place-items-center">
            <Loader2 className="w-5 h-5 animate-spin text-[#9aa2b4]" />
          </div>
        )}

        {phase !== 'loading' && state && !state.isAuthenticated && (
          <Card tone="danger" icon={<LogIn className="w-5 h-5" />} title="Sign in required">
            <p className="text-xs text-[#9aa2b4]">
              Sign in to sync your profile to this device. FormPilot keeps your profile locally and only
              contacts the API when a field needs the assistant.
            </p>
            <Link href={`${DASHBOARD_URL}/login`}>Sign in to FormPilot</Link>
          </Card>
        )}

        {phase !== 'loading' && state?.isAuthenticated && !state.hasProfile && (
          <Card tone="warn" icon={<AlertCircle className="w-5 h-5" />} title="No profile synced">
            <p className="text-xs text-[#9aa2b4]">
              Open your dashboard once so your profile is cached on this device.
            </p>
            <Link href={`${DASHBOARD_URL}/dashboard/profile`}>Open profile</Link>
          </Card>
        )}

        {phase === 'unsupported' && (
          <Card tone="warn" icon={<AlertCircle className="w-5 h-5" />} title="Not available here">
            <p className="text-xs text-[#9aa2b4]">
              FormPilot runs on normal web pages. Browser settings pages, the extensions gallery and
              local files are off-limits to extensions.
            </p>
          </Card>
        )}

        {phase === 'error' && message && (
          <Card tone="danger" icon={<AlertCircle className="w-5 h-5" />} title="Something went wrong">
            <p className="text-xs text-[#9aa2b4]">{message}</p>
          </Card>
        )}

        {phase === 'scanned' && summary && (
          <div className="rounded-xl border border-[#262b36] bg-[#171a22] p-3 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-[#34d399]" />
              <span className="text-sm font-medium">{summary.title || 'Current form'}</span>
            </div>
            <p className="text-[11px] text-[#6b7385] capitalize">
              {summary.platform.replace(/-/g, ' ')}
              {summary.isMultiStep && summary.totalSteps
                ? ` · step ${summary.currentStep ?? '?'} of ${summary.totalSteps}`
                : ''}
            </p>
            <dl className="grid grid-cols-2 gap-1.5 text-xs mt-1">
              <Stat label="Fields detected" value={summary.fieldsDetected} />
              <Stat label="Ready" value={summary.ready} tone="text-[#34d399]" />
              <Stat label="Review needed" value={summary.needsReview} tone="text-[#fbbf24]" />
              <Stat label="Manual" value={summary.manual + summary.noData} tone="text-[#f87171]" />
            </dl>
            {summary.blocked > 0 && (
              <p className="text-[11px] text-[#a78bfa] flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" />
                {summary.blocked} protected field{summary.blocked === 1 ? '' : 's'} will never be autofilled
              </p>
            )}
            {summary.warnings.slice(0, 2).map((warning) => (
              <p className="text-[11px] text-[#f4d48a]" key={warning}>
                {warning}
              </p>
            ))}
          </div>
        )}

        {(phase === 'idle' || phase === 'scanning' || phase === 'scanned' || phase === 'error') && (
          <div className="mt-auto flex flex-col gap-2">
            {phase === 'scanned' ? (
              <button
                onClick={() => void openReview()}
                className="w-full bg-[#4f7cff] hover:bg-[#6a91ff] text-white py-2.5 rounded-lg font-medium text-sm flex items-center justify-center gap-2 transition-colors"
              >
                <Play className="w-4 h-4 fill-current" />
                Review &amp; Fill
              </button>
            ) : (
              <button
                onClick={() => void scan()}
                disabled={phase === 'scanning'}
                className="w-full bg-[#4f7cff] hover:bg-[#6a91ff] disabled:opacity-60 text-white py-2.5 rounded-lg font-medium text-sm flex items-center justify-center gap-2 transition-colors"
              >
                {phase === 'scanning' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Play className="w-4 h-4 fill-current" />
                )}
                {phase === 'scanning' ? 'Analyzing this page…' : 'Scan this page'}
              </button>
            )}
            {phase === 'scanned' && (
              <button
                onClick={() => void scan()}
                className="w-full border border-[#262b36] text-[#9aa2b4] hover:text-white py-2 rounded-lg text-xs transition-colors"
              >
                Re-scan
              </button>
            )}
          </div>
        )}
      </div>

      <div className="mt-3 pt-3 border-t border-[#262b36] text-center">
        <a
          href={`${DASHBOARD_URL}/dashboard`}
          target="_blank"
          rel="noreferrer"
          className="text-[11px] text-[#6b7385] hover:text-white transition-colors"
        >
          Open dashboard
        </a>
      </div>
    </div>
  );
}

function Card({
  tone,
  icon,
  title,
  children,
}: {
  tone: 'danger' | 'warn' | 'ok';
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  const border =
    tone === 'danger' ? 'border-[#f87171]/40' : tone === 'warn' ? 'border-[#fbbf24]/40' : 'border-[#34d399]/40';
  const color = tone === 'danger' ? 'text-[#f87171]' : tone === 'warn' ? 'text-[#fbbf24]' : 'text-[#34d399]';
  return (
    <div className={`rounded-xl border ${border} bg-[#171a22] p-3 flex flex-col gap-2`}>
      <div className={`flex items-center gap-2 ${color}`}>
        {icon}
        <span className="text-sm font-medium text-[#e8eaf0]">{title}</span>
      </div>
      {children}
    </div>
  );
}

function Link({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="mt-1 inline-block text-center bg-white text-[#0f1117] py-1.5 px-3 rounded-md text-xs font-medium hover:bg-[#e8eaf0] transition-colors"
    >
      {children}
    </a>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dd className={`text-sm font-semibold ${tone ?? 'text-[#e8eaf0]'}`}>{value}</dd>
      <dt className="text-[10px] text-[#6b7385]">{label}</dt>
    </div>
  );
}

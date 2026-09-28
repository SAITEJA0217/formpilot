/**
 * Options page — settings and privacy controls.
 *
 * Every control here is about the user's own data: what FormPilot is allowed to
 * send to a model, whether it remembers corrections, and how to get the data out or
 * delete it. Nothing on this page is analytics or telemetry, because there is none.
 */
import { useCallback, useEffect, useState } from 'react';
import { Download, Loader2, ShieldCheck, Trash2 } from 'lucide-react';

interface Settings {
  allowAI: boolean;
  allowCorrectionLearning: boolean;
  highConfidence: number;
  mediumConfidence: number;
}

const DEFAULTS: Settings = {
  allowAI: true,
  allowCorrectionLearning: true,
  highConfidence: 0.9,
  mediumConfidence: 0.7,
};

export default function Options() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [broadAccess, setBroadAccess] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const loaded = (await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' })) as Settings;
        setSettings({ ...DEFAULTS, ...loaded });
      } catch {
        setSettings(DEFAULTS);
      }
      try {
        setBroadAccess(await chrome.permissions.contains({ origins: ['http://*/*', 'https://*/*'] }));
      } catch {
        setBroadAccess(false);
      }
      setLoading(false);
    })();
  }, []);

  const update = useCallback(async (patch: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
    try {
      await chrome.runtime.sendMessage({ type: 'SET_SETTINGS', settings: patch });
      setStatus('Saved');
      setTimeout(() => setStatus(null), 1500);
    } catch {
      setStatus('Could not save that setting');
    }
  }, []);

  const exportData = useCallback(async () => {
    try {
      const result = (await chrome.runtime.sendMessage({ type: 'EXPORT_PROFILE' })) as {
        export: unknown;
      };
      const blob = new Blob([JSON.stringify(result.export, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `formpilot-export-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setStatus('Export downloaded');
    } catch {
      setStatus('Export failed');
    }
  }, []);

  const clearLocal = useCallback(async () => {
    if (!window.confirm('Remove the cached profile, sign-in token, learned corrections and settings from this device?')) {
      return;
    }
    await chrome.runtime.sendMessage({ type: 'CLEAR_LOCAL_DATA' });
    setStatus('Local data cleared. Open the dashboard to sync again.');
  }, []);

  const clearCorrections = useCallback(async () => {
    if (!window.confirm('Delete every correction FormPilot has learned, here and in your account?')) return;
    try {
      await chrome.runtime.sendMessage({ type: 'DELETE_CORRECTIONS' });
      setStatus('Corrections deleted');
    } catch {
      setStatus('Deleted locally; sign in to also delete them from your account.');
    }
  }, []);

  const toggleBroadAccess = useCallback(async () => {
    try {
      if (broadAccess) {
        await chrome.permissions.remove({ origins: ['http://*/*', 'https://*/*'] });
        setBroadAccess(false);
      } else {
        const granted = await chrome.permissions.request({ origins: ['http://*/*', 'https://*/*'] });
        setBroadAccess(granted);
      }
    } catch {
      setStatus('The browser declined that permission change.');
    }
  }, [broadAccess]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0f1117] grid place-items-center">
        <Loader2 className="w-6 h-6 animate-spin text-[#9aa2b4]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f1117] text-[#e8eaf0] py-10 px-6">
      <div className="max-w-2xl mx-auto flex flex-col gap-6">
        <header className="flex items-center gap-3">
          <img src="/logo-icon.png" alt="" className="w-9 h-9 rounded-lg" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">FormPilot settings</h1>
            <p className="text-sm text-[#6b7385]">Your data, your thresholds, your call.</p>
          </div>
          {status && <span className="ml-auto text-xs text-[#34d399]">{status}</span>}
        </header>

        <Section title="Assistant">
          <Toggle
            checked={settings.allowAI}
            onChange={(value) => void update({ allowAI: value })}
            label="Let the assistant draft answers"
            hint="When off, FormPilot only uses deterministic profile matching. No field is ever sent to a model."
          />
          <Toggle
            checked={settings.allowCorrectionLearning}
            onChange={(value) => void update({ allowCorrectionLearning: value })}
            label="Remember my corrections"
            hint="Stores the wording you prefer so the same question is answered your way next time."
          />
        </Section>

        <Section title="Confidence thresholds">
          <p className="text-xs text-[#6b7385] -mt-1">
            Suggestions at or above the high threshold are pre-accepted for you to confirm. Between the two
            thresholds they wait for your review. Below the lower threshold FormPilot asks you to type the value.
          </p>
          <Slider
            label="High confidence"
            value={settings.highConfidence}
            min={0.5}
            max={1}
            onChange={(value) => void update({ highConfidence: value })}
          />
          <Slider
            label="Medium confidence"
            value={settings.mediumConfidence}
            min={0.3}
            max={0.95}
            onChange={(value) => void update({ mediumConfidence: value })}
          />
        </Section>

        <Section title="Site access">
          <div className="flex items-start gap-3">
            <ShieldCheck className="w-4 h-4 text-[#34d399] mt-0.5 shrink-0" />
            <p className="text-xs text-[#9aa2b4]">
              By default FormPilot has no standing access to any website. It reads a page only after you open
              the popup on that tab. You can optionally grant access to all sites, which lets it run without
              opening the popup first.
            </p>
          </div>
          <Toggle
            checked={broadAccess}
            onChange={() => void toggleBroadAccess()}
            label="Allow FormPilot on all sites"
            hint="Optional. Revoking this returns FormPilot to per-click access."
          />
        </Section>

        <Section title="Your data">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => void exportData()}
              className="flex items-center gap-2 text-xs border border-[#262b36] hover:border-[#384052] px-3 py-2 rounded-lg transition-colors"
            >
              <Download className="w-3.5 h-3.5" /> Export my data
            </button>
            <button
              onClick={() => void clearCorrections()}
              className="flex items-center gap-2 text-xs border border-[#262b36] hover:border-[#384052] px-3 py-2 rounded-lg transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete learned corrections
            </button>
            <button
              onClick={() => void clearLocal()}
              className="flex items-center gap-2 text-xs border border-[#f87171]/40 text-[#f87171] hover:bg-[#f87171]/10 px-3 py-2 rounded-lg transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" /> Clear all local data
            </button>
          </div>
          <p className="text-xs text-[#6b7385]">
            To delete your account profile itself, use the dashboard. FormPilot stores no document files and
            never uploads a file you have not picked yourself.
          </p>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[#262b36] bg-[#171a22] p-5 flex flex-col gap-4">
      <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 w-4 h-4 accent-[#4f7cff]"
      />
      <span>
        <span className="block text-sm">{label}</span>
        <span className="block text-xs text-[#6b7385]">{hint}</span>
      </span>
    </label>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex justify-between text-xs">
        <span>{label}</span>
        <span className="text-[#9aa2b4]">{Math.round(value * 100)}%</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={0.01}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="accent-[#4f7cff]"
      />
    </label>
  );
}

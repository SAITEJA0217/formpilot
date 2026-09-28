'use client';

import { useState } from 'react';

/**
 * React multi-step form.
 *
 * Each step replaces the previous one in the DOM, so the engine must re-detect on step
 * change and the session must carry the user's decisions across unmounts.
 */
const STEPS = ['Personal', 'Education', 'Experience', 'Documents', 'Review'] as const;

const field = 'w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-500';
const labelClass = 'block text-xs font-semibold text-slate-300 mt-4 mb-1';

export default function ReactMultiStepForm() {
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});

  const set = (name: string, value: string): void =>
    setValues((previous) => ({ ...previous, [name]: value }));

  const text = (id: string, name: string, label: string, extra: Record<string, string> = {}) => (
    <>
      <label className={labelClass} htmlFor={id}>{label}</label>
      <input id={id} name={name} className={field} value={values[name] ?? ''}
             onChange={(event) => set(name, event.target.value)} {...extra} />
    </>
  );

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 py-14 px-6">
      <div className="max-w-xl mx-auto">
        <h1 className="text-xl font-semibold tracking-tight">React multi-step form</h1>
        <p className="text-sm text-slate-400 mt-1">
          Step {step + 1} of {STEPS.length}. Each step unmounts the previous one.
        </p>

        <ol className="mt-5 flex flex-wrap gap-2" role="tablist">
          {STEPS.map((name, index) => (
            <li key={name} role="tab" data-step={index + 1}
                aria-current={index === step ? 'step' : undefined}
                className={`rounded-full border px-3 py-1 text-xs ${
                  index === step ? 'border-blue-500 text-blue-400 font-semibold' : 'border-slate-800 text-slate-500'
                }`}>
              {name}
            </li>
          ))}
        </ol>

        <form className="mt-6" onSubmit={(event) => event.preventDefault()}>
          <fieldset className="rounded-xl border border-slate-800 p-4" data-step-panel={step + 1}>
            <legend className="px-2 text-sm font-semibold">{STEPS[step]}</legend>

            {step === 0 && (
              <>
                {text('m-name', 'fullName', 'Full Name', { autoComplete: 'name' })}
                {text('m-email', 'email', 'Email Address', { type: 'email', autoComplete: 'email' })}
                {text('m-phone', 'phone', 'Phone Number', { type: 'tel', autoComplete: 'tel' })}
              </>
            )}

            {step === 1 && (
              <>
                {text('m-degree', 'degree', 'Degree')}
                {text('m-branch', 'branch', 'Specialization')}
                {text('m-univ', 'university', 'University')}
                {text('m-year', 'graduationYear', 'Graduation Year')}
              </>
            )}

            {step === 2 && (
              <>
                {text('m-company', 'company', 'Company')}
                {text('m-role', 'jobTitle', 'Role')}
                <label className={labelClass} htmlFor="m-desc">Describe your previous experience</label>
                <textarea id="m-desc" name="experienceDescription" rows={4} className={field}
                          value={values.experienceDescription ?? ''}
                          onChange={(event) => set('experienceDescription', event.target.value)} />
              </>
            )}

            {step === 3 && (
              <>
                <label className={labelClass} htmlFor="m-resume">Upload Resume</label>
                <input id="m-resume" name="resume" type="file" accept=".pdf" className={field} />
                <label className={labelClass} htmlFor="m-cover">Upload Cover Letter</label>
                <input id="m-cover" name="coverLetter" type="file" accept=".pdf" className={field} />
              </>
            )}

            {step === 4 && (
              <>
                <label className={labelClass} htmlFor="m-why">Why should we select you?</label>
                <textarea id="m-why" name="motivation" rows={5} maxLength={1500} className={field}
                          value={values.motivation ?? ''} onChange={(event) => set('motivation', event.target.value)} />
              </>
            )}
          </fieldset>

          <div className="mt-4 flex gap-2">
            <button type="button" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}
                    className="rounded-lg border border-slate-700 px-4 py-2 text-sm disabled:opacity-40">
              Back
            </button>
            <button type="button" onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
                    disabled={step === STEPS.length - 1}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-500 disabled:opacity-40">
              Next
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}

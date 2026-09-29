'use client';

import { useState } from 'react';

/**
 * React controlled form.
 *
 * Every input's value comes from React state, so a plain `element.value = x` assignment
 * is discarded on the next render. This page exists to verify the interaction engine's
 * native-prototype-setter path in a real browser — the mechanism a static page cannot test.
 */
interface FormState {
  fullName: string;
  email: string;
  phone: string;
  degree: string;
  branch: string;
  graduationYear: string;
  company: string;
  jobTitle: string;
  experience: string;
  skills: string[];
  linkedin: string;
  motivation: string;
  agreed: boolean;
}

const EMPTY: FormState = {
  fullName: '',
  email: '',
  phone: '',
  degree: '',
  branch: '',
  graduationYear: '',
  company: '',
  jobTitle: '',
  experience: '',
  skills: [],
  linkedin: '',
  motivation: '',
  agreed: false,
};

const SKILLS = ['React', 'TypeScript', 'Python', 'Node.js', 'AWS'];

const field = 'w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-500';
const labelClass = 'block text-xs font-semibold text-slate-300 mt-4 mb-1';

export default function ReactTestForm() {
  const [state, setState] = useState<FormState>(EMPTY);
  const [submitted, setSubmitted] = useState<FormState | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]): void =>
    setState((previous) => ({ ...previous, [key]: value }));

  const toggleSkill = (skill: string): void =>
    setState((previous) => ({
      ...previous,
      skills: previous.skills.includes(skill)
        ? previous.skills.filter((s) => s !== skill)
        : [...previous.skills, skill],
    }));

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 py-14 px-6">
      <div className="max-w-xl mx-auto">
        <h1 className="text-xl font-semibold tracking-tight">React controlled form</h1>
        <p className="text-sm text-slate-400 mt-1">
          Values are held in React state. If autofill works here, the engine is writing through
          the native value setter rather than around React.
        </p>

        <form
          className="mt-6"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitted(state);
          }}
        >
          <fieldset className="rounded-xl border border-slate-800 p-4">
            <legend className="px-2 text-sm font-semibold">Personal details</legend>
            <label className={labelClass} htmlFor="r-name">Full Name</label>
            <input id="r-name" name="fullName" className={field} autoComplete="name" required
                   value={state.fullName} onChange={(e) => set('fullName', e.target.value)} />

            <label className={labelClass} htmlFor="r-email">Email Address</label>
            <input id="r-email" name="email" type="email" className={field} autoComplete="email" required
                   value={state.email} onChange={(e) => set('email', e.target.value)} />

            <label className={labelClass} htmlFor="r-phone">Phone Number</label>
            <input id="r-phone" name="phone" type="tel" className={field} autoComplete="tel"
                   value={state.phone} onChange={(e) => set('phone', e.target.value)} />
          </fieldset>

          <fieldset className="rounded-xl border border-slate-800 p-4 mt-4">
            <legend className="px-2 text-sm font-semibold">Education</legend>
            <label className={labelClass} htmlFor="r-degree">Highest Qualification</label>
            <select id="r-degree" name="degree" className={field}
                    value={state.degree} onChange={(e) => set('degree', e.target.value)}>
              <option value="">-- Select --</option>
              <option>High School</option>
              <option>Diploma</option>
              <option>Bachelor&apos;s Degree</option>
              <option>Master&apos;s Degree</option>
              <option>PhD</option>
            </select>

            <label className={labelClass} htmlFor="r-branch">Specialization</label>
            <input id="r-branch" name="branch" className={field}
                   value={state.branch} onChange={(e) => set('branch', e.target.value)} />

            <label className={labelClass} htmlFor="r-year">Graduation Year</label>
            <input id="r-year" name="graduationYear" className={field}
                   value={state.graduationYear} onChange={(e) => set('graduationYear', e.target.value)} />
          </fieldset>

          <fieldset className="rounded-xl border border-slate-800 p-4 mt-4">
            <legend className="px-2 text-sm font-semibold">Experience</legend>
            <label className={labelClass} htmlFor="r-company">Current Company</label>
            <input id="r-company" name="company" className={field} autoComplete="organization"
                   value={state.company} onChange={(e) => set('company', e.target.value)} />

            <label className={labelClass} htmlFor="r-title">Job Title</label>
            <input id="r-title" name="jobTitle" className={field} autoComplete="organization-title"
                   value={state.jobTitle} onChange={(e) => set('jobTitle', e.target.value)} />

            <span className={labelClass}>Years of Experience</span>
            <div className="flex flex-wrap gap-4 text-sm" role="group" aria-label="Years of Experience">
              {['0-2 years', '3-5 years', '5+ years'].map((option) => (
                <label key={option} className="flex items-center gap-2 font-normal">
                  <input type="radio" name="experience" value={option} className="accent-blue-500"
                         checked={state.experience === option} onChange={(e) => set('experience', e.target.value)} />
                  {option}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="rounded-xl border border-slate-800 p-4 mt-4">
            <legend className="px-2 text-sm font-semibold">Skills</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              {SKILLS.map((skill) => (
                <label key={skill} className="flex items-center gap-2 font-normal">
                  <input type="checkbox" name="skills" value={skill} className="accent-blue-500"
                         checked={state.skills.includes(skill)} onChange={() => toggleSkill(skill)} />
                  {skill}
                </label>
              ))}
            </div>

            <label className={labelClass} htmlFor="r-linkedin">LinkedIn Profile</label>
            <input id="r-linkedin" name="linkedin" type="url" className={field}
                   value={state.linkedin} onChange={(e) => set('linkedin', e.target.value)} />
          </fieldset>

          <fieldset className="rounded-xl border border-slate-800 p-4 mt-4">
            <legend className="px-2 text-sm font-semibold">Additional</legend>
            <label className={labelClass} htmlFor="r-why">Why do you want to join our team?</label>
            <textarea id="r-why" name="motivation" rows={5} maxLength={1200} className={field}
                      value={state.motivation} onChange={(e) => set('motivation', e.target.value)} />

            <label className="flex items-start gap-2 mt-4 text-xs text-slate-300 font-normal">
              <input type="checkbox" name="agreed" className="mt-0.5 accent-blue-500"
                     checked={state.agreed} onChange={(e) => set('agreed', e.target.checked)} />
              I agree to the Terms and Conditions
            </label>
          </fieldset>

          <button type="submit" className="mt-5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-500">
            Submit application
          </button>
        </form>

        {submitted && (
          <pre className="mt-6 overflow-x-auto rounded-xl border border-slate-800 bg-slate-900 p-4 text-xs text-slate-300">
            {JSON.stringify(submitted, null, 2)}
          </pre>
        )}
      </div>
    </main>
  );
}

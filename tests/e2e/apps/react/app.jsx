/**
 * React 19 controlled-component form.
 *
 * Every input is *controlled*: its `value` comes from React state and React
 * rewrites it on every render. That is the failure mode a naive autofill hits —
 * `element.value = x` is reverted by the next render because React's state never
 * changed. The app therefore exposes `window.__appState()`, which reads the React
 * state rather than the DOM, so a test can tell a real state update apart from a
 * DOM value that merely has not been overwritten yet.
 *
 * `window.__renderCount()` reports how many times React has re-rendered, and
 * `window.__nudge()` forces a render without touching any form state. Together they
 * let a test prove a written value survives React's next render — which is the only
 * way to distinguish a real state update from a DOM value React has not yet reset.
 */
import { useState, useRef, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const EMPTY = {
  fullName: '',
  email: '',
  phone: '',
  company: '',
  jobTitle: '',
  coverLetter: '',
  country: '',
  experience: '',
  newsletter: false,
  terms: false,
};

function Form() {
  const [values, setValues] = useState(EMPTY);
  // Unrelated to the form; bumping it re-renders without changing any field.
  const [nudge, setNudge] = useState(0);
  const renders = useRef(0);
  renders.current += 1;

  window.__appState = () => ({ ...values });
  window.__renderCount = () => renders.current;
  window.__nudge = () => setNudge((n) => n + 1);
  if (window.__submitted === undefined) window.__submitted = false;

  const set = (key) => (event) => {
    const next = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setValues((prev) => ({ ...prev, [key]: next }));
  };

  return (
    <form
      id="react-form"
      onSubmit={(event) => {
        event.preventDefault();
        // Recorded, never acted on: the E2E suite asserts FormPilot never triggers this.
        window.__submitted = true;
      }}
    >
      <h1>React controlled form</h1>

      <label htmlFor="r-name">Full name</label>
      <input id="r-name" name="fullName" type="text" value={values.fullName} onChange={set('fullName')} required />

      <label htmlFor="r-email">Email address</label>
      <input id="r-email" name="email" type="email" value={values.email} onChange={set('email')} required />

      <label htmlFor="r-phone">Phone number</label>
      <input id="r-phone" name="phone" type="tel" value={values.phone} onChange={set('phone')} />

      <label htmlFor="r-company">Current company</label>
      <input id="r-company" name="company" type="text" value={values.company} onChange={set('company')} />

      <label htmlFor="r-title">Job title</label>
      <input id="r-title" name="jobTitle" type="text" value={values.jobTitle} onChange={set('jobTitle')} />

      <label htmlFor="r-cover">Cover letter</label>
      <textarea id="r-cover" name="coverLetter" value={values.coverLetter} onChange={set('coverLetter')} rows={4} />

      <label htmlFor="r-country">Country</label>
      <select id="r-country" name="country" value={values.country} onChange={set('country')}>
        <option value="">Select one</option>
        <option value="India">India</option>
        <option value="United States">United States</option>
        <option value="Germany">Germany</option>
      </select>

      <fieldset>
        <legend>Years of experience</legend>
        {['0-2', '3-5', '6-10'].map((band) => (
          <label key={band}>
            <input
              type="radio"
              name="experience"
              value={band}
              checked={values.experience === band}
              onChange={set('experience')}
            />
            {band}
          </label>
        ))}
      </fieldset>

      <label>
        <input type="checkbox" name="newsletter" checked={values.newsletter} onChange={set('newsletter')} />
        Subscribe to the newsletter
      </label>

      <label>
        <input type="checkbox" name="terms" checked={values.terms} onChange={set('terms')} />
        I accept the terms and conditions
      </label>

      <button type="submit">Submit</button>
      <span data-nudge>{nudge}</span>
    </form>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Form />
  </StrictMode>,
);

/**
 * React 19, the cases the controlled-component app does not reach.
 *
 * `react/app.jsx` holds every value in React state, which is the hard case for *writing* — React
 * reverts a naive `element.value = x` on its next render. This app covers four different things,
 * each of which breaks a different assumption:
 *
 *  1. UNCONTROLLED inputs. No `value` prop, no state: the DOM owns the value and React reads it
 *     through a ref when asked. The opposite failure mode — a write that React never reverts, but
 *     which the app will not see unless the right events fired. `window.__readRefs()` reads through
 *     the refs, so a test can tell an event-bearing write from a silent one.
 *
 *  2. A CUSTOM SELECT built from divs. No `<select>`, no `<option>`: a button, `role="listbox"`, and
 *     options that only exist in the DOM while it is open. A write has to open it, click the option
 *     and read the result back, because there is no value property to set.
 *
 *  3. A CUSTOM CHECKBOX and a CUSTOM RADIO GROUP, also divs, with `aria-checked` and keyboard
 *     handlers. Consent is deliberately on the custom checkbox rather than a native one: the safety
 *     rule has to hold on a control the policy cannot recognise by `type="checkbox"`.
 *
 *  4. NESTED components, where the label is rendered by one component and the input by another,
 *     several levels apart, with a wrapper div between them. Label association survives only if the
 *     engine follows `htmlFor`/`id` or the DOM structure rather than assuming a shared parent.
 *
 * As in the sibling app, nothing is ever submitted anywhere; `window.__submitted` records that
 * FormPilot never triggered a submit.
 */
import { useState, useRef, useId, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

/* ── 1. Uncontrolled: the DOM owns the value ─────────────────────────────────────────── */

function UncontrolledSection({ refs }) {
  return (
    <fieldset>
      <legend>Uncontrolled fields</legend>
      <label htmlFor="u-name">Full name</label>
      {/* No value prop: React never rewrites this, and never learns of a change either. */}
      <input id="u-name" name="fullName" type="text" ref={refs.fullName} defaultValue="" />

      <label htmlFor="u-email">Email address</label>
      <input id="u-email" name="email" type="email" ref={refs.email} defaultValue="" />

      <label htmlFor="u-phone">Phone number</label>
      <input id="u-phone" name="phone" type="tel" ref={refs.phone} defaultValue="" />
    </fieldset>
  );
}

/* ── 2. A select made of divs ────────────────────────────────────────────────────────── */

const COUNTRIES = ['India', 'United States', 'United Kingdom', 'Germany'];

function CustomSelect({ label, options, value, onChange }) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <div className="field">
      <span className="label" id={`${id}-label`}>
        {label}
      </span>
      <div
        role="listbox"
        tabIndex={0}
        aria-labelledby={`${id}-label`}
        aria-expanded={open}
        data-testid="country-listbox"
        onClick={() => setOpen((was) => !was)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') setOpen((was) => !was);
        }}
      >
        {value || 'Select…'}
      </div>
      {/* The options exist only while open, so a write has to open it first. */}
      {open && (
        <div className="options">
          {options.map((option) => (
            <div
              key={option}
              role="option"
              aria-selected={value === option}
              data-value={option}
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
            >
              {option}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── 3. Boolean controls made of divs ────────────────────────────────────────────────── */

function CustomCheckbox({ label, checked, onChange }) {
  return (
    <div
      role="checkbox"
      tabIndex={0}
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onChange(!checked);
      }}
    >
      <span className="box" aria-hidden="true" />
      {label}
    </div>
  );
}

function CustomRadioGroup({ label, options, value, onChange }) {
  const id = useId();
  return (
    <div className="field">
      <span className="label" id={`${id}-label`}>
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={`${id}-label`}>
        {options.map((option) => (
          <div
            key={option}
            role="radio"
            tabIndex={0}
            aria-checked={value === option}
            data-value={option}
            onClick={() => onChange(option)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') onChange(option);
            }}
          >
            <span className="box" aria-hidden="true" />
            {option}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── 4. Label and input in different components, several levels apart ────────────────── */

function FieldLabel({ htmlFor, children }) {
  return <label htmlFor={htmlFor}>{children}</label>;
}

function FieldInput({ id, name, value, onChange }) {
  return <input id={id} name={name} type="text" value={value} onChange={onChange} />;
}

/** A wrapper between the two, so they do not even share an immediate parent. */
function FieldShell({ children }) {
  return (
    <div className="shell">
      <div className="inner">{children}</div>
    </div>
  );
}

function NestedField({ id, name, label, value, onChange }) {
  return (
    <FieldShell>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <FieldShell>
        <FieldInput id={id} name={name} value={value} onChange={onChange} />
      </FieldShell>
    </FieldShell>
  );
}

/* ── The app ─────────────────────────────────────────────────────────────────────────── */

function App() {
  const refs = {
    fullName: useRef(null),
    email: useRef(null),
    phone: useRef(null),
  };
  const [country, setCountry] = useState('');
  const [experience, setExperience] = useState('');
  const [marketing, setMarketing] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [nested, setNested] = useState({ company: '', jobTitle: '' });
  const [nudge, setNudge] = useState(0);
  const renders = useRef(0);
  renders.current += 1;

  // Read through the refs: the value React would see if it asked, not the value in the DOM.
  window.__readRefs = () => ({
    fullName: refs.fullName.current?.value ?? '',
    email: refs.email.current?.value ?? '',
    phone: refs.phone.current?.value ?? '',
  });
  window.__appState = () => ({ country, experience, marketing, agreed, ...nested });
  window.__renderCount = () => renders.current;
  window.__nudge = () => setNudge((n) => n + 1);
  if (window.__submitted === undefined) window.__submitted = false;

  const setNestedField = (key) => (event) =>
    setNested((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <form
      id="widgets-form"
      onSubmit={(event) => {
        event.preventDefault();
        window.__submitted = true;
      }}
    >
      <h1>React custom widgets</h1>

      <UncontrolledSection refs={refs} />

      <fieldset>
        <legend>Custom widgets</legend>
        <CustomSelect label="Country" options={COUNTRIES} value={country} onChange={setCountry} />
        <CustomRadioGroup
          label="Years of experience"
          options={['0-2', '3-5', '6-10']}
          value={experience}
          onChange={setExperience}
        />
        <CustomCheckbox
          label="Send me product updates"
          checked={marketing}
          onChange={setMarketing}
        />
        {/* Consent on a custom control: the safety rule cannot lean on type="checkbox" here. */}
        <CustomCheckbox
          label="I agree to the terms and conditions"
          checked={agreed}
          onChange={setAgreed}
        />
      </fieldset>

      <fieldset>
        <legend>Nested components</legend>
        <NestedField
          id="n-company"
          name="company"
          label="Current company"
          value={nested.company}
          onChange={setNestedField('company')}
        />
        <NestedField
          id="n-title"
          name="jobTitle"
          label="Job title"
          value={nested.jobTitle}
          onChange={setNestedField('jobTitle')}
        />
      </fieldset>

      <button type="submit">Submit application</button>
      <span data-nudge>{nudge}</span>
    </form>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

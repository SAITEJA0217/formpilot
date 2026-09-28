import Link from 'next/link';

/**
 * Test-form corpus index.
 *
 * The static pages live in `public/test-forms/` so the same files serve three purposes:
 * manual browser testing here, jsdom integration tests, and the research benchmark.
 * The React pages are app routes because a static file cannot exercise React's
 * controlled-input value tracking, which is the specific thing they are here to test.
 */
export const metadata = {
  title: 'FormPilot — test form corpus',
  description: 'Local pages for exercising the universal form engine across form architectures.',
};

const STATIC_PAGES = [
  { file: 'basic-html.html', title: 'Basic HTML form', note: 'label[for] + autocomplete. The detection baseline.' },
  { file: 'complex-html.html', title: 'Complex HTML form', note: 'Fieldsets, table layout, selects, radio/checkbox groups, file input, essay question.' },
  { file: 'aria-widgets.html', title: 'ARIA-heavy form', note: 'No native inputs at all — roles, aria-labelledby, contenteditable, custom listbox.' },
  { file: 'ambiguous-labels.html', title: 'Ambiguous labels', note: 'Near-duplicate labels, placeholder-only and name-only fields.' },
  { file: 'dynamic-form.html', title: 'Dynamic form', note: 'Conditional fields added and removed after load.' },
  { file: 'multi-step.html', title: 'Multi-step form', note: 'Five steps, step indicators, hidden panels.' },
  { file: 'shadow-dom.html', title: 'Shadow DOM form', note: 'Open shadow roots including nesting, plus a closed root that must report as unreachable.' },
  { file: 'iframe-form.html', title: 'iframe form', note: 'Same-origin frame (readable) and cross-origin frame (must be reported, not bypassed).' },
  { file: 'google-forms-mock.html', title: 'Google Forms structure', note: 'Regression fixture: every question type the v1 extension supported.' },
  { file: 'sensitive-fields.html', title: 'Fields that must never be autofilled', note: 'Passwords, OTP, card, government id, consent.' },
];

const REACT_PAGES = [
  { href: '/test-forms/react', title: 'React controlled form', note: 'Controlled inputs with React state — exercises the native value-setter path.' },
  { href: '/test-forms/react-multi-step', title: 'React multi-step form', note: 'Client-side wizard where each step unmounts the previous one.' },
];

export default function TestFormsPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 py-14 px-6">
      <div className="max-w-3xl mx-auto flex flex-col gap-8">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Test form corpus</h1>
          <p className="text-sm text-slate-400">
            Ten static pages plus two React pages, covering the form architectures the engine
            claims to handle. Open one, then run FormPilot on it from the extension popup.
          </p>
        </header>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Static pages</h2>
          <ul className="flex flex-col gap-2">
            {STATIC_PAGES.map((page) => (
              <li key={page.file}>
                <a
                  href={`/test-forms/${page.file}`}
                  className="block rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 hover:border-slate-700 transition-colors"
                >
                  <span className="text-sm font-medium">{page.title}</span>
                  <span className="block text-xs text-slate-400 mt-0.5">{page.note}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">React pages</h2>
          <ul className="flex flex-col gap-2">
            {REACT_PAGES.map((page) => (
              <li key={page.href}>
                <Link
                  href={page.href}
                  className="block rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 hover:border-slate-700 transition-colors"
                >
                  <span className="text-sm font-medium">{page.title}</span>
                  <span className="block text-xs text-slate-400 mt-0.5">{page.note}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <p className="text-xs text-slate-500">
          These pages are local test material. No data entered here is submitted anywhere — the
          forms have no action and no handler beyond local state.
        </p>
      </div>
    </main>
  );
}

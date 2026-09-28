/** Load a fixture page from the shared test-form corpus into the jsdom document. */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const CORPUS_DIR = path.resolve(import.meta.dirname, '../../frontend/public/test-forms');

export function fixturePath(name: string): string {
  return path.join(CORPUS_DIR, name);
}

export function readFixture(name: string): string {
  return readFileSync(fixturePath(name), 'utf8');
}

/**
 * Replace the current document with a fixture.
 *
 * jsdom does not execute the fixture's inline `<script>` blocks when HTML is assigned
 * to `document.documentElement.innerHTML`, which is what we want for detection tests:
 * the DOM is exactly the authored markup, with no widget behaviour attached.
 * Tests that need the behaviour attach their own listeners.
 */
export function loadFixture(name: string, options: { url?: string } = {}): void {
  const html = readFixture(name);
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  document.head.innerHTML = headMatch ? stripScripts(headMatch[1]) : '';
  document.body.innerHTML = bodyMatch ? stripScripts(bodyMatch[1]) : stripScripts(html);
  if (options.url) {
    // jsdom's URL is fixed at construction; tests pass `href` to the engine instead.
    document.documentElement.setAttribute('data-test-url', options.url);
  }
}

function stripScripts(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, '');
}

/** Build a document from an inline HTML string. */
export function setBody(html: string): void {
  document.head.innerHTML = '';
  document.body.innerHTML = html;
}

/**
 * Attach the minimal widget behaviour that the fixtures' own inline scripts provide.
 *
 * `loadFixture` strips scripts so detection sees exactly the authored markup. Fill tests
 * need the widgets to actually respond, so they opt into this instead.
 */
export function attachAriaWidgetBehaviour(root: Document | ShadowRoot = document): () => void {
  const handler = (event: Event): void => {
    const target = event.target as Element | null;
    const option = target?.closest('[role="radio"],[role="checkbox"],[role="switch"]');
    if (!option) return;
    if (option.getAttribute('role') === 'radio') {
      const scope = option.closest('[role="row"]') ?? option.closest('[role="radiogroup"]') ?? option.parentElement;
      scope?.querySelectorAll('[role="radio"]').forEach((sibling) => sibling.setAttribute('aria-checked', 'false'));
      option.setAttribute('aria-checked', 'true');
    } else {
      option.setAttribute('aria-checked', option.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
    }
  };
  root.addEventListener('click', handler);
  return () => root.removeEventListener('click', handler);
}

/**
 * Emulate the custom-listbox behaviour the fixtures' own scripts provide: clicking the
 * control reveals the options, clicking an option selects it, and the control reflects it.
 */
export function attachListboxBehaviour(root: Document = document): () => void {
  const handler = (event: Event): void => {
    const target = event.target as Element | null;
    const control = target?.closest('[role="listbox"]');
    if (control) {
      const panel = control.parentElement?.querySelector('[data-options]') as HTMLElement | null;
      if (panel) panel.hidden = !panel.hidden;
      return;
    }
    const option = target?.closest('[role="option"]');
    if (!option) return;
    const panel = option.closest('[data-options]') as HTMLElement | null;
    if (!panel) return;
    const listbox = panel.parentElement?.querySelector('[role="listbox"]');
    if (!listbox) return;
    panel.querySelectorAll('[role="option"]').forEach((other) => {
      other.setAttribute('aria-selected', String(other === option));
    });
    listbox.textContent = option.textContent;
    panel.hidden = true;
  };
  root.addEventListener('click', handler);
  return () => root.removeEventListener('click', handler);
}

/**
 * Dynamic forms: the MutationObserver path and non-destructive re-scanning.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeForm } from '../../extension/src/core/normalize/formNormalizer';
import { observeForm, type MutationSummary } from '../../extension/src/core/observe/observer';
import { buildSuggestions } from '../../shared/matching/pipeline';
import { applySession, createSession, recordDecision } from '../../extension/src/core/session/formSession';
import { loadFixture, setBody } from '../helpers/dom';
import { TEST_PROFILE } from '../helpers/profile';

const URL_ = 'https://jobs.example.test/apply';

describe('observeForm', () => {
  let stop: () => void = () => {};

  beforeEach(() => {
    vi.useFakeTimers();
    setBody(`<form id="f"><label for="a">Full Name</label><input id="a" /></form>`);
  });

  afterEach(() => {
    stop();
    vi.useRealTimers();
  });

  const collect = (debounceMs = 50): MutationSummary[] => {
    const seen: MutationSummary[] = [];
    stop = observeForm({ debounceMs, onChange: (summary) => seen.push(summary) });
    return seen;
  };

  it('reports controls added after load', async () => {
    const seen = collect();
    const form = document.querySelector('#f')!;
    form.insertAdjacentHTML('beforeend', `<label for="b">Email Address</label><input id="b" />`);
    await vi.advanceTimersByTimeAsync(80);

    expect(seen).toHaveLength(1);
    expect(seen[0].addedControls).toBe(1);
    expect(seen[0].removedControls).toBe(0);
  });

  it('reports controls removed', async () => {
    const seen = collect();
    document.querySelector('#a')!.remove();
    await vi.advanceTimersByTimeAsync(80);
    expect(seen[0].removedControls).toBe(1);
  });

  it('ignores mutations that cannot affect the field set', async () => {
    const seen = collect();
    document.querySelector('#f')!.insertAdjacentHTML('beforeend', `<p>Some copy</p>`);
    document.querySelector('#a')!.setAttribute('data-noise', '1');
    await vi.advanceTimersByTimeAsync(80);
    expect(seen).toHaveLength(0);
  });

  it('does not fire for typing into an existing field', async () => {
    const seen = collect();
    const input = document.querySelector<HTMLInputElement>('#a')!;
    input.value = 'typing';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(80);
    expect(seen).toHaveLength(0);
  });

  it('debounces a burst of mutations into a single report', async () => {
    const seen = collect(60);
    const form = document.querySelector('#f')!;
    for (let i = 0; i < 5; i += 1) {
      form.insertAdjacentHTML('beforeend', `<input id="x${i}" aria-label="Field ${i}" />`);
      await vi.advanceTimersByTimeAsync(10);
    }
    await vi.advanceTimersByTimeAsync(80);
    expect(seen).toHaveLength(1);
    expect(seen[0].addedControls).toBe(5);
  });

  it('localizes the change to a region so a re-scan need not walk the page', async () => {
    setBody(`
      <form id="f"><fieldset id="s1"><input aria-label="A" /></fieldset>
      <fieldset id="s2"><input aria-label="B" /></fieldset></form>`);
    const seen = collect();
    document.querySelector('#s2')!.insertAdjacentHTML('beforeend', `<input aria-label="C" />`);
    await vi.advanceTimersByTimeAsync(80);

    expect(seen[0].regions.map((r) => r.id)).toEqual(['s2']);
    expect(seen[0].requiresFullRescan).toBe(false);
  });

  it('asks for a full re-scan when the change is too broad to localize', async () => {
    setBody(`<div id="root"></div>`);
    const seen = collect();
    const root = document.querySelector('#root')!;
    for (let i = 0; i < 12; i += 1) {
      root.insertAdjacentHTML('beforeend', `<section id="s${i}"><input aria-label="F${i}" /></section>`);
    }
    await vi.advanceTimersByTimeAsync(80);
    expect(seen[0].requiresFullRescan).toBe(true);
  });

  it('notices an attribute change that reveals or disables a control', async () => {
    setBody(`<form id="f"><fieldset id="s"><input id="a" aria-label="A" /></fieldset></form>`);
    const seen = collect();
    document.querySelector('#a')!.setAttribute('disabled', '');
    await vi.advanceTimersByTimeAsync(80);
    expect(seen[0].attributeChanges).toBeGreaterThan(0);
  });

  it('stops reporting once disconnected', async () => {
    const seen = collect();
    stop();
    document.querySelector('#f')!.insertAdjacentHTML('beforeend', `<input aria-label="New" />`);
    await vi.advanceTimersByTimeAsync(80);
    expect(seen).toHaveLength(0);
  });
});

describe('re-scanning a dynamic form', () => {
  beforeEach(() => loadFixture('dynamic-form.html'));

  it('detects only the fields present before the user interacts', () => {
    const { form } = normalizeForm({ href: URL_ });
    expect(form.fields.map((f) => f.label)).toEqual(['Full Name', 'Employment Status']);
  });

  it('picks up conditional fields once they are rendered', () => {
    const before = normalizeForm({ href: URL_ }).form.fields.length;
    document.querySelector('#conditional')!.innerHTML = `
      <label for="d-company">Current Company</label>
      <input id="d-company" name="company" autocomplete="organization" />
      <label for="d-title">Job Title</label>
      <input id="d-title" name="job_title" autocomplete="organization-title" />`;

    const { form } = normalizeForm({ href: URL_ });
    expect(form.fields.length).toBe(before + 2);
    const byLabel = new Map(buildSuggestions(form, TEST_PROFILE).suggestions.map((s) => [s.label, s]));
    expect(byLabel.get('Current Company')?.value).toBe('Nexturn Solutions');
    expect(byLabel.get('Job Title')?.value).toBe('Software Engineer');
  });

  it('keeps a user edit through a re-scan that changes generated ids', () => {
    const first = normalizeForm({ href: URL_ });
    let session = createSession(first.form);
    const { suggestions } = buildSuggestions(first.form, TEST_PROFILE);
    const name = suggestions.find((s) => s.label === 'Full Name')!;
    session = recordDecision(session, first.form, { ...name, value: 'Preferred Name' }, {
      accepted: true,
      edited: true,
      previousValue: name.value as string,
    });

    // The page re-renders with extra fields ahead of the name field.
    document.querySelector('#conditional')!.innerHTML = `
      <label for="d-college">College Name</label><input id="d-college" name="college" />`;
    const second = normalizeForm({ href: URL_ });
    const restored = applySession(session, second.form, buildSuggestions(second.form, TEST_PROFILE).suggestions);

    const restoredName = restored.find((s) => s.label === 'Full Name')!;
    expect(restoredName.value).toBe('Preferred Name');
    expect(restoredName.editedByUser).toBe(true);
    // The newly revealed field is suggested normally.
    expect(restored.find((s) => s.label === 'College Name')?.value).toBe('Vasavi College of Engineering');
  });

  it('drops fields that disappeared, without losing the rest', () => {
    document.querySelector('#conditional')!.innerHTML = `<label for="x">College Name</label><input id="x" />`;
    expect(normalizeForm({ href: URL_ }).form.fields.map((f) => f.label)).toContain('College Name');
    document.querySelector('#conditional')!.innerHTML = '';
    const after = normalizeForm({ href: URL_ }).form;
    expect(after.fields.map((f) => f.label)).not.toContain('College Name');
    expect(after.fields.map((f) => f.label)).toContain('Full Name');
  });
});

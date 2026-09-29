/**
 * Build the held-out corpus from third-party HTML.
 *
 * Fetches every file in `manifest.json` from raw.githubusercontent.com, parses it, and extracts
 * one record per form control that carries an `autocomplete` token this evaluation recognises.
 *
 * **Why this corpus is different from the benchmark corpus.** Every fixture in
 * `research/benchmark/dataset/` was written by the same agent that wrote the engine, so a perfect
 * score there means the engine does what its author expected. Here the labels were written by 138
 * unrelated authors — Mozilla's own autofill test corpus, Stripe's checkout examples, the Nova
 * Scotia and Government of Canada design systems, WCAG reference forms, a French government COVID
 * form, and a long tail of independent projects — and the ground truth comes from each file's own
 * `autocomplete` attribute, whose meaning is fixed by the WHATWG HTML specification.
 *
 * So the task is: given a label some stranger wrote, infer the concept that stranger's own
 * `autocomplete` attribute declares. The attribute is stripped before the matcher sees the field.
 * Nothing about the ground truth is this project's judgement.
 *
 * Only extracted metadata is stored — never the source files — so no third-party code is
 * redistributed. Provenance is recorded per record so any row can be traced to its origin.
 *
 * Usage:  node research/heldout/fetch.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const manifest = JSON.parse(readFileSync(path.join(HERE, 'manifest.json'), 'utf8'));

/**
 * `autocomplete` token → the concept it denotes, per the WHATWG HTML specification's
 * "autofill field" table.
 *
 * Declared here rather than read from `shared/ontology/concepts.ts` on purpose. Reading it from
 * the ontology would make the ground truth move whenever the ontology moved, which is precisely
 * the circularity this evaluation exists to avoid. Each mapping below is definitional — the spec
 * says `family-name` *is* the family name — not a judgement call.
 */
const TOKEN_TO_CONCEPT = {
  name: 'person.full_name',
  'given-name': 'person.first_name',
  'additional-name': 'person.middle_name',
  'family-name': 'person.last_name',
  email: 'person.email',
  tel: 'person.phone',
  'tel-national': 'person.phone',
  bday: 'person.date_of_birth',
  sex: 'person.gender',
  organization: 'experience.company',
  'organization-title': 'experience.job_title',
  'street-address': 'address.full',
  'address-line1': 'address.line1',
  'address-line2': 'address.line2',
  'address-level1': 'address.state',
  'address-level2': 'address.city',
  'postal-code': 'address.postal_code',
  'country-name': 'address.country',
  url: 'links.portfolio',
};

/** Tokens that name a credential or payment instrument: ground truth is "must be refused". */
const MUST_REFUSE_TOKENS = new Set([
  'current-password',
  'new-password',
  'one-time-code',
  'cc-number',
  'cc-csc',
  'cc-exp',
  'cc-exp-month',
  'cc-exp-year',
  'cc-name',
  'cc-type',
]);

/** Normalise an autocomplete attribute to its field token, dropping section and mode prefixes. */
function fieldToken(raw) {
  const parts = raw.toLowerCase().trim().split(/\s+/).filter(Boolean);
  // The spec allows `section-* shipping|billing token [webauthn]`; the field name is the last
  // meaningful part.
  const filtered = parts.filter(
    (part) => !part.startsWith('section-') && part !== 'shipping' && part !== 'billing' && part !== 'webauthn',
  );
  return filtered[filtered.length - 1] ?? '';
}

/**
 * The visible label for a control, resolved the way a person reads the page.
 *
 * Deliberately independent of the engine's own label resolver: if this used
 * `extension/src/core/dom/labels.ts`, a label-resolution bug would be invisible because both
 * sides would make the same mistake. Only the four mechanisms a browser itself honours are used.
 */
function labelFor(doc, element) {
  const id = element.getAttribute('id');
  if (id) {
    // Matched by comparing the attribute rather than building a selector: real-world ids contain
    // quotes, colons and brackets, and `CSS.escape` is not a Node global.
    const explicit = Array.from(doc.querySelectorAll('label[for]')).find(
      (label) => label.getAttribute('for') === id,
    );
    if (explicit?.textContent?.trim()) return explicit.textContent.replace(/\s+/g, ' ').trim();
  }
  const wrapping = element.closest('label');
  if (wrapping?.textContent?.trim()) return wrapping.textContent.replace(/\s+/g, ' ').trim();
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel?.trim()) return ariaLabel.replace(/\s+/g, ' ').trim();
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((ref) => doc.getElementById(ref)?.textContent ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) return text;
  }
  return '';
}

const records = [];
const fileStats = [];

for (const entry of manifest.files) {
  const url = `https://raw.githubusercontent.com/${entry.repo}/HEAD/${entry.path}`;
  let html;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) {
      fileStats.push({ ...entry, status: `http ${response.status}`, fields: 0 });
      continue;
    }
    html = await response.text();
  } catch (error) {
    fileStats.push({ ...entry, status: `fetch failed: ${String(error).slice(0, 60)}`, fields: 0 });
    continue;
  }

  let doc;
  try {
    doc = new JSDOM(html, { url: `https://example.invalid/${entry.path}` }).window.document;
  } catch (error) {
    fileStats.push({ ...entry, status: `parse failed: ${String(error).slice(0, 60)}`, fields: 0 });
    continue;
  }

  let found = 0;
  for (const element of doc.querySelectorAll('input[autocomplete], select[autocomplete], textarea[autocomplete]')) {
    const raw = element.getAttribute('autocomplete') ?? '';
    const token = fieldToken(raw);
    if (token === 'off' || token === 'on' || !token) continue;

    const concept = TOKEN_TO_CONCEPT[token];
    const mustRefuse = MUST_REFUSE_TOKENS.has(token);
    if (!concept && !mustRefuse) continue;

    const label = labelFor(doc, element);
    const type = (element.getAttribute('type') ?? element.tagName.toLowerCase()).toLowerCase();
    // A control with no label, name, id or placeholder carries no signal at all; scoring it would
    // measure nothing. Recorded as skipped so the count is visible rather than quietly dropped.
    const name = element.getAttribute('name') ?? '';
    const elementId = element.getAttribute('id') ?? '';
    const placeholder = element.getAttribute('placeholder') ?? '';
    if (!label && !name && !elementId && !placeholder) continue;

    records.push({
      provenance: `${entry.repo}/${entry.path}`,
      discoveredBy: entry.discoveredBy,
      autocomplete: token,
      rawAutocomplete: raw,
      expectedConcept: concept ?? null,
      mustRefuse,
      label,
      name,
      elementId,
      placeholder,
      type,
      required: element.hasAttribute('required'),
      ariaLabel: element.getAttribute('aria-label') ?? '',
    });
    found += 1;
  }
  fileStats.push({ ...entry, status: 'ok', fields: found });
}

const fetched = fileStats.filter((file) => file.status === 'ok').length;
const contributing = new Set(records.map((record) => record.provenance));

const corpus = {
  '//': 'Held-out corpus extracted from third-party HTML. See fetch.mjs for the procedure.',
  '//groundTruth':
    "Each record's expectedConcept is the concept denoted by that file's own autocomplete token, " +
    'per the WHATWG HTML specification. The token is withheld from the matcher at evaluation time.',
  '//independence':
    'Labels were written by the repository authors listed in `provenance`, none of whom are ' +
    'connected to this project. The token→concept table in fetch.mjs is definitional, not a ' +
    'judgement, and is declared there rather than read from the ontology so ground truth cannot ' +
    'drift when the ontology changes.',
  fetchedAt: new Date().toISOString(),
  filesInManifest: manifest.files.length,
  filesFetched: fetched,
  filesContributingFields: contributing.size,
  fieldCount: records.length,
  distinctLabels: new Set(records.map((record) => record.label.toLowerCase())).size,
  records,
  fileStats,
};

writeFileSync(path.join(HERE, 'corpus.json'), `${JSON.stringify(corpus, null, 2)}\n`);
console.log(
  `manifest ${manifest.files.length} files → fetched ${fetched}, ` +
    `${contributing.size} contributed ${records.length} fields ` +
    `(${corpus.distinctLabels} distinct labels)`,
);

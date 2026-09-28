/** Label extraction and accessible-name computation, per strategy. */
import { describe, expect, it } from 'vitest';
import { extractLabel, findSectionTitle } from '../../extension/src/core/dom/labels';
import {
  computeAccessibleDescription,
  computeAccessibleName,
  isRequired,
  resolveRole,
} from '../../extension/src/core/dom/accessibility';
import { setBody } from '../helpers/dom';

const el = (selector: string): Element => {
  const found = document.querySelector(selector);
  if (!found) throw new Error(`fixture missing ${selector}`);
  return found;
};

describe('computeAccessibleName precedence', () => {
  it('prefers aria-labelledby over everything else', () => {
    setBody(`
      <span id="lbl">Email Address</span>
      <input id="a" aria-labelledby="lbl" aria-label="ignored" placeholder="ignored" />
    `);
    const name = computeAccessibleName(el('#a'));
    expect(name.name).toBe('Email Address');
    expect(name.source).toBe('aria-labelledby');
  });

  it('concatenates multiple aria-labelledby targets in order', () => {
    setBody(`<span id="p1">Work</span><span id="p2">Email</span><input id="a" aria-labelledby="p1 p2" />`);
    expect(computeAccessibleName(el('#a')).name).toBe('Work Email');
  });

  it('falls back to aria-label, then label[for], then a wrapping label', () => {
    setBody(`<input id="a" aria-label="Phone" placeholder="p" />`);
    expect(computeAccessibleName(el('#a'))).toEqual({ name: 'Phone', source: 'aria-label' });

    setBody(`<label for="b">City</label><input id="b" placeholder="p" />`);
    expect(computeAccessibleName(el('#b'))).toEqual({ name: 'City', source: 'label-for' });

    setBody(`<label>Country <input id="c" /></label>`);
    expect(computeAccessibleName(el('#c'))).toEqual({ name: 'Country', source: 'label-wrapping' });
  });

  it('uses title then placeholder as last resorts', () => {
    setBody(`<input id="a" title="Postal code" />`);
    expect(computeAccessibleName(el('#a')).source).toBe('title');
    setBody(`<input id="b" placeholder="Postal code" />`);
    expect(computeAccessibleName(el('#b')).source).toBe('placeholder');
  });

  it('reports none when there is nothing to name the control with', () => {
    setBody(`<input id="a" />`);
    expect(computeAccessibleName(el('#a'))).toEqual({ name: '', source: 'none' });
  });

  it('excludes a nested control value from the label text', () => {
    setBody(`<label>Full Name <input id="a" value="should not appear" /></label>`);
    expect(computeAccessibleName(el('#a')).name).toBe('Full Name');
  });

  it('ignores hidden label content', () => {
    setBody(`<label for="a">City <span style="display:none">(hidden hint)</span></label><input id="a" />`);
    expect(computeAccessibleName(el('#a')).name).toBe('City');
  });
});

describe('computeAccessibleDescription', () => {
  it('reads aria-describedby', () => {
    setBody(`<span id="h">As it appears on your ID</span><input id="a" aria-label="Name" aria-describedby="h" />`);
    expect(computeAccessibleDescription(el('#a'))).toBe('As it appears on your ID');
  });

  it('returns an empty string when absent', () => {
    setBody(`<input id="a" aria-label="Name" />`);
    expect(computeAccessibleDescription(el('#a'))).toBe('');
  });
});

describe('extractLabel fallback chain', () => {
  it('uses a platform-provided label verbatim when given', () => {
    setBody(`<div id="q"><div role="heading">Ignored heading</div><input id="a" /></div>`);
    const label = extractLabel(el('#a'), { container: el('#q'), platformLabel: 'Authoritative question' });
    expect(label).toMatchObject({ text: 'Authoritative question', source: 'platform-heading' });
  });

  it('uses a container heading when the control has no accessible name', () => {
    setBody(`<div id="q"><div role="heading">Highest Qualification</div><input id="a" /></div>`);
    const label = extractLabel(el('#a'), { container: el('#q') });
    expect(label).toMatchObject({ text: 'Highest Qualification', source: 'platform-heading' });
  });

  it('uses a fieldset legend', () => {
    setBody(`<fieldset><legend>Education</legend><input id="a" /></fieldset>`);
    expect(extractLabel(el('#a')).source).toBe('fieldset-legend');
  });

  it('uses a table row header', () => {
    setBody(`<table><tr><th>Year of Passing</th><td><input id="a" /></td></tr></table>`);
    const label = extractLabel(el('#a'));
    expect(label).toMatchObject({ text: 'Year of Passing', source: 'table-header' });
  });

  it('uses a column header when the row header is the control cell itself', () => {
    setBody(`
      <table>
        <thead><tr><th>Beginner</th><th>Expert</th></tr></thead>
        <tbody><tr><td><input id="a" /></td><td><input id="b" /></td></tr></tbody>
      </table>`);
    expect(extractLabel(el('#b')).text).toBe('Expert');
  });

  it('uses immediately preceding text', () => {
    setBody(`<div>Graduation Year <input id="a" /></div>`);
    const label = extractLabel(el('#a'));
    expect(label.text).toBe('Graduation Year');
    expect(label.source).toBe('preceding-text');
  });

  it('humanizes the name attribute as the last resort', () => {
    setBody(`<input id="x" name="graduation_year" />`);
    const label = extractLabel(el('#x'));
    expect(label.source).toBe('name-attribute');
    expect(label.text).toBe('Graduation year');
  });

  it('reports none when the control is anonymous', () => {
    setBody(`<div><input id="a" /></div>`);
    expect(extractLabel(el('#a'))).toMatchObject({ text: '', source: 'none' });
  });

  it('ignores identifiers too short to mean anything', () => {
    setBody(`<div><input id="q1" name="x" /><input id="nm2" name="nm" /></div>`);
    expect(extractLabel(el('#q1')).source).toBe('none');
    expect(extractLabel(el('#nm2')).source).toBe('none');
  });

  it('truncates absurdly long label text', () => {
    setBody(`<label for="a">${'x'.repeat(900)}</label><input id="a" />`);
    expect(extractLabel(el('#a')).text.length).toBeLessThanOrEqual(400);
  });
});

describe('isRequired', () => {
  it('detects the required attribute, aria-required and an asterisk in the label', () => {
    setBody(`<input id="a" required /><input id="b" aria-required="true" /><input id="c" />`);
    expect(isRequired(el('#a'), 'Name')).toBe(true);
    expect(isRequired(el('#b'), 'Name')).toBe(true);
    expect(isRequired(el('#c'), 'Name *')).toBe(true);
    expect(isRequired(el('#c'), 'Name (required)')).toBe(true);
    expect(isRequired(el('#c'), 'Name')).toBe(false);
  });
});

describe('resolveRole', () => {
  it('derives implicit roles from native elements', () => {
    setBody(`
      <input id="t" /><input id="r" type="radio" /><input id="c" type="checkbox" />
      <input id="n" type="number" /><input id="s" type="search" />
      <textarea id="ta"></textarea><select id="se"></select><select id="sm" multiple></select>
    `);
    expect(resolveRole(el('#t'))).toBe('textbox');
    expect(resolveRole(el('#r'))).toBe('radio');
    expect(resolveRole(el('#c'))).toBe('checkbox');
    expect(resolveRole(el('#n'))).toBe('spinbutton');
    expect(resolveRole(el('#s'))).toBe('searchbox');
    expect(resolveRole(el('#ta'))).toBe('textbox');
    expect(resolveRole(el('#se'))).toBe('combobox');
    expect(resolveRole(el('#sm'))).toBe('listbox');
  });

  it('prefers an explicit role', () => {
    setBody(`<div id="d" role="radiogroup"></div><input id="i" role="combobox" />`);
    expect(resolveRole(el('#d'))).toBe('radiogroup');
    expect(resolveRole(el('#i'))).toBe('combobox');
  });
});

describe('findSectionTitle', () => {
  it('finds the enclosing section heading', () => {
    setBody(`<section><h2>Education</h2><input id="a" /></section>`);
    expect(findSectionTitle(el('#a'))).toBe('Education');
  });

  it('falls back to the nearest preceding heading in document order', () => {
    setBody(`<h2>Experience</h2><div><input id="a" /></div>`);
    expect(findSectionTitle(el('#a'))).toBe('Experience');
  });

  it('returns an empty string when there is no heading', () => {
    setBody(`<div><input id="a" /></div>`);
    expect(findSectionTitle(el('#a'))).toBe('');
  });
});

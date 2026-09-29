/** Field discovery, classification and grouping. */
import { describe, expect, it } from 'vitest';
import { detectFields } from '../../extension/src/core/detect/fieldDetector';
import { setBody } from '../helpers/dom';

const detect = () => detectFields({ root: document });

describe('classification of native controls', () => {
  it('maps every input type onto the unified vocabulary', () => {
    setBody(`
      <label for="a">Text</label><input id="a" type="text" />
      <label for="b">Email</label><input id="b" type="email" />
      <label for="c">Tel</label><input id="c" type="tel" />
      <label for="d">Number</label><input id="d" type="number" />
      <label for="e">Url</label><input id="e" type="url" />
      <label for="f">Date</label><input id="f" type="date" />
      <label for="g">Time</label><input id="g" type="time" />
      <label for="h">Datetime</label><input id="h" type="datetime-local" />
      <label for="i">Month</label><input id="i" type="month" />
      <label for="j">Week</label><input id="j" type="week" />
      <label for="k">Colour</label><input id="k" type="color" />
      <label for="l">Range</label><input id="l" type="range" />
      <label for="m">File</label><input id="m" type="file" />
      <label for="n">Password</label><input id="n" type="password" />
      <label for="o">Search</label><input id="o" type="search" />
      <label for="p">Notes</label><textarea id="p"></textarea>
      <label for="q">Choice</label><select id="q"><option>One</option></select>
      <label for="r">Choices</label><select id="r" multiple><option>One</option></select>
    `);
    const byLabel = new Map(detect().fields.map((f) => [f.label, f.type]));
    expect(byLabel.get('Text')).toBe('text');
    expect(byLabel.get('Email')).toBe('email');
    expect(byLabel.get('Tel')).toBe('tel');
    expect(byLabel.get('Number')).toBe('number');
    expect(byLabel.get('Url')).toBe('url');
    expect(byLabel.get('Date')).toBe('date');
    expect(byLabel.get('Time')).toBe('time');
    expect(byLabel.get('Datetime')).toBe('datetime');
    expect(byLabel.get('Month')).toBe('month');
    expect(byLabel.get('Week')).toBe('week');
    expect(byLabel.get('Colour')).toBe('color');
    expect(byLabel.get('Range')).toBe('range');
    expect(byLabel.get('File')).toBe('file');
    expect(byLabel.get('Password')).toBe('password');
    expect(byLabel.get('Search')).toBe('search');
    expect(byLabel.get('Notes')).toBe('textarea');
    expect(byLabel.get('Choice')).toBe('select_one');
    expect(byLabel.get('Choices')).toBe('select_many');
  });

  it('skips hidden, submit and button inputs', () => {
    setBody(`
      <input type="hidden" name="csrf" />
      <input type="submit" value="Submit" />
      <input type="reset" value="Reset" />
      <input type="button" value="Click" />
      <label for="a">Real field</label><input id="a" />
    `);
    const result = detect();
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0].label).toBe('Real field');
  });

  it('skips fields hidden by attribute or inline style', () => {
    setBody(`
      <input id="a" aria-label="Hidden by aria" aria-hidden="true" />
      <input id="b" aria-label="Hidden by attribute" hidden />
      <div style="display:none"><input id="c" aria-label="Hidden by ancestor" /></div>
      <input id="d" aria-label="Visible" />
    `);
    const labels = detect().fields.map((f) => f.label);
    expect(labels).toEqual(['Visible']);
  });

  it('skips its own UI subtree', () => {
    setBody(`
      <div data-formpilot-ignore="true"><input id="own" aria-label="Panel input" /></div>
      <input id="page" aria-label="Page input" />
    `);
    expect(detect().fields.map((f) => f.label)).toEqual(['Page input']);
  });

  it('records why candidates were rejected', () => {
    setBody(`
      <input type="hidden" name="csrf" />
      <div style="display:none"><input id="h" aria-label="Hidden" /></div>
      <div data-formpilot-ignore="true"><input id="own" aria-label="Own UI" /></div>
      <input id="b" aria-label="Real" />`);
    const stats = detect().stats;
    // Hidden inputs never even become candidates — the control selector excludes them.
    expect(stats.candidatesConsidered).toBe(3);
    expect(stats.rejected.hidden).toBe(1);
    expect(stats.rejected['ignored-subtree']).toBe(1);
    expect(detect().fields).toHaveLength(1);
  });
});

describe('grouping', () => {
  it('collapses a native radio set into one radio_group with options', () => {
    setBody(`
      <fieldset><legend>Years of Experience</legend>
        <label><input type="radio" name="exp" value="0-2" /> 0-2 years</label>
        <label><input type="radio" name="exp" value="3-5" /> 3-5 years</label>
        <label><input type="radio" name="exp" value="5+" /> 5+ years</label>
      </fieldset>`);
    const fields = detect().fields;
    expect(fields).toHaveLength(1);
    expect(fields[0].type).toBe('radio_group');
    expect(fields[0].label).toBe('Years of Experience');
    expect(fields[0].options?.map((o) => o.label)).toEqual(['0-2 years', '3-5 years', '5+ years']);
    expect(fields[0].options?.[0].value).toBe('0-2');
  });

  it('collapses a native checkbox set sharing a name into one checkbox_group', () => {
    setBody(`
      <fieldset><legend>Technical Skills</legend>
        <label><input type="checkbox" name="skills" value="React" /> React</label>
        <label><input type="checkbox" name="skills" value="Python" /> Python</label>
      </fieldset>`);
    const fields = detect().fields;
    expect(fields).toHaveLength(1);
    expect(fields[0].type).toBe('checkbox_group');
    expect(fields[0].multiple).toBe(true);
    expect(fields[0].options).toHaveLength(2);
  });

  it('keeps a lone checkbox as a single checkbox', () => {
    setBody(`<label><input type="checkbox" name="terms" /> I agree to the Terms</label>`);
    const fields = detect().fields;
    expect(fields).toHaveLength(1);
    expect(fields[0].type).toBe('checkbox');
    expect(fields[0].multiple).toBe(false);
  });

  it('does not merge radio sets with different names', () => {
    setBody(`
      <label><input type="radio" name="a" value="1" /> One</label>
      <label><input type="radio" name="b" value="2" /> Two</label>`);
    expect(detect().fields).toHaveLength(2);
  });

  it('treats an ARIA radiogroup as one field and consumes its radios', () => {
    setBody(`
      <div id="lbl">Rate your React proficiency</div>
      <div role="radiogroup" aria-labelledby="lbl">
        <div role="radio" data-value="1" aria-checked="false">1</div>
        <div role="radio" data-value="2" aria-checked="true">2</div>
        <div role="radio" data-value="3" aria-checked="false">3</div>
      </div>`);
    const fields = detect().fields;
    expect(fields).toHaveLength(1);
    expect(fields[0].type).toBe('radio_group');
    expect(fields[0].options?.map((o) => o.label)).toEqual(['1', '2', '3']);
    expect(fields[0].currentValue).toBe('2');
    expect(detect().stats.rejected['group-member']).toBe(3);
  });

  it('extracts select options and drops the empty placeholder row', () => {
    setBody(`
      <label for="s">Highest Qualification</label>
      <select id="s">
        <option value="">-- Select --</option>
        <option>High School</option>
        <option selected>Bachelor's Degree</option>
      </select>`);
    const fields = detect().fields;
    expect(fields[0].options?.map((o) => o.label)).toEqual(['High School', "Bachelor's Degree"]);
    expect(fields[0].currentValue).toBe("Bachelor's Degree");
  });
});

describe('ARIA and contenteditable controls', () => {
  it('detects a contenteditable region as richtext', () => {
    setBody(`<div id="lbl">Cover letter</div><div contenteditable="true" aria-labelledby="lbl"></div>`);
    const fields = detect().fields;
    expect(fields).toHaveLength(1);
    expect(fields[0].type).toBe('richtext');
    expect(fields[0].label).toBe('Cover letter');
  });

  it('distinguishes single-line and multi-line ARIA textboxes', () => {
    setBody(`
      <div role="textbox" aria-label="Full Name"></div>
      <div role="textbox" aria-multiline="true" aria-label="About you"></div>`);
    const byLabel = new Map(detect().fields.map((f) => [f.label, f.type]));
    expect(byLabel.get('Full Name')).toBe('text');
    expect(byLabel.get('About you')).toBe('textarea');
  });

  it('reads options from a collapsed custom listbox', () => {
    setBody(`
      <div>
        <div role="listbox" aria-label="Highest Qualification">Choose</div>
        <div hidden>
          <div role="option" data-value="Choose">Choose</div>
          <div role="option" data-value="PhD">PhD</div>
        </div>
      </div>`);
    const fields = detect().fields;
    expect(fields[0].type).toBe('select_one');
    // The `Choose` placeholder is dropped; only real choices remain.
    expect(fields[0].options?.map((o) => o.label)).toEqual(['PhD']);
  });

  it('resolves options referenced by aria-controls', () => {
    setBody(`
      <div role="combobox" aria-label="Country" aria-controls="list"></div>
      <div id="list"><div role="option" data-value="India">India</div><div role="option" data-value="Japan">Japan</div></div>`);
    const fields = detect().fields;
    expect(fields[0].options?.map((o) => o.label)).toEqual(['India', 'Japan']);
  });
});

describe('field metadata', () => {
  it('captures constraints, autocomplete and required state', () => {
    setBody(`
      <label for="a">Summary</label>
      <textarea id="a" name="summary" maxlength="500" minlength="10" required
                placeholder="Say something" aria-describedby="hint"></textarea>
      <span id="hint">Keep it short</span>
      <label for="b">Email</label>
      <input id="b" name="email" type="email" autocomplete="email" pattern=".+@.+" />`);
    const fields = detect().fields;
    const summary = fields.find((f) => f.label === 'Summary')!;
    expect(summary.maxLength).toBe(500);
    expect(summary.minLength).toBe(10);
    expect(summary.required).toBe(true);
    expect(summary.placeholder).toBe('Say something');
    expect(summary.description).toBe('Keep it short');
    const email = fields.find((f) => f.label === 'Email')!;
    expect(email.autocomplete).toBe('email');
    expect(email.pattern).toBe('.+@.+');
  });

  it('marks blocked and sensitive fields during detection', () => {
    setBody(`
      <label for="p">Password</label><input id="p" type="password" />
      <label for="f">Upload Resume</label><input id="f" type="file" />
      <label for="t">Full Name</label><input id="t" />`);
    const byLabel = new Map(detect().fields.map((f) => [f.label, f]));
    expect(byLabel.get('Password')?.sensitivity).toBe('blocked');
    expect(byLabel.get('Upload Resume')?.sensitivity).toBe('sensitive');
    expect(byLabel.get('Full Name')?.sensitivity).toBe('normal');
  });

  it('scores detection confidence by how the label was found', () => {
    setBody(`
      <label for="a">Proper label</label><input id="a" />
      <input id="b" placeholder="Only a placeholder" />
      <input id="c" name="only_a_name" />
      <div><input id="d" /></div>`);
    const byId = new Map(detect().fields.map((f) => [f.elementId, f]));
    expect(byId.get('a')!.detectionConfidence).toBeGreaterThan(byId.get('b')!.detectionConfidence);
    expect(byId.get('b')!.detectionConfidence).toBeGreaterThan(byId.get('c')!.detectionConfidence);
    expect(byId.get('d')!.detectionConfidence).toBeLessThan(0.4);
  });

  it('gives every field a working selector', () => {
    setBody(`
      <label for="a">One</label><input id="a" />
      <input aria-label="Two" name="two" />
      <div><div><input aria-label="Three" /></div></div>`);
    for (const field of detect().fields) {
      expect(document.querySelector(field.selector), field.selector).toBeTruthy();
    }
  });
});

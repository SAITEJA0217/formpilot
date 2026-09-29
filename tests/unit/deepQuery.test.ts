/** Traversal across shadow roots and frames, and the reporting of what is unreachable. */
import { describe, expect, it } from 'vitest';
import { deepQueryAll, resolveRoot } from '../../extension/src/core/dom/deepQuery';
import { setBody } from '../helpers/dom';

describe('deepQueryAll', () => {
  it('finds elements in the main document', () => {
    setBody(`<input id="a" /><input id="b" />`);
    const { elements, stats } = deepQueryAll('input', document);
    expect(elements).toHaveLength(2);
    expect(stats.shadowRootsTraversed).toBe(0);
  });

  it('descends into open shadow roots and records the path', () => {
    setBody(`<input id="light" /><div id="host"></div>`);
    const shadow = document.querySelector('#host')!.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<input id="shadowed" />`;

    const { elements, stats } = deepQueryAll('input', document);
    expect(elements).toHaveLength(2);
    expect(stats.shadowRootsTraversed).toBe(1);

    const shadowed = elements.find((e) => e.element.id === 'shadowed')!;
    expect(shadowed.location.shadowPath).toEqual(['div#host']);
    expect(shadowed.root).toBe(shadow);
  });

  it('descends into nested shadow roots', () => {
    setBody(`<div id="outer"></div>`);
    const outer = document.querySelector('#outer')!.attachShadow({ mode: 'open' });
    outer.innerHTML = `<div id="inner"></div>`;
    const inner = outer.querySelector('#inner')!.attachShadow({ mode: 'open' });
    inner.innerHTML = `<input id="deep" />`;

    const { elements, stats } = deepQueryAll('input', document);
    expect(elements).toHaveLength(1);
    expect(stats.shadowRootsTraversed).toBe(2);
    expect(elements[0].location.shadowPath).toEqual(['div#outer', 'div#inner']);
  });

  it('cannot see into a closed shadow root', () => {
    setBody(`<div id="host"></div>`);
    const closed = document.querySelector('#host')!.attachShadow({ mode: 'closed' });
    closed.innerHTML = `<input id="unreachable" />`;
    expect(deepQueryAll('input', document).elements).toHaveLength(0);
  });

  it('can be told to stay in the light DOM', () => {
    setBody(`<div id="host"></div>`);
    const shadow = document.querySelector('#host')!.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<input />`;
    expect(deepQueryAll('input', document, { includeShadowRoots: false }).elements).toHaveLength(0);
  });

  it('reads a same-origin frame and records its index', () => {
    setBody(`<input id="host-field" /><iframe id="f"></iframe>`);
    const frame = document.querySelector<HTMLIFrameElement>('#f')!;
    const doc = frame.contentDocument!;
    doc.body.innerHTML = `<input id="framed" />`;

    const { elements, stats } = deepQueryAll('input', document);
    expect(stats.framesTraversed).toBe(1);
    expect(stats.inaccessibleFrames).toBe(0);
    const framed = elements.find((e) => e.element.id === 'framed')!;
    expect(framed.location.framePath).toEqual([0]);
    expect(framed.ownerDocument).toBe(doc);
  });

  it('counts a frame it cannot read instead of failing', () => {
    setBody(`<iframe id="f"></iframe>`);
    const frame = document.querySelector<HTMLIFrameElement>('#f')!;
    // Simulate the cross-origin case: reading contentDocument throws.
    Object.defineProperty(frame, 'contentDocument', {
      get() {
        throw new Error('SecurityError: cross-origin');
      },
    });
    const { elements, stats } = deepQueryAll('input', document);
    expect(elements).toHaveLength(0);
    expect(stats.inaccessibleFrames).toBe(1);
  });

  it('can be told to ignore frames', () => {
    setBody(`<iframe id="f"></iframe>`);
    const doc = document.querySelector<HTMLIFrameElement>('#f')!.contentDocument!;
    doc.body.innerHTML = `<input />`;
    expect(deepQueryAll('input', document, { includeFrames: false }).elements).toHaveLength(0);
  });

  it('honours the element limit so a pathological page cannot hang detection', () => {
    setBody(Array.from({ length: 50 }, (_, i) => `<input id="i${i}" />`).join(''));
    expect(deepQueryAll('input', document, { limit: 10 }).elements).toHaveLength(10);
  });

  it('treats an explicitly undefined option as unset, not as false', () => {
    // Callers forward their own optional flags straight through; an object spread would
    // let that `undefined` overwrite the default and silently disable traversal.
    setBody(`<div id="host"></div>`);
    const shadow = document.querySelector('#host')!.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<input id="x" />`;
    const result = deepQueryAll('input', document, {
      includeShadowRoots: undefined,
      includeFrames: undefined,
      limit: undefined,
    });
    expect(result.elements).toHaveLength(1);
  });

  it('returns nothing for an invalid selector rather than throwing', () => {
    setBody(`<input />`);
    expect(deepQueryAll('input[', document).elements).toHaveLength(0);
  });
});

describe('resolveRoot', () => {
  it('round-trips a shadow path', () => {
    setBody(`<div id="host"></div>`);
    const shadow = document.querySelector('#host')!.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<input id="x" />`;
    const located = deepQueryAll('input', document).elements[0];
    expect(resolveRoot(located.location, document)).toBe(shadow);
  });

  it('round-trips a frame path', () => {
    setBody(`<iframe id="f"></iframe>`);
    const doc = document.querySelector<HTMLIFrameElement>('#f')!.contentDocument!;
    doc.body.innerHTML = `<input id="x" />`;
    const located = deepQueryAll('input', document).elements[0];
    expect(resolveRoot(located.location, document)).toBe(doc);
  });

  it('returns the document for an empty path', () => {
    setBody(`<input />`);
    expect(resolveRoot({ framePath: [], shadowPath: [] }, document)).toBe(document);
  });

  it('returns null when the path no longer exists', () => {
    setBody(`<div></div>`);
    expect(resolveRoot({ framePath: [3], shadowPath: [] }, document)).toBeNull();
    expect(resolveRoot({ framePath: [], shadowPath: ['div#gone'] }, document)).toBeNull();
  });
});

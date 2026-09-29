/**
 * Composing CSS selector *lists*.
 *
 * A selector constant like `'[data-testid^="question"], .question-body'` is a comma-
 * separated list, and CSS gives the comma lower precedence than the descendant space.
 * So the obvious `` `${QUESTION} ${TITLE}` `` does not mean "a TITLE inside a QUESTION":
 *
 *   QUESTION = 'a, b'
 *   TITLE    = 'c, d'
 *   `${QUESTION} ${TITLE}` === 'a, b c, d'   // matches a bare `a`, or a bare `d`
 *
 * That silently drops the requirement that both parts be present, which is how an
 * adapter comes to claim a page it knows nothing about. These helpers expand the lists
 * into an explicit cross product instead.
 */

/** Split a selector list on top-level commas. */
function parts(selectorList: string): string[] {
  return selectorList
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * "A `descendant` anywhere inside an `ancestor`", for selector lists.
 *
 * `descendantSelector('a, b', 'c, d')` === `'a c, a d, b c, b d'`
 */
export function descendantSelector(ancestor: string, descendant: string): string {
  const combined: string[] = [];
  for (const outer of parts(ancestor)) {
    for (const inner of parts(descendant)) {
      combined.push(`${outer} ${inner}`);
    }
  }
  return combined.join(', ');
}

/**
 * Append a compound suffix (an attribute selector, class or pseudo-class) to every
 * member of a selector list.
 *
 * `refineSelector('li.form-line, div.form-line', '[data-type]')`
 *   === `'li.form-line[data-type], div.form-line[data-type]'`
 */
export function refineSelector(selectorList: string, suffix: string): string {
  return parts(selectorList)
    .map((part) => `${part}${suffix}`)
    .join(', ');
}

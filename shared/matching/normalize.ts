/**
 * Field-text normalization.
 *
 * Two levels, deliberately separated:
 *
 *  - `normalizeText` keeps every word. Diacritics are folded, case is lowered,
 *    `camelCase`/`snake_case`/`kebab-case` are split, abbreviations are expanded,
 *    punctuation becomes whitespace. Ontology aliases and regex patterns are
 *    written against *this* level, so `date of birth` still contains `of`.
 *
 *  - `tokenSet` additionally drops stopwords. Similarity metrics use this level so
 *    `Please enter your first name` and `First Name` compare as identical.
 *
 * Mixing the two levels is the classic source of silent matcher bugs, hence the
 * two named exports rather than one flag.
 */

/** Words that carry no discriminating signal in form labels. */
export const STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'your', 'you', 'my', 'our', 'their', 'his', 'her',
  'please', 'kindly', 'enter', 'type', 'provide', 'fill', 'input', 'write',
  'select', 'choose', 'pick', 'specify', 'add', 'give',
  'is', 'are', 'be', 'was', 'were', 'am',
  'this', 'that', 'these', 'those', 'it', 'its',
  'field', 'box', 'value', 'here', 'eg', 'ie', 'etc',
  'optional', 'required', 'mandatory',
  'and', 'or', 'to', 'in', 'on', 'at', 'as', 'by', 'with', 'from',
  's', 'if', 'any',
]);

/**
 * Token-level abbreviation expansions. Applied after splitting, before
 * stopword removal, so both normalization levels see expanded forms.
 */
const ABBREVIATIONS: Readonly<Record<string, string>> = {
  fname: 'first name',
  firstname: 'first name',
  lname: 'last name',
  lastname: 'last name',
  surname: 'last name',
  mname: 'middle name',
  fullname: 'full name',
  dob: 'date of birth',
  birthdate: 'birth date',
  birthday: 'birth day',
  tel: 'phone',
  telephone: 'phone',
  mob: 'mobile',
  mobno: 'mobile number',
  cell: 'mobile',
  num: 'number',
  addr: 'address',
  addr1: 'address line 1',
  addr2: 'address line 2',
  street1: 'address line 1',
  street2: 'address line 2',
  zip: 'postal code',
  zipcode: 'postal code',
  postcode: 'postal code',
  pincode: 'postal code',
  org: 'organization',
  organisation: 'organization',
  company: 'company',
  univ: 'university',
  uni: 'university',
  clg: 'college',
  inst: 'institute',
  qual: 'qualification',
  quals: 'qualification',
  edu: 'education',
  exp: 'experience',
  yrs: 'years',
  yr: 'year',
  grad: 'graduation',
  pct: 'percentage',
  perc: 'percentage',
  desc: 'description',
  descr: 'description',
  info: 'information',
  dept: 'department',
  spec: 'specialization',
  specialisation: 'specialization',
  // `tech` is deliberately NOT expanded. It means "technical" in "tech skills" but
  // "technology" in "B.Tech"/"M.Tech", and expanding it broke degree matching:
  // `B.Tech` became `b technical`, which no longer matched the bachelor synonym set.
  // The ontology carries `tech skills` and `tech stack` as explicit aliases instead.
  lang: 'language',
  langs: 'languages',
  msg: 'message',
  pwd: 'password',
  pass: 'password',
  passwd: 'password',
  uname: 'username',
  usr: 'user',
  dt: 'date',
  emailid: 'email',
  mailid: 'email',
  linkedinurl: 'linkedin url',
  githuburl: 'github url',
  ssn: 'ssn',
  otp: 'otp',
  cvv: 'cvv',
  cv: 'cv',
};

/** Tokens after which a bare `no` means `number`, not a negation. */
const NO_MEANS_NUMBER_AFTER: ReadonlySet<string> = new Set([
  'contact', 'phone', 'mobile', 'roll', 'reg', 'registration', 'serial',
  'house', 'flat', 'door', 'id', 'account', 'aadhaar', 'pan',
]);

/**
 * Tokens after which `exp` means *expiry*, not *experience*.
 *
 * `exp` normally abbreviates "experience" on an application form, and expanding it is what lets
 * "Exp (years)" match `experience.years_of_experience`. Beside a card token it means the opposite,
 * and the unqualified expansion caused a real defect: a third-party payment form's `cc-exp-year`
 * input normalized to "cc experience year" and was mapped to years of employment. The independent
 * evaluation in `research/heldout/` caught it.
 *
 * Expanding to `expiry` rather than leaving `exp` alone makes the meaning explicit to the safety
 * policy and the matcher at once, the same way `NO_MEANS_NUMBER_AFTER` disambiguates `no`.
 */
const EXP_MEANS_EXPIRY_AFTER: ReadonlySet<string> = new Set([
  'cc', 'card', 'credit', 'debit', 'cvv', 'cvc', 'payment', 'visa', 'mastercard', 'amex',
]);

/** Strip required/optional decorations a form author added to a label. */
export function stripDecorations(input: string): string {
  return input
    .replace(/\(\s*(required|mandatory|optional)\s*\)/gi, ' ')
    .replace(/\[\s*(required|mandatory|optional)\s*\]/gi, ' ')
    .replace(/\*+/g, ' ')
    .replace(/[:：]\s*$/g, ' ')
    .replace(/\s*\(\s*\)\s*/g, ' ');
}

/** Fold diacritics so `Müller` and `Muller` normalize identically. */
function foldDiacritics(input: string): string {
  return input.normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

/** Split identifier-style text: `firstName`, `first_name`, `first-name`. */
function splitIdentifiers(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2');
}

function expandTokens(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === 'no') {
      const prev = out.length > 0 ? out[out.length - 1] : '';
      out.push(NO_MEANS_NUMBER_AFTER.has(prev) ? 'number' : 'no');
      continue;
    }
    if (token === 'exp') {
      const prev = out.length > 0 ? out[out.length - 1] : '';
      if (EXP_MEANS_EXPIRY_AFTER.has(prev)) {
        out.push('expiry');
        continue;
      }
    }
    const expansion = ABBREVIATIONS[token];
    if (expansion) {
      out.push(...expansion.split(' '));
    } else {
      out.push(token);
    }
  }
  return out;
}

/**
 * Level 1: full normalized text, all words retained.
 * Ontology aliases and patterns are matched against this.
 */
export function normalizeText(input: string | null | undefined): string {
  if (!input) return '';
  const decorated = stripDecorations(String(input));
  const folded = foldDiacritics(decorated);
  const split = splitIdentifiers(folded);
  const cleaned = split
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  return expandTokens(cleaned.split(' ')).join(' ').replace(/\s+/g, ' ').trim();
}

/** Level 2: content tokens only — normalized text minus stopwords. */
export function tokenize(input: string | null | undefined): string[] {
  const normalized = normalizeText(input);
  if (!normalized) return [];
  return normalized.split(' ').filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

/** Level 2 as a set, for set-based similarity. */
export function tokenSet(input: string | null | undefined): Set<string> {
  return new Set(tokenize(input));
}

/** Humanize an attribute value for display: `first_name` → `First name`. */
export function humanizeIdentifier(input: string | null | undefined): string {
  const normalized = normalizeText(input);
  if (!normalized) return '';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

/**
 * Knowledge-base resolution: concept → value.
 *
 * The matcher decides *what a field means*; this module decides *what to put in
 * it*. Splitting the two is what makes the same matcher reusable across profile
 * shapes, and it is where value confidence (as opposed to match confidence) is
 * produced.
 */
import type { FieldOption, UnifiedField } from '../types/form';
import type { ValueOrigin } from '../types/suggestion';
import type { Education, Experience, UserProfile } from '../types/index';
import type { ExtendedUserProfile } from '../types/profile';
import { getConceptDef } from '../ontology';
import { normalizeText, tokenSet } from './normalize';
import { containsPhrase, diceCoefficient, tokenSetF1 } from './similarity';

export type ProfileLike = Partial<ExtendedUserProfile> | Partial<UserProfile>;

export interface ResolvedValue {
  value: string | string[] | boolean | null;
  /** 0..1 — how good this value is for the concept, independent of the match. */
  confidence: number;
  profilePath?: string;
  humanPath?: string;
  origin: ValueOrigin;
  /** Set when the concept is understood but the profile has nothing for it. */
  missing?: boolean;
}

const NONE: ResolvedValue = { value: null, confidence: 0, origin: 'none', missing: true };

/**
 * Equivalence groups used when a profile value and an option label mean the same
 * thing in different words (`B.Tech` ↔ `Bachelor's Degree`). Deterministic and
 * auditable — no model call.
 */
export const SYNONYM_GROUPS: readonly string[][] = [
  ['bachelor', 'bachelors', 'bachelor s degree', 'undergraduate', 'ug', 'btech', 'b tech', 'be', 'b e', 'bsc', 'b sc', 'bca', 'ba', 'bcom', 'b com', 'bs'],
  ['master', 'masters', 'master s degree', 'postgraduate', 'pg', 'mtech', 'm tech', 'msc', 'm sc', 'mca', 'ma', 'mcom', 'mba', 'ms'],
  ['doctorate', 'phd', 'ph d', 'doctoral', 'doctor of philosophy'],
  ['high school', 'secondary school', '10th', '12th', 'hsc', 'ssc', 'intermediate', 'senior secondary'],
  ['diploma', 'polytechnic'],
  ['male', 'm', 'man'],
  ['female', 'f', 'woman'],
  ['yes', 'true', 'y'],
  ['no', 'false', 'n'],
];

function groupsFor(normalized: string): number[] {
  const out: number[] = [];
  SYNONYM_GROUPS.forEach((group, index) => {
    for (const term of group) {
      if (normalized === term || containsPhrase(normalized, term)) {
        out.push(index);
        return;
      }
    }
  });
  return out;
}

function firstNonEmpty(...values: (string | undefined | null)[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function splitName(fullName: string): { first: string; middle: string; last: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: '', middle: '', last: '' };
  if (parts.length === 1) return { first: parts[0], middle: '', last: '' };
  return {
    first: parts[0],
    middle: parts.slice(1, -1).join(' '),
    last: parts[parts.length - 1],
  };
}

/** Most relevant education entry: latest graduation year, else the first listed. */
export function pickEducation(profile: ProfileLike): { entry: Education; index: number } | null {
  const list = (profile.education ?? []) as Education[];
  const usable = list
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => !!firstNonEmpty(entry?.degree, entry?.college, entry?.university, entry?.branch));
  if (usable.length === 0) return null;
  let best = usable[0];
  for (const candidate of usable) {
    const bestYear = Number(best.entry.graduationYear) || 0;
    const year = Number(candidate.entry.graduationYear) || 0;
    if (year > bestYear) best = candidate;
  }
  return best;
}

/** Most relevant experience entry: the current role, else the first listed. */
export function pickExperience(profile: ProfileLike): { entry: Experience; index: number } | null {
  const list = (profile.experience ?? []) as Experience[];
  const usable = list
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => !!firstNonEmpty(entry?.company, entry?.position));
  if (usable.length === 0) return null;
  const current = usable.find(({ entry }) => entry.isCurrent);
  return current ?? usable[0];
}

function value(
  raw: string | string[] | undefined | null,
  profilePath: string,
  humanPath: string,
  confidence = 1,
  origin: ValueOrigin = 'profile',
): ResolvedValue {
  if (raw === null || raw === undefined) return NONE;
  if (Array.isArray(raw)) {
    const cleaned = raw.map((r) => String(r).trim()).filter(Boolean);
    if (cleaned.length === 0) return NONE;
    return { value: cleaned, confidence, profilePath, humanPath, origin };
  }
  const trimmed = String(raw).trim();
  if (!trimmed) return NONE;
  return { value: trimmed, confidence, profilePath, humanPath, origin };
}

/**
 * Resolve a concept against the profile.
 *
 * Derived values (a first name split out of a full name, a joined skill list)
 * carry a deliberately reduced confidence: they are correct more often than not,
 * but not as certain as a directly stored field.
 */
export function resolveConcept(conceptId: string, profile: ProfileLike): ResolvedValue {
  const def = getConceptDef(conceptId);
  if (!def || def.resolver === 'blocked') return NONE;

  const basic = profile.basicProfile;
  const social = profile.socialLinks;
  const extended = profile as Partial<ExtendedUserProfile>;
  const address = extended.address;
  const education = pickEducation(profile);
  const experience = pickExperience(profile);

  switch (def.resolver) {
    case 'person.full_name':
      return value(basic?.fullName, 'basicProfile.fullName', 'Personal → Full name');
    case 'person.first_name': {
      if (!basic?.fullName) return NONE;
      const { first } = splitName(basic.fullName);
      return value(first, 'basicProfile.fullName', 'Personal → Full name (first word)', 0.92, 'derived');
    }
    case 'person.middle_name': {
      if (!basic?.fullName) return NONE;
      const { middle } = splitName(basic.fullName);
      if (!middle) return NONE;
      return value(middle, 'basicProfile.fullName', 'Personal → Full name (middle)', 0.8, 'derived');
    }
    case 'person.last_name': {
      if (!basic?.fullName) return NONE;
      const { last } = splitName(basic.fullName);
      if (!last) return NONE;
      return value(last, 'basicProfile.fullName', 'Personal → Full name (last word)', 0.9, 'derived');
    }
    case 'person.email':
      return value(basic?.email, 'basicProfile.email', 'Personal → Email');
    case 'person.phone':
      return value(basic?.phone, 'basicProfile.phone', 'Personal → Phone');
    case 'person.date_of_birth':
      return value(basic?.dateOfBirth, 'basicProfile.dateOfBirth', 'Personal → Date of birth');
    case 'person.gender':
      return value(basic?.gender, 'basicProfile.gender', 'Personal → Gender');
    case 'person.pronouns':
      return NONE;

    case 'address.full': {
      const composed = firstNonEmpty(
        basic?.address,
        [address?.line1, address?.line2, address?.city, address?.state, address?.postalCode, address?.country]
          .filter(Boolean)
          .join(', '),
      );
      return value(composed, basic?.address ? 'basicProfile.address' : 'address', 'Personal → Address');
    }
    case 'address.line1':
      return value(address?.line1, 'address.line1', 'Personal → Address line 1');
    case 'address.line2':
      return value(address?.line2, 'address.line2', 'Personal → Address line 2');
    case 'address.city':
      return value(address?.city, 'address.city', 'Personal → City');
    case 'address.state':
      return value(address?.state, 'address.state', 'Personal → State');
    case 'address.postal_code':
      return value(address?.postalCode, 'address.postalCode', 'Personal → Postal code');
    case 'address.country':
      return value(address?.country, 'address.country', 'Personal → Country');

    case 'education.degree':
      return education
        ? value(education.entry.degree, `education[${education.index}].degree`, 'Education → Degree')
        : NONE;
    case 'education.field_of_study':
      return education
        ? value(education.entry.branch, `education[${education.index}].branch`, 'Education → Branch')
        : NONE;
    case 'education.institution':
      return education
        ? value(education.entry.college, `education[${education.index}].college`, 'Education → College')
        : NONE;
    case 'education.university':
      return education
        ? value(
            firstNonEmpty(education.entry.university, education.entry.college),
            `education[${education.index}].university`,
            'Education → University',
            education.entry.university ? 1 : 0.7,
            education.entry.university ? 'profile' : 'derived',
          )
        : NONE;
    case 'education.graduation_year':
      return education
        ? value(
            education.entry.graduationYear,
            `education[${education.index}].graduationYear`,
            'Education → Graduation year',
          )
        : NONE;
    case 'education.gpa':
      return education
        ? value(education.entry.cgpa, `education[${education.index}].cgpa`, 'Education → CGPA')
        : NONE;

    case 'experience.company':
      return experience
        ? value(experience.entry.company, `experience[${experience.index}].company`, 'Experience → Company')
        : NONE;
    case 'experience.job_title':
      return experience
        ? value(experience.entry.position, `experience[${experience.index}].position`, 'Experience → Position')
        : NONE;
    case 'experience.duration':
      return experience
        ? value(
            firstNonEmpty(experience.entry.duration, [experience.entry.startDate, experience.entry.endDate].filter(Boolean).join(' – ')),
            `experience[${experience.index}].duration`,
            'Experience → Duration',
          )
        : NONE;
    case 'experience.years_of_experience': {
      // Only derivable when the profile states a duration in years; never invented.
      if (!experience) return NONE;
      const duration = experience.entry.duration ?? '';
      const years = duration.match(/(\d+(?:\.\d+)?)\s*(?:\+\s*)?(?:years?|yrs?)/i);
      if (!years) return NONE;
      return value(
        years[1],
        `experience[${experience.index}].duration`,
        'Experience → Duration (years)',
        0.75,
        'derived',
      );
    }

    case 'skills.technical':
      return value(profile.skills?.technical, 'skills.technical', 'Skills → Technical');
    case 'skills.soft':
      return value(profile.skills?.soft, 'skills.soft', 'Skills → Soft');
    case 'skills.languages':
      return value(extended.languages, 'languages', 'Skills → Languages');

    case 'links.linkedin':
      return value(social?.linkedin, 'socialLinks.linkedin', 'Links → LinkedIn');
    case 'links.github':
      return value(social?.github, 'socialLinks.github', 'Links → GitHub');
    case 'links.portfolio':
      return value(social?.portfolio, 'socialLinks.portfolio', 'Links → Portfolio');

    case 'documents.resume':
    case 'documents.cover_letter':
    case 'documents.other':
      // Documents are never attached automatically; the picker handles these.
      return NONE;

    default:
      // Generative concepts have no stored value by design.
      return NONE;
  }
}

export interface OptionMatch {
  option: FieldOption | null;
  confidence: number;
  detail?: string;
}

/** Score one candidate value against one option label. */
function scoreOption(normalizedValue: string, option: FieldOption): { score: number; detail: string } {
  const optionText = normalizeText(option.label || option.value);
  if (!optionText) return { score: 0, detail: 'empty option' };
  if (optionText === normalizedValue) return { score: 1, detail: 'exact' };
  if (containsPhrase(optionText, normalizedValue)) return { score: 0.92, detail: 'value inside option' };
  if (containsPhrase(normalizedValue, optionText)) return { score: 0.88, detail: 'option inside value' };

  const valueGroups = groupsFor(normalizedValue);
  if (valueGroups.length > 0) {
    const optionGroups = groupsFor(optionText);
    if (optionGroups.some((g) => valueGroups.includes(g))) {
      return { score: 0.85, detail: 'equivalent term' };
    }
  }

  const f1 = tokenSetF1(tokenSet(normalizedValue), tokenSet(optionText));
  if (f1 >= 0.6) return { score: 0.7 * f1 + 0.2, detail: 'token overlap' };
  const dice = diceCoefficient(normalizedValue, optionText);
  if (dice >= 0.8) return { score: 0.7, detail: 'near-identical text' };
  return { score: Math.max(f1, dice * 0.5), detail: 'weak' };
}

/** Best single option for a value. Confidence 0 means "do not select anything". */
export function matchOption(rawValue: string, options: FieldOption[]): OptionMatch {
  const normalizedValue = normalizeText(rawValue);
  if (!normalizedValue || options.length === 0) return { option: null, confidence: 0 };
  let best: OptionMatch = { option: null, confidence: 0 };
  for (const option of options) {
    const { score, detail } = scoreOption(normalizedValue, option);
    if (score > best.confidence) best = { option, confidence: score, detail };
  }
  return best.confidence >= 0.6 ? best : { option: null, confidence: best.confidence, detail: best.detail };
}

/** All options matching any of the given values, for multi-select controls. */
export function matchOptions(rawValues: string[], options: FieldOption[]): {
  matched: FieldOption[];
  confidence: number;
} {
  const matched: FieldOption[] = [];
  const scores: number[] = [];
  for (const raw of rawValues) {
    const result = matchOption(raw, options);
    if (result.option && !matched.some((m) => m.value === result.option?.value)) {
      matched.push(result.option);
      scores.push(result.confidence);
    }
  }
  if (matched.length === 0) return { matched: [], confidence: 0 };
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  // Partial coverage of the requested values reduces confidence.
  const coverage = matched.length / Math.max(1, rawValues.length);
  return { matched, confidence: mean * (0.7 + 0.3 * coverage) };
}

/** True when the control expects the value to come from a fixed option list. */
export function isOptionField(field: UnifiedField): boolean {
  return (
    field.type === 'select_one' ||
    field.type === 'select_many' ||
    field.type === 'radio_group' ||
    field.type === 'checkbox_group' ||
    field.type === 'rating'
  );
}

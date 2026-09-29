/**
 * Data minimisation for the model request.
 *
 * The AI path previously forwarded the stored profile whole, and the server-side route
 * serialises whatever it receives straight into the prompt. So asking a model to draft one
 * "why do you want to join?" paragraph sent the user's phone number, date of birth, gender,
 * full postal address, every saved document and every alternate persona to the provider.
 * None of that is needed to write the paragraph.
 *
 * This module removes what the request demonstrably cannot use. It is not a privacy
 * guarantee — the profile that remains is still personal data going to a third party, and
 * the only complete answer is the `allowAI` switch that turns the path off. It is the
 * difference between sending what is needed and sending everything.
 *
 * Two levels, because the two AI modes need different things:
 *
 *  - `generate` writes prose from career history. It never needs contact details, identity
 *    attributes or links.
 *  - `assist` adjudicates an uncertain *mapping* and returns a stored value, so it has to be
 *    able to see the value it might return. Contact and address fields stay for that.
 *
 * Four things are removed unconditionally, because neither mode can use them:
 *
 *  - `documents` — file fields route to the user's own picker, never to a model.
 *  - `profiles` — alternate personas the user maintains for other applications. Sending all
 *    of them to answer one question is the clearest over-share of the set.
 *  - `preferences` — confidence thresholds and feature switches, not facts about the user.
 *  - `userId` — an account identifier the model has no use for.
 */

/** The AI request modes, as `AIFieldRequest.mode` declares them. */
export type AiRequestMode = 'assist' | 'generate';

/** Keys stripped from every model request, whatever the mode. */
export const ALWAYS_REDACTED = ['documents', 'profiles', 'activeProfileId', 'preferences', 'userId'] as const;

/** Keys stripped when no request needs to read a stored value back. */
export const PROSE_ONLY_REDACTED = ['address', 'socialLinks'] as const;

/** `basicProfile` members stripped when no request needs to read a stored value back. */
export const PROSE_ONLY_BASIC_REDACTED = ['phone', 'dateOfBirth', 'gender', 'address'] as const;

/**
 * A mode that may legitimately return a stored value, and therefore needs to see one.
 *
 * Anything unrecognised counts as value-returning: an unknown mode that silently lost the
 * fields it needed would produce wrong answers, which is a worse failure than over-sending.
 * A new prose-only mode has to opt in here deliberately.
 */
function needsStoredValues(mode: AiRequestMode | undefined): boolean {
  return mode !== 'generate';
}

export interface RedactionReport {
  /** Top-level keys removed. */
  removed: string[];
  /** `basicProfile` members removed. */
  removedFromBasicProfile: string[];
  /** True when at least one request could return a stored value, so less was removed. */
  keptForValueLookup: boolean;
}

export interface RedactionResult<T> {
  profile: T;
  report: RedactionReport;
}

/**
 * Return a copy of `profile` carrying only what the given request modes can use.
 *
 * The input is never mutated: the caller still holds the full profile for its own local
 * matching, which is where most fields are resolved without a model at all.
 */
export function redactProfileForAI<T extends Record<string, unknown>>(
  profile: T,
  modes: readonly (AiRequestMode | undefined)[],
): RedactionResult<T> {
  const keptForValueLookup = modes.some((mode) => needsStoredValues(mode));
  const copy: Record<string, unknown> = { ...profile };
  const removed: string[] = [];
  const removedFromBasicProfile: string[] = [];

  for (const key of ALWAYS_REDACTED) {
    if (key in copy) {
      delete copy[key];
      removed.push(key);
    }
  }

  if (!keptForValueLookup) {
    for (const key of PROSE_ONLY_REDACTED) {
      if (key in copy) {
        delete copy[key];
        removed.push(key);
      }
    }
    const basic = copy.basicProfile;
    if (basic && typeof basic === 'object') {
      const basicCopy: Record<string, unknown> = { ...(basic as Record<string, unknown>) };
      for (const key of PROSE_ONLY_BASIC_REDACTED) {
        if (key in basicCopy) {
          delete basicCopy[key];
          removedFromBasicProfile.push(key);
        }
      }
      copy.basicProfile = basicCopy;
    }
  }

  return {
    profile: copy as T,
    report: { removed, removedFromBasicProfile, keptForValueLookup },
  };
}

/**
 * The page URL, reduced to the part that grounds an answer.
 *
 * The URL is sent because a generated answer needs to know who is asking: "why do you want to join
 * us?" cannot be written without the company, and the hostname supplies it. That is the whole of the
 * grounding requirement, and it is the *rest* of the URL that carries the risk.
 *
 * A careers URL routinely looks like
 * `https://jobs.example.com/apply/senior-engineer?email=you@example.com&token=8f3ac1&utm_source=li`,
 * or `…#step=3&candidateId=99201`. Those query and fragment parts are where an applicant's own
 * identifiers live — an email, a session token, an application id — and none of them helps a model
 * write a better answer. Sending them put identifying data in the request logs of the backend and of
 * the model provider for no benefit at all, which is the definition of data that should not have
 * left the device.
 *
 * So: origin and path are kept, query and fragment are dropped. Credentials in the authority
 * (`https://user:pass@host/`) are dropped too — those are credentials by definition.
 *
 * The path is kept deliberately, and it is the one judgement call here. A path is usually the job
 * (`/careers/senior-engineer`) and that is real grounding; it can also carry an opaque application
 * id, which this does not remove, because there is no way to tell an id from a job title without
 * guessing and a wrong guess silently destroys the grounding the URL is sent for. The honest
 * position is that this reduces exposure rather than eliminating it, and `allowAI: false` remains
 * the control that sends nothing at all.
 *
 * Returns `null` for anything unparseable, and for non-http(s) schemes — a `file:`, `data:` or
 * extension URL says nothing about a company and can name the user's own filesystem.
 */
export function minimiseUrlForAI(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  // `origin` excludes any username/password in the authority, so credentials cannot survive.
  return `${parsed.origin}${parsed.pathname}`;
}

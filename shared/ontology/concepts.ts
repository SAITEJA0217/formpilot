/**
 * Canonical profile-field ontology.
 *
 * This table is the semantic target of every match. A form field is not mapped to
 * a profile *path* directly — it is mapped to a *concept* (`person.first_name`),
 * and the resolver then fetches a value for that concept from the knowledge base.
 * That indirection is what lets one matcher serve Google Forms, a React job
 * application and a plain HTML contact form.
 *
 * The table is pure data (strings, not compiled RegExp) so it can be serialized
 * into an experiment record and diffed between runs.
 */
import type { FieldType } from '../types/form';

/** Expected shape of a value for a concept. Drives validation and coercion. */
export type ConceptValueType =
  | 'string'
  | 'text'
  | 'email'
  | 'tel'
  | 'url'
  | 'date'
  | 'year'
  | 'number'
  | 'list'
  | 'boolean'
  | 'file';

/**
 * `allow`   — may be prepared for autofill.
 * `confirm` — must be explicitly confirmed by the user before filling.
 * `never`   — never autofilled under any confidence.
 */
export type AutofillPolicy = 'allow' | 'confirm' | 'never';

export interface ConceptDef {
  /** Dotted canonical id, e.g. `person.first_name`. */
  id: string;
  /** Short human label for the review UI. */
  label: string;
  /** Human-readable provenance path, e.g. `Education → Degree`. */
  humanPath: string;
  valueType: ConceptValueType;
  /** Resolver key consumed by `shared/matching/resolve.ts`. */
  resolver: string;
  /**
   * Normalized alias phrases. Compared against normalized field text, so write
   * them lowercase, space-separated, without punctuation.
   */
  aliases: string[];
  /** Regex sources tested against normalized field text. */
  patterns?: string[];
  /** Field types this concept can legitimately fill. Empty/absent = any. */
  fieldTypes?: FieldType[];
  /** HTML `autocomplete` tokens that deterministically identify this concept. */
  autocomplete?: string[];
  /** Section/nearby-text phrases that raise confidence for this concept. */
  contextBoost?: string[];
  /**
   * Aliases that are correct but genuinely context-dependent when they are the *whole*
   * label, with nothing else to go on.
   *
   * A form field labelled only `Company` is a real example: on a job application it
   * usually means the applicant's current employer, which is what this concept holds, but
   * it can equally mean the company being applied to. The alias is not wrong, so removing
   * it would lose a useful mapping; it is only *uncertain*. Listing it here keeps the
   * mapping and caps its confidence below the auto-accept band unless a `contextBoost` cue
   * corroborates it, so the suggestion is shown for review rather than applied silently.
   */
  contextDependentAliases?: string[];
  /** Phrases whose presence disqualifies this concept (disambiguators). */
  negative?: string[];
  policy: AutofillPolicy;
  /** True when a value should be produced by the LLM rather than copied. */
  generative?: boolean;
}

/**
 * Concepts are ordered roughly most-specific first. The matcher does not rely on
 * order for correctness (it scores all candidates), but a stable order keeps
 * tie-breaking deterministic and therefore reproducible.
 */
export const CONCEPTS: ConceptDef[] = [
  // ── Person ────────────────────────────────────────────────────────────────
  {
    id: 'person.first_name',
    label: 'First name',
    humanPath: 'Personal → First name',
    valueType: 'string',
    resolver: 'person.first_name',
    aliases: ['first name', 'given name', 'forename', 'fname', 'first', 'your first name'],
    patterns: ['\\bfirst\\s*name\\b', '\\bgiven\\s*name\\b', '\\bfore\\s*name\\b'],
    autocomplete: ['given-name'],
    fieldTypes: ['text', 'search', 'unknown'],
    negative: ['last name', 'family name', 'surname', 'middle name', 'father', 'mother', 'guardian'],
    policy: 'allow',
  },
  {
    id: 'person.middle_name',
    label: 'Middle name',
    humanPath: 'Personal → Middle name',
    valueType: 'string',
    resolver: 'person.middle_name',
    aliases: ['middle name', 'middle initial', 'mname'],
    patterns: ['\\bmiddle\\s*(name|initial)\\b'],
    autocomplete: ['additional-name'],
    fieldTypes: ['text', 'unknown'],
    policy: 'allow',
  },
  {
    id: 'person.last_name',
    label: 'Last name',
    humanPath: 'Personal → Last name',
    valueType: 'string',
    resolver: 'person.last_name',
    aliases: ['last name', 'family name', 'surname', 'lname', 'last', 'your last name'],
    patterns: ['\\blast\\s*name\\b', '\\bfamily\\s*name\\b', '\\bsur\\s*name\\b'],
    autocomplete: ['family-name'],
    fieldTypes: ['text', 'search', 'unknown'],
    negative: ['first name', 'given name', 'middle name'],
    policy: 'allow',
  },
  {
    id: 'person.full_name',
    label: 'Full name',
    humanPath: 'Personal → Full name',
    valueType: 'string',
    resolver: 'person.full_name',
    aliases: [
      'full name', 'name', 'your name', 'complete name', 'legal name',
      'candidate name', 'applicant name', 'student name', 'full legal name',
      'name as per records', 'name in full',
    ],
    patterns: ['^\\s*name\\s*$', '\\bfull\\s*name\\b', '\\b(candidate|applicant|student|employee)\\s*name\\b'],
    autocomplete: ['name'],
    fieldTypes: ['text', 'search', 'unknown'],
    negative: [
      'first name', 'last name', 'middle name', 'user name', 'username',
      'company name', 'organisation name', 'organization name', 'college name',
      'school name', 'university name', 'project name', 'file name',
      'father name', 'mother name', 'guardian name', 'reference name',
    ],
    policy: 'allow',
  },
  {
    id: 'person.email',
    label: 'Email',
    humanPath: 'Personal → Email',
    valueType: 'email',
    resolver: 'person.email',
    aliases: [
      'email', 'email address', 'e mail', 'e mail address', 'mail', 'mail id',
      'email id', 'contact email', 'your email', 'primary email', 'personal email',
    ],
    patterns: ['\\be[\\s-]?mail\\b', '\\bmail\\s*id\\b'],
    autocomplete: ['email'],
    fieldTypes: ['email', 'text', 'search', 'unknown'],
    negative: ['company email', 'employer email', 'manager email', 'reference email', 'parent email', 'guardian email', 'confirm'],
    policy: 'allow',
  },
  {
    id: 'person.phone',
    label: 'Phone',
    humanPath: 'Personal → Phone',
    valueType: 'tel',
    resolver: 'person.phone',
    aliases: [
      'phone', 'phone number', 'mobile', 'mobile number', 'mobile no',
      'contact number', 'contact no', 'telephone', 'telephone number', 'cell',
      'cell phone', 'whatsapp number', 'primary contact number',
    ],
    patterns: ['\\b(phone|mobile|telephone|cell)\\b', '\\bcontact\\s*(number|no)\\b'],
    autocomplete: ['tel', 'tel-national'],
    fieldTypes: ['tel', 'text', 'number', 'unknown'],
    negative: ['alternate', 'emergency', 'parent', 'guardian', 'reference', 'landline of'],
    policy: 'allow',
  },
  {
    id: 'person.date_of_birth',
    label: 'Date of birth',
    humanPath: 'Personal → Date of birth',
    valueType: 'date',
    resolver: 'person.date_of_birth',
    aliases: ['date of birth', 'dob', 'birth date', 'birthdate', 'birthday', 'date of birth dd mm yyyy'],
    patterns: ['\\bd\\s*o\\s*b\\b', '\\bbirth\\s*(date|day)\\b', '\\bdate\\s*of\\s*birth\\b'],
    autocomplete: ['bday'],
    fieldTypes: ['date', 'text', 'unknown'],
    policy: 'allow',
  },
  {
    id: 'person.gender',
    label: 'Gender',
    humanPath: 'Personal → Gender',
    valueType: 'string',
    resolver: 'person.gender',
    aliases: ['gender', 'sex'],
    patterns: ['\\bgender\\b', '^\\s*sex\\s*$'],
    autocomplete: ['sex'],
    policy: 'confirm',
  },
  {
    id: 'person.pronouns',
    label: 'Pronouns',
    humanPath: 'Personal → Pronouns',
    valueType: 'string',
    resolver: 'person.pronouns',
    aliases: ['pronouns', 'preferred pronouns'],
    patterns: ['\\bpronouns?\\b'],
    policy: 'confirm',
  },

  // ── Address ───────────────────────────────────────────────────────────────
  {
    id: 'address.full',
    label: 'Address',
    humanPath: 'Personal → Address',
    valueType: 'text',
    resolver: 'address.full',
    aliases: ['address', 'full address', 'postal address', 'residential address', 'current address', 'mailing address'],
    patterns: ['\\baddress\\b'],
    autocomplete: ['street-address'],
    // A field that names a *part* of an address is not the whole address. Composite address
    // questions (Jotform, most checkout flows) label each input "Address — City" or
    // "Address / Postal Code", and without these the generic `address` alias ties with the
    // specific part and the match is reported as ambiguous.
    negative: [
      'email address', 'e mail address', 'ip address', 'web address', 'wallet address',
      'city', 'town', 'state', 'province', 'postal code', 'zip', 'country',
      'street address', 'address line 1', 'address line 2', 'line 1', 'line 2',
    ],
    policy: 'allow',
  },
  {
    id: 'address.line1',
    label: 'Address line 1',
    humanPath: 'Personal → Address line 1',
    valueType: 'string',
    resolver: 'address.line1',
    aliases: ['address line 1', 'street address', 'address 1', 'house number and street'],
    patterns: ['address\\s*(line)?\\s*1\\b', '\\bstreet\\s*address\\b'],
    autocomplete: ['address-line1'],
    policy: 'allow',
  },
  {
    id: 'address.line2',
    label: 'Address line 2',
    humanPath: 'Personal → Address line 2',
    valueType: 'string',
    resolver: 'address.line2',
    aliases: ['address line 2', 'address 2', 'apartment suite unit'],
    patterns: ['address\\s*(line)?\\s*2\\b'],
    autocomplete: ['address-line2'],
    policy: 'allow',
  },
  {
    id: 'address.city',
    label: 'City',
    humanPath: 'Personal → City',
    valueType: 'string',
    resolver: 'address.city',
    aliases: ['city', 'town', 'city town', 'city of residence'],
    patterns: ['\\bcity\\b', '^\\s*town\\s*$'],
    autocomplete: ['address-level2'],
    policy: 'allow',
  },
  {
    id: 'address.state',
    label: 'State',
    humanPath: 'Personal → State',
    valueType: 'string',
    resolver: 'address.state',
    aliases: ['state', 'province', 'region', 'state province'],
    patterns: ['\\b(state|province)\\b'],
    autocomplete: ['address-level1'],
    negative: ['united states', 'state of the art'],
    policy: 'allow',
  },
  {
    id: 'address.postal_code',
    label: 'Postal code',
    humanPath: 'Personal → Postal code',
    valueType: 'string',
    resolver: 'address.postal_code',
    aliases: ['postal code', 'zip', 'zip code', 'pin code', 'pincode', 'postcode'],
    patterns: ['\\bzip\\b', '\\bpin\\s*code\\b', '\\bpost(al)?\\s*code\\b'],
    autocomplete: ['postal-code'],
    policy: 'allow',
  },
  {
    id: 'address.country',
    label: 'Country',
    humanPath: 'Personal → Country',
    valueType: 'string',
    resolver: 'address.country',
    aliases: ['country', 'country of residence', 'nation'],
    patterns: ['\\bcountry\\b'],
    autocomplete: ['country', 'country-name'],
    policy: 'allow',
  },

  // ── Education ─────────────────────────────────────────────────────────────
  {
    id: 'education.degree',
    label: 'Degree',
    humanPath: 'Education → Degree',
    valueType: 'string',
    resolver: 'education.degree',
    aliases: [
      'degree', 'qualification', 'highest qualification', 'highest degree',
      'highest education', 'highest education level', 'education level',
      'course', 'program', 'programme', 'degree program', 'level of study',
      'educational qualification', 'academic qualification',
    ],
    patterns: ['\\bdegree\\b', '\\bqualificat', '\\beducation\\s*(level|qualification)\\b', '\\bhighest\\b.*\\b(education|qualification|degree)\\b'],
    contextBoost: ['education', 'academic', 'qualification'],
    policy: 'allow',
  },
  {
    id: 'education.field_of_study',
    label: 'Field of study',
    humanPath: 'Education → Branch / Specialization',
    valueType: 'string',
    resolver: 'education.field_of_study',
    aliases: [
      'branch', 'specialization', 'specialisation', 'field of study', 'major',
      'discipline', 'stream', 'department', 'course specialization', 'subject',
    ],
    patterns: ['\\bbranch\\b', '\\bspecial(i[sz]ation)\\b', '\\bfield\\s*of\\s*study\\b', '\\bmajor\\b', '\\bstream\\b'],
    contextBoost: ['education', 'academic'],
    policy: 'allow',
  },
  {
    id: 'education.institution',
    label: 'College',
    humanPath: 'Education → College',
    valueType: 'string',
    resolver: 'education.institution',
    aliases: ['college', 'college name', 'institute', 'institution', 'school', 'school name', 'institute name'],
    patterns: ['\\bcollege\\b', '\\binstitut', '\\bschool\\b'],
    contextBoost: ['education', 'academic'],
    policy: 'allow',
  },
  {
    id: 'education.university',
    label: 'University',
    humanPath: 'Education → University',
    valueType: 'string',
    resolver: 'education.university',
    aliases: ['university', 'university name', 'affiliated university', 'board university'],
    patterns: ['\\buniversity\\b'],
    contextBoost: ['education', 'academic'],
    policy: 'allow',
  },
  {
    id: 'education.graduation_year',
    label: 'Graduation year',
    humanPath: 'Education → Graduation year',
    valueType: 'year',
    resolver: 'education.graduation_year',
    aliases: [
      'graduation year', 'year of graduation', 'passing year', 'year of passing',
      'batch', 'expected graduation', 'expected graduation year', 'completion year',
      'year of completion', 'graduating year',
    ],
    patterns: ['\\bgraduat', '\\bpassing\\s*(year|out)\\b', '\\byear\\s*of\\s*(passing|completion)\\b', '\\bbatch\\b'],
    contextBoost: ['education', 'academic'],
    policy: 'allow',
  },
  {
    id: 'education.gpa',
    label: 'GPA / CGPA',
    humanPath: 'Education → CGPA',
    valueType: 'string',
    resolver: 'education.gpa',
    aliases: ['cgpa', 'gpa', 'percentage', 'marks', 'aggregate', 'grade', 'score', 'cgpa percentage', 'aggregate percentage'],
    patterns: ['\\bc?gpa\\b', '\\bpercentage\\b', '\\baggregate\\b', '\\bmarks\\b'],
    contextBoost: ['education', 'academic'],
    policy: 'confirm',
  },

  // ── Experience ────────────────────────────────────────────────────────────
  {
    id: 'experience.company',
    label: 'Company',
    humanPath: 'Experience → Company',
    valueType: 'string',
    resolver: 'experience.company',
    aliases: [
      'company', 'company name', 'employer', 'employer name', 'organisation',
      'organization', 'organisation name', 'organization name', 'current company',
      'current employer', 'firm',
    ],
    patterns: ['\\bcompany\\b', '\\bemployer\\b', '\\borgani[sz]ation\\b', '\\bfirm\\b'],
    autocomplete: ['organization'],
    contextBoost: ['experience', 'employment', 'work'],
    // A bare `Company` or `Company Name` is the applicant's employer on most job
    // applications, but on plenty of forms it is the company being applied to. With no
    // section heading or nearby copy to settle it, the mapping is offered for review rather
    // than auto-accepted. `Current Company` and `Employer` are not listed: they say whose
    // company it is, so they stay fully confident.
    contextDependentAliases: ['company', 'company name', 'organisation', 'organization', 'firm'],
    // An email, phone or address field is never the company *name*, however much the
    // words overlap: `Company Email` must not be answered with the employer's name.
    negative: ['email', 'e mail', 'phone', 'website', 'address', 'logo'],
    policy: 'allow',
  },
  {
    id: 'experience.job_title',
    label: 'Job title',
    humanPath: 'Experience → Position',
    valueType: 'string',
    resolver: 'experience.job_title',
    aliases: [
      'job title', 'position', 'designation', 'role', 'current role',
      'current position', 'current designation', 'title', 'job role',
    ],
    patterns: ['\\bjob\\s*title\\b', '\\bdesignation\\b', '\\bposition\\b', '\\brole\\b'],
    autocomplete: ['organization-title'],
    contextBoost: ['experience', 'employment', 'work'],
    negative: ['role you are applying', 'position you are applying', 'applied position', 'applying for'],
    policy: 'allow',
  },
  {
    id: 'experience.years_of_experience',
    label: 'Years of experience',
    humanPath: 'Experience → Total years',
    valueType: 'string',
    resolver: 'experience.years_of_experience',
    aliases: [
      'years of experience', 'total experience', 'work experience years',
      'experience in years', 'total years of experience', 'relevant experience',
    ],
    patterns: ['\\byears?\\s*of\\s*experience\\b', '\\btotal\\s*experience\\b', '\\bexperience\\b.*\\byears?\\b'],
    policy: 'allow',
  },
  {
    id: 'experience.duration',
    label: 'Duration',
    humanPath: 'Experience → Duration',
    valueType: 'string',
    resolver: 'experience.duration',
    aliases: ['duration', 'employment duration', 'period', 'tenure'],
    patterns: ['\\bduration\\b', '\\btenure\\b'],
    contextBoost: ['experience', 'employment'],
    // `period` alone is a weak alias and matched "Notice Period", which is a different
    // thing the profile does not hold at all. These keep it from claiming those fields.
    negative: ['notice period', 'notice', 'probation period', 'grace period', 'cooling period'],
    policy: 'allow',
  },

  // ── Skills, projects, links ───────────────────────────────────────────────
  {
    id: 'skills.technical',
    label: 'Technical skills',
    humanPath: 'Skills → Technical',
    valueType: 'list',
    resolver: 'skills.technical',
    aliases: [
      'skills', 'technical skills', 'tech skills', 'key skills', 'core skills',
      'technologies', 'tech stack', 'programming languages', 'tools and technologies',
      'areas of expertise', 'primary skills',
    ],
    patterns: ['\\bskills?\\b', '\\btechnolog', '\\btech\\s*stack\\b', '\\bprogramming\\s*languages?\\b'],
    negative: ['soft skills', 'communication skills', 'language skills'],
    policy: 'allow',
  },
  {
    id: 'skills.soft',
    label: 'Soft skills',
    humanPath: 'Skills → Soft',
    valueType: 'list',
    resolver: 'skills.soft',
    aliases: ['soft skills', 'interpersonal skills', 'communication skills'],
    patterns: ['\\bsoft\\s*skills?\\b', '\\binterpersonal\\b'],
    policy: 'allow',
  },
  {
    id: 'skills.languages',
    label: 'Languages',
    humanPath: 'Skills → Languages',
    valueType: 'list',
    resolver: 'skills.languages',
    aliases: ['languages', 'languages known', 'spoken languages', 'language proficiency'],
    patterns: ['\\blanguages?\\s*(known|spoken)?\\b'],
    negative: ['programming languages'],
    policy: 'allow',
  },
  {
    id: 'links.linkedin',
    label: 'LinkedIn',
    humanPath: 'Links → LinkedIn',
    valueType: 'url',
    resolver: 'links.linkedin',
    aliases: ['linkedin', 'linkedin url', 'linkedin profile', 'linkedin link', 'linked in'],
    patterns: ['\\blinked\\s*in\\b'],
    policy: 'allow',
  },
  {
    id: 'links.github',
    label: 'GitHub',
    humanPath: 'Links → GitHub',
    valueType: 'url',
    resolver: 'links.github',
    aliases: ['github', 'github url', 'github profile', 'github link', 'git hub'],
    patterns: ['\\bgit\\s*hub\\b'],
    policy: 'allow',
  },
  {
    id: 'links.portfolio',
    label: 'Portfolio',
    humanPath: 'Links → Portfolio',
    valueType: 'url',
    resolver: 'links.portfolio',
    aliases: ['portfolio', 'portfolio url', 'personal website', 'website', 'personal site', 'blog', 'portfolio link'],
    patterns: ['\\bportfolio\\b', '\\bpersonal\\s*(website|site)\\b', '^\\s*website\\s*$'],
    negative: ['company website', 'college website'],
    policy: 'allow',
  },

  // ── Documents ─────────────────────────────────────────────────────────────
  {
    id: 'documents.resume',
    label: 'Resume',
    humanPath: 'Documents → Resume',
    valueType: 'file',
    resolver: 'documents.resume',
    aliases: ['resume', 'cv', 'curriculum vitae', 'upload resume', 'attach resume', 'resume cv'],
    patterns: ['\\bresume\\b', '\\bcv\\b', '\\bcurriculum\\s*vitae\\b'],
    fieldTypes: ['file'],
    policy: 'confirm',
  },
  {
    id: 'documents.cover_letter',
    label: 'Cover letter',
    humanPath: 'Documents → Cover letter',
    valueType: 'file',
    resolver: 'documents.cover_letter',
    aliases: ['cover letter', 'covering letter', 'upload cover letter'],
    patterns: ['\\bcover(ing)?\\s*letter\\b'],
    fieldTypes: ['file'],
    policy: 'confirm',
  },
  {
    id: 'documents.other',
    label: 'Document',
    humanPath: 'Documents',
    valueType: 'file',
    resolver: 'documents.other',
    aliases: ['upload', 'attach', 'attachment', 'document', 'certificate', 'transcript', 'file'],
    patterns: ['\\b(upload|attach|attachment|document|certificate|transcript)\\b'],
    fieldTypes: ['file'],
    policy: 'confirm',
  },

  // ── Long-form / generative ────────────────────────────────────────────────
  {
    id: 'freeform.motivation',
    label: 'Motivation',
    humanPath: 'Generated from Profile + Experience',
    valueType: 'text',
    resolver: 'freeform.motivation',
    aliases: [
      'why do you want to join', 'why do you want to work here',
      'why should we select you', 'why should we hire you',
      'why are you interested', 'why this role', 'why this company',
      'what motivates you', 'reason for applying',
    ],
    patterns: [
      'why\\s+(do|should|are)\\s+you',
      'why\\s+(this|our)\\s+(role|company|position|team)',
      'reason\\s+for\\s+(applying|joining|interest)',
      'what\\s+motivates\\s+you',
    ],
    fieldTypes: ['textarea', 'richtext', 'text', 'unknown'],
    // "Reason for leaving" overlaps heavily with "reason for applying" on tokens but asks
    // the opposite question, and answering it from a motivation prompt would put words in
    // the user's mouth about a former employer.
    negative: ['reason for leaving', 'reason for resignation', 'why are you leaving'],
    policy: 'confirm',
    generative: true,
  },
  {
    id: 'freeform.self_introduction',
    label: 'About you',
    humanPath: 'Generated from Profile',
    valueType: 'text',
    resolver: 'freeform.self_introduction',
    aliases: [
      'tell us about yourself', 'about yourself', 'introduce yourself',
      'about you', 'brief introduction', 'summary', 'professional summary',
      'personal statement', 'bio',
    ],
    patterns: ['\\babout\\s+(your\\s*self|you)\\b', '\\bintroduce\\s+your\\s*self\\b', '\\b(professional\\s*)?summary\\b', '\\bpersonal\\s*statement\\b'],
    fieldTypes: ['textarea', 'richtext', 'text', 'unknown'],
    policy: 'confirm',
    generative: true,
  },
  {
    id: 'freeform.project_description',
    label: 'Project description',
    humanPath: 'Generated from Projects',
    valueType: 'text',
    resolver: 'freeform.project_description',
    aliases: [
      'describe your project', 'project description', 'tell us about your project',
      'describe a project', 'most significant project', 'best project',
    ],
    patterns: ['\\bproject\\b.*\\b(describe|description|about|details)\\b', '\\bdescribe\\b.*\\bproject\\b'],
    fieldTypes: ['textarea', 'richtext', 'text', 'unknown'],
    policy: 'confirm',
    generative: true,
  },
  {
    id: 'freeform.experience_description',
    label: 'Experience description',
    humanPath: 'Generated from Experience',
    valueType: 'text',
    resolver: 'freeform.experience_description',
    aliases: [
      'describe your experience', 'describe your previous experience',
      'relevant experience description', 'tell us about your experience',
      'work experience details',
    ],
    patterns: ['\\bdescribe\\b.*\\bexperience\\b', '\\bexperience\\b.*\\b(describe|details|summary)\\b'],
    fieldTypes: ['textarea', 'richtext', 'text', 'unknown'],
    policy: 'confirm',
    generative: true,
  },
  {
    id: 'freeform.strengths',
    label: 'Strengths',
    humanPath: 'Generated from Profile + Skills',
    valueType: 'text',
    resolver: 'freeform.strengths',
    aliases: ['strengths', 'your strengths', 'key strengths', 'strengths and weaknesses', 'what makes you a good fit'],
    patterns: ['\\bstrengths?\\b', '\\bgood\\s*fit\\b'],
    fieldTypes: ['textarea', 'richtext', 'text', 'unknown'],
    policy: 'confirm',
    generative: true,
  },

  {
    id: 'freeform.other',
    label: 'Additional information',
    humanPath: 'Generated from Profile',
    valueType: 'text',
    resolver: 'freeform.other',
    aliases: [
      'anything else', 'anything else we should know', 'is there anything else',
      'additional information', 'additional details', 'additional comments',
      'other information', 'comments', 'remarks', 'notes', 'further information',
    ],
    patterns: [
      '\\banything\\s+else\\b',
      '\\badditional\\s+(information|details|comments)\\b',
      '^\\s*(comments?|remarks?|notes?)\\s*$',
      '\\bfurther\\s+information\\b',
    ],
    fieldTypes: ['textarea', 'richtext', 'text', 'unknown'],
    policy: 'confirm',
    generative: true,
  },

  // ── Never autofilled ──────────────────────────────────────────────────────
  {
    id: 'auth.password',
    label: 'Password',
    humanPath: '—',
    valueType: 'string',
    resolver: 'blocked',
    aliases: ['password', 'passcode', 'new password', 'confirm password', 'current password', 'pin'],
    patterns: ['\\bpass\\s*(word|code)\\b', '^\\s*pin\\s*$'],
    policy: 'never',
  },
  {
    id: 'auth.otp',
    label: 'One-time code',
    humanPath: '—',
    valueType: 'string',
    resolver: 'blocked',
    aliases: ['otp', 'one time password', 'one time code', 'verification code', 'security code', 'two factor code', 'authentication code'],
    patterns: ['\\botp\\b', '\\bone\\s*time\\s*(password|code)\\b', '\\bverification\\s*code\\b', '\\b2fa\\b'],
    policy: 'never',
  },
  {
    id: 'payment.card_number',
    label: 'Card number',
    humanPath: '—',
    valueType: 'string',
    resolver: 'blocked',
    aliases: ['card number', 'credit card', 'debit card', 'card no', 'account number', 'iban', 'upi id'],
    patterns: ['\\bcard\\s*(number|no)\\b', '\\bcredit\\s*card\\b', '\\bdebit\\s*card\\b', '\\biban\\b', '\\baccount\\s*number\\b'],
    autocomplete: ['cc-number'],
    policy: 'never',
  },
  {
    id: 'payment.cvv',
    label: 'Security code',
    humanPath: '—',
    valueType: 'string',
    resolver: 'blocked',
    aliases: ['cvv', 'cvc', 'card security code', 'cvv2'],
    patterns: ['\\bcvv2?\\b', '\\bcvc\\b'],
    autocomplete: ['cc-csc'],
    policy: 'never',
  },
  {
    id: 'identity.government_id',
    label: 'Government ID',
    humanPath: '—',
    valueType: 'string',
    resolver: 'blocked',
    aliases: ['ssn', 'social security number', 'aadhaar', 'aadhar', 'pan number', 'passport number', 'national id', 'tax id', 'nino'],
    patterns: ['\\bssn\\b', '\\bsocial\\s*security\\b', '\\baadh?aar?\\b', '\\bpan\\s*(number|card)\\b', '\\bpassport\\s*(number|no)\\b', '\\bnational\\s*id\\b'],
    policy: 'never',
  },
  {
    id: 'consent.agreement',
    label: 'Consent / agreement',
    humanPath: '—',
    valueType: 'boolean',
    resolver: 'blocked',
    aliases: [
      'i agree', 'i accept', 'terms and conditions', 'terms of service',
      'privacy policy', 'i consent', 'i certify', 'i declare', 'i confirm that',
      'accept the terms', 'agree to the terms', 'subscribe to newsletter',
      'marketing emails', 'receive updates',
    ],
    patterns: [
      '\\bi\\s+(agree|accept|consent|certify|declare)\\b',
      '\\bterms\\s*(and|&)?\\s*(conditions|of\\s*service)\\b',
      '\\bprivacy\\s*policy\\b',
      '\\b(subscribe|newsletter|marketing\\s*emails)\\b',
    ],
    fieldTypes: ['checkbox', 'checkbox_group', 'radio_group'],
    policy: 'never',
  },
];

/** Concepts that must never be autofilled, regardless of confidence. */
export const BLOCKED_CONCEPT_IDS: readonly string[] = CONCEPTS.filter(
  (c) => c.policy === 'never',
).map((c) => c.id);

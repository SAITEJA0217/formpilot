// Personal Information
export interface PersonalInfo {
  fullName: string;
  email: string;
  phone: string;
  dateOfBirth: string; // ISO format or YYYY-MM-DD
  gender: string;
  address: string;
}

// Education
export interface Education {
  id: string;
  college: string;
  university: string;
  degree: string;
  branch: string;
  graduationYear: string;
  cgpa: string;
}

// Skills
export interface Skills {
  technical: string[];
  soft: string[];
}

// Projects
export interface Project {
  id: string;
  name: string;
  description: string;
  technologies: string[];
}

// Experience
export interface Experience {
  id: string;
  company: string;
  position: string;
  duration?: string;
  startDate?: string;
  endDate?: string;
  isCurrent?: boolean;
  description: string;
}

// Social Links
export interface SocialLinks {
  linkedin: string;
  github: string;
  portfolio: string;
}

// Full Profile
export interface UserProfile {
  userId: string;
  basicProfile: PersonalInfo;
  education: Education[];
  skills: Skills;
  projects: Project[];
  experience: Experience[];
  socialLinks: SocialLinks;
  createdAt: number;
  updatedAt: number;
}

// Form Extraction & AI
export type QuestionType = 'short_answer' | 'paragraph' | 'radio' | 'dropdown' | 'checkbox' | 'date' | 'time' | 'linear_scale' | 'unsupported';

export interface FormQuestion {
  id: string;
  question: string;
  type: QuestionType;
  required: boolean;
  options?: string[]; // Used for radio, dropdown, checkbox
}

export interface AIAnswer {
  question: string; // The original question string
  answer: string | null; // The generated answer
  confidence: number; // 0-100
  source?: 'profile' | 'generated' | 'missing';
  sourceDetail?: string; // e.g. "education[0].degree"
  isGenerated?: boolean; // true if inferred
}

export interface AIResponse {
  answers: AIAnswer[];
}

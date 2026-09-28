/**
 * The benchmark profile.
 *
 * One fixed profile, used by the benchmark and re-exported by the test helpers, so the
 * expected values in `dataset/*.json` can never drift from what the tests assert.
 */
import type { ExtendedUserProfile } from '../../shared/types/profile';

export const BENCHMARK_PROFILE: Partial<ExtendedUserProfile> = {
  userId: 'benchmark-user',
  basicProfile: {
    fullName: 'Saiteja Reddy Kotha',
    email: 'saiteja@example.com',
    phone: '+91 98765 43210',
    dateOfBirth: '2001-07-14',
    gender: 'Male',
    address: '12 MG Road, Hyderabad, Telangana 500081, India',
  },
  education: [
    {
      id: 'e1',
      college: 'Vasavi College of Engineering',
      university: 'Osmania University',
      degree: 'B.Tech',
      branch: 'Computer Science and Engineering',
      graduationYear: '2023',
      cgpa: '8.74',
    },
    {
      id: 'e2',
      college: 'Narayana Junior College',
      university: 'Board of Intermediate Education',
      degree: 'Intermediate',
      branch: 'MPC',
      graduationYear: '2019',
      cgpa: '96.3',
    },
  ],
  skills: {
    technical: ['TypeScript', 'React', 'Node.js', 'Python', 'PostgreSQL'],
    soft: ['Communication', 'Ownership'],
  },
  projects: [
    {
      id: 'p1',
      name: 'FormPilot',
      description: 'A browser extension that understands web forms and drafts grounded answers.',
      technologies: ['TypeScript', 'React', 'Vite'],
    },
  ],
  experience: [
    {
      id: 'x1',
      company: 'Nexturn Solutions',
      position: 'Software Engineer',
      duration: '2 years',
      isCurrent: true,
      description: 'Built internal tooling and data pipelines.',
    },
  ],
  socialLinks: {
    linkedin: 'https://linkedin.com/in/saiteja',
    github: 'https://github.com/saiteja0217',
    portfolio: 'saiteja.dev',
  },
  address: {
    line1: '12 MG Road',
    city: 'Hyderabad',
    state: 'Telangana',
    postalCode: '500081',
    country: 'India',
  },
  languages: ['English', 'Telugu', 'Hindi'],
  documents: [
    { id: 'd1', kind: 'resume', label: 'Saiteja_Resume_2026.pdf', mimeType: 'application/pdf' },
    { id: 'd2', kind: 'cover_letter', label: 'CoverLetter.pdf', mimeType: 'application/pdf' },
  ],
};

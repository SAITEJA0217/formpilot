import { useState, useEffect } from 'react';
import { app, db, doc, getDoc, setDoc } from '../../../shared/utils/firebase';
import { useAuth } from '@/lib/auth-context';
import { UserProfile } from '../../../shared/types';

export function useProfile() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Partial<UserProfile> | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const getEffectiveUid = () => {
    if (user?.uid) return user.uid;
    if (typeof window !== 'undefined') {
      let localUid = localStorage.getItem('formpilot_uid');
      if (!localUid) {
        localUid = 'user_' + Math.random().toString(36).substring(2, 10);
        localStorage.setItem('formpilot_uid', localUid);
      }
      return localUid;
    }
    return 'demo_user_default';
  };

  useEffect(() => {
    async function fetchProfile() {
      const uid = getEffectiveUid();
      let cached: Partial<UserProfile> = {};

      if (typeof window !== 'undefined') {
        const stored = localStorage.getItem('formpilot_user_profile');
        if (stored) {
          try { cached = JSON.parse(stored); } catch (e) {}
        }
      }

      try {
        const docRef = doc(db, 'users', uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const remoteData = docSnap.data() as Partial<UserProfile>;
          const merged = { ...cached, ...remoteData };
          setProfile(merged);
          if (typeof window !== 'undefined') {
            localStorage.setItem('formpilot_user_profile', JSON.stringify(merged));
          }
        } else if (Object.keys(cached).length > 0) {
          setProfile(cached);
        } else {
          setProfile({});
        }
      } catch (error) {
        console.warn("Firestore fetch error, fallback to local storage:", error);
        setProfile(cached);
      } finally {
        setLoading(false);
      }
    }
    fetchProfile();
  }, [user]);

  useEffect(() => {
    if (profile && typeof window !== 'undefined') {
      let score = 0;
      if (profile.basicProfile?.fullName || profile.basicProfile?.email) score += 17;
      if (profile.education?.some((e: any) => e.college || e.degree)) score += 17;
      if (profile.skills && ((profile.skills.technical && profile.skills.technical.length > 0) || (profile.skills.soft && profile.skills.soft.length > 0))) score += 17;
      if (profile.projects?.some((p: any) => p.name || p.description)) score += 17;
      if (profile.experience?.some((e: any) => e.company || e.position)) score += 17;
      if (profile.socialLinks?.linkedin || profile.socialLinks?.github) score += 15;

      window.postMessage({ 
        type: 'FORMPILOT_PROFILE_SYNC',
        detail: { profile, isComplete: score >= 85 } 
      }, '*');
    }
  }, [profile]);

  const updateProfile = async (updates: Partial<UserProfile>) => {
    setSaving(true);
    const uid = getEffectiveUid();
    
    let currentProfile = profile || {};
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('formpilot_user_profile');
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          currentProfile = { ...parsed, ...currentProfile };
        } catch (e) {}
      }
    }

    const newProfile: Partial<UserProfile> = { 
      ...currentProfile, 
      ...updates, 
      updatedAt: Date.now() 
    };

    if (updates.basicProfile) {
      newProfile.basicProfile = { ...(currentProfile.basicProfile || {}), ...updates.basicProfile } as any;
    }
    if (updates.socialLinks) {
      newProfile.socialLinks = { ...(currentProfile.socialLinks || {}), ...updates.socialLinks } as any;
    }
    if (updates.skills) {
      newProfile.skills = { ...(currentProfile.skills || {}), ...updates.skills } as any;
    }
    if (updates.education) newProfile.education = updates.education;
    if (updates.projects) newProfile.projects = updates.projects;
    if (updates.experience) newProfile.experience = updates.experience;

    // 1. Save to LocalStorage for instant reactivity
    if (typeof window !== 'undefined') {
      localStorage.setItem('formpilot_user_profile', JSON.stringify(newProfile));
    }
    
    // 2. Update React state synchronously
    setProfile(newProfile);

    // 3. Save to Firestore asynchronously
    try {
      const docRef = doc(db, 'users', uid);
      await setDoc(docRef, newProfile, { merge: true });
    } catch (error) {
      console.warn("Firestore write error (saved locally):", error);
    } finally {
      setSaving(false);
    }
  };

  const calculateCompletion = () => {
    const defaultVal = { score: 0, breakdown: { personal: 0, education: 0, skills: 0, projects: 0, experience: 0, social: 0 }, missing: [] as string[] };
    if (!profile) return defaultVal;
    
    const missing: string[] = [];

    const hasPersonal = Boolean(
      (profile.basicProfile?.fullName && profile.basicProfile.fullName.trim().length > 0) ||
      (profile.basicProfile?.email && profile.basicProfile.email.trim().length > 0) ||
      (profile.basicProfile?.phone && profile.basicProfile.phone.trim().length > 0)
    );
    if (!hasPersonal) missing.push('Add your Personal Details (Full Name & Email)');

    const hasEducation = Boolean(
      profile.education && profile.education.some((e: any) => (e.college && e.college.trim()) || (e.degree && e.degree.trim()) || (e.branch && e.branch.trim()))
    );
    if (!hasEducation) missing.push('Add your Education history');

    const hasSkills = Boolean(
      profile.skills && ((profile.skills.technical && profile.skills.technical.length > 0) || (profile.skills.soft && profile.skills.soft.length > 0))
    );
    if (!hasSkills) missing.push('Add Technical or Soft Skills');

    const hasProjects = Boolean(
      profile.projects && profile.projects.some((p: any) => (p.name && p.name.trim()) || (p.description && p.description.trim()))
    );
    if (!hasProjects) missing.push('Add at least one Project');

    const hasExperience = Boolean(
      profile.experience && profile.experience.some((e: any) => (e.company && e.company.trim()) || (e.position && e.position.trim()))
    );
    if (!hasExperience) missing.push('Add your Work Experience');

    const hasSocial = Boolean(
      (profile.socialLinks?.linkedin && profile.socialLinks.linkedin.trim().length > 0) ||
      (profile.socialLinks?.github && profile.socialLinks.github.trim().length > 0) ||
      (profile.socialLinks?.portfolio && profile.socialLinks.portfolio.trim().length > 0)
    );
    if (!hasSocial) missing.push('Add a LinkedIn or GitHub profile (Social)');

    const completedSections = [hasPersonal, hasEducation, hasSkills, hasProjects, hasExperience, hasSocial].filter(Boolean).length;
    const score = completedSections === 6 ? 100 : Math.round((completedSections / 6) * 100);

    const breakdown = {
      personal: hasPersonal ? 17 : 0,
      education: hasEducation ? 17 : 0,
      skills: hasSkills ? 17 : 0,
      projects: hasProjects ? 17 : 0,
      experience: hasExperience ? 17 : 0,
      social: hasSocial ? 15 : 0,
    };

    return { score, breakdown, missing };
  };

  const completion = calculateCompletion();

  return { profile, loading, saving, updateProfile, completionPercentage: completion.score, completion };
}

"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useProfile } from '@/hooks/useProfile';
import { UserProfile } from '@/../../shared/types';
import { toast } from 'sonner';
import { Plus, Trash2, Clock, ArrowRight, ArrowLeft, Check } from 'lucide-react';
import { TagInput } from '@/components/ui/tag-input';
import { useRouter } from 'next/navigation';

interface ProfileFormProps {
  initialData: Partial<UserProfile>;
}

export default function ProfileForm({ initialData }: ProfileFormProps) {
  const { updateProfile, saving } = useProfile();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('personal');

  const tabList = ['personal', 'education', 'skills', 'projects', 'experience', 'social'];
  
  // Local state for forms
  const [personal, setPersonal] = useState(initialData.basicProfile || {
    fullName: '', email: '', phone: '', dateOfBirth: '', gender: '', address: ''
  });
  
  const [social, setSocial] = useState(initialData.socialLinks || {
    linkedin: '', github: '', portfolio: ''
  });

  const [skills, setSkills] = useState(initialData.skills || {
    technical: [], soft: []
  });

  const ensureIds = (arr: any[]) => arr.map((item: any) => item.id ? item : { ...item, id: Math.random().toString(36).substring(7) });

  const [education, setEducation] = useState<any[]>(ensureIds(initialData.education || []));
  const [projects, setProjects] = useState<any[]>(ensureIds(initialData.projects || []));
  const [experience, setExperience] = useState<any[]>(ensureIds(initialData.experience || []));

  const isInitialized = React.useRef(false);
  const saveTimerRef = React.useRef<NodeJS.Timeout | null>(null);

  // Sync state only on initial mount or when data first arrives from empty state
  useEffect(() => {
    if (!isInitialized.current && initialData && Object.keys(initialData).length > 0) {
      if (initialData.basicProfile) setPersonal(initialData.basicProfile);
      if (initialData.socialLinks) setSocial(initialData.socialLinks);
      if (initialData.skills) setSkills(initialData.skills);
      if (initialData.education) setEducation(ensureIds(initialData.education));
      if (initialData.projects) setProjects(ensureIds(initialData.projects));
      if (initialData.experience) setExperience(ensureIds(initialData.experience));
      isInitialized.current = true;
    }
  }, [initialData]);

  // Snappy auto-save logic (400ms debounce)
  const handleAutoSave = useCallback((updates: Partial<UserProfile>) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    
    saveTimerRef.current = setTimeout(async () => {
      try {
        await updateProfile(updates);
      } catch (err) {
        console.warn("Auto save error:", err);
      }
    }, 400);
  }, [updateProfile]);

  const handlePersonalChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const newPersonal = { ...personal, [e.target.name]: e.target.value };
    setPersonal(newPersonal);
    handleAutoSave({ basicProfile: newPersonal });
  };

  const handleSocialChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newSocial = { ...social, [e.target.name]: e.target.value };
    setSocial(newSocial);
    handleAutoSave({ socialLinks: newSocial });
  };

  const handleTechnicalSkillsChange = (tags: string[]) => {
    const newSkills = { ...skills, technical: tags };
    setSkills(newSkills);
    handleAutoSave({ skills: newSkills });
  };

  const handleSoftSkillsChange = (tags: string[]) => {
    const newSkills = { ...skills, soft: tags };
    setSkills(newSkills);
    handleAutoSave({ skills: newSkills });
  };

  const updateEducation = (newEdu: any[]) => {
    setEducation(newEdu);
    handleAutoSave({ education: newEdu });
  };

  const updateProjects = (newProj: any[]) => {
    setProjects(newProj);
    handleAutoSave({ projects: newProj });
  };

  const updateExperience = (newExp: any[]) => {
    setExperience(newExp);
    handleAutoSave({ experience: newExp });
  };

  const handleManualSave = async () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    try {
      await updateProfile({ 
        basicProfile: personal, 
        socialLinks: social, 
        skills, 
        education, 
        projects, 
        experience 
      });
      toast.success("Profile saved successfully");
    } catch (err: any) {
      console.error("Save profile error:", err);
      toast.error(err.message || "Failed to save profile");
    }
  };

  const handleNextTab = async () => {
    const currentIndex = tabList.indexOf(activeTab);
    await handleManualSave();
    
    if (currentIndex < tabList.length - 1) {
      setActiveTab(tabList[currentIndex + 1]);
    } else {
      toast.success("Profile completed! Redirecting to Dashboard...");
      setTimeout(() => {
        router.push('/dashboard');
      }, 800);
    }
  };

  const handlePrevTab = () => {
    const currentIndex = tabList.indexOf(activeTab);
    if (currentIndex > 0) {
      setActiveTab(tabList[currentIndex - 1]);
    }
  };

  return (
    <div className="space-y-6">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid grid-cols-2 md:grid-cols-6 mb-8 group-data-horizontal/tabs:h-auto gap-2 p-1">
          <TabsTrigger value="personal" className="py-2">Personal</TabsTrigger>
          <TabsTrigger value="education" className="py-2">Education</TabsTrigger>
          <TabsTrigger value="skills" className="py-2">Skills</TabsTrigger>
          <TabsTrigger value="projects" className="py-2">Projects</TabsTrigger>
          <TabsTrigger value="experience" className="py-2">Experience</TabsTrigger>
          <TabsTrigger value="social" className="py-2">Social</TabsTrigger>
        </TabsList>

      <div className="relative">
        {saving && (
          <div className="absolute top-[-30px] right-0 text-sm text-gray-500 flex items-center">
            <span className="animate-pulse mr-2 h-2 w-2 bg-indigo-500 rounded-full"></span> Saving...
          </div>
        )}

        <TabsContent value="personal" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="fullName">Full Name</Label>
              <Input id="fullName" name="fullName" value={personal.fullName} onChange={handlePersonalChange} placeholder="John Doe" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" value={personal.email} onChange={handlePersonalChange} placeholder="john@example.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number</Label>
              <Input id="phone" name="phone" value={personal.phone} onChange={handlePersonalChange} placeholder="+1 234 567 890" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dateOfBirth">Date of Birth</Label>
              <Input id="dateOfBirth" name="dateOfBirth" type="date" value={personal.dateOfBirth} onChange={handlePersonalChange} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gender">Gender</Label>
              <Select value={personal.gender} onValueChange={(value) => {
                const newPersonal = { ...personal, gender: value || '' };
                setPersonal(newPersonal);
                handleAutoSave({ basicProfile: newPersonal });
              }}>
                <SelectTrigger id="gender">
                  <SelectValue placeholder="Select Gender" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Male">Male</SelectItem>
                  <SelectItem value="Female">Female</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                  <SelectItem value="Prefer not to say">Prefer not to say</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="address">Address</Label>
              <Textarea id="address" name="address" value={personal.address} onChange={handlePersonalChange} placeholder="123 Main St, City, Country" />
            </div>
          </div>
        </TabsContent>

        {/* Education */}
        <TabsContent value="education" className="space-y-4">
          {education.map((edu: any) => (
            <div key={edu.id} className="p-6 border rounded-lg relative space-y-4 bg-gray-50 dark:bg-gray-900/50">
              <button 
                onClick={() => updateEducation(education.filter(e => e.id !== edu.id))}
                className="absolute top-4 right-4 text-red-500 hover:text-red-700"
              >
                <Trash2 className="w-5 h-5" />
              </button>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>College / University</Label>
                  <Input value={edu.college || ''} onChange={e => updateEducation(education.map(item => item.id === edu.id ? { ...item, college: e.target.value } : item))} />
                </div>
                <div>
                  <Label>Degree</Label>
                  <Input value={edu.degree || ''} onChange={e => updateEducation(education.map(item => item.id === edu.id ? { ...item, degree: e.target.value } : item))} />
                </div>
                <div>
                  <Label>Branch / Major</Label>
                  <Input value={edu.branch || ''} onChange={e => updateEducation(education.map(item => item.id === edu.id ? { ...item, branch: e.target.value } : item))} />
                </div>
                <div>
                  <Label>Graduation Year</Label>
                  <Input value={edu.graduationYear || ''} onChange={e => updateEducation(education.map(item => item.id === edu.id ? { ...item, graduationYear: e.target.value } : item))} />
                </div>
                <div>
                  <Label>CGPA</Label>
                  <Input value={edu.cgpa || ''} onChange={e => updateEducation(education.map(item => item.id === edu.id ? { ...item, cgpa: e.target.value } : item))} />
                </div>
              </div>
            </div>
          ))}
          <Button variant="outline" onClick={() => updateEducation([...education, { id: Date.now().toString(), college: '', degree: '', branch: '', graduationYear: '', cgpa: '' }])} className="w-full">
            <Plus className="w-4 h-4 mr-2" /> Add Education
          </Button>
        </TabsContent>

        {/* Projects */}
        <TabsContent value="projects" className="space-y-4">
          {projects.map((proj: any) => (
            <div key={proj.id} className="p-6 border rounded-lg relative space-y-4 bg-gray-50 dark:bg-gray-900/50">
              <button 
                onClick={() => updateProjects(projects.filter(p => p.id !== proj.id))}
                className="absolute top-4 right-4 text-red-500 hover:text-red-700"
              >
                <Trash2 className="w-5 h-5" />
              </button>
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <Label>Project Name</Label>
                  <Input value={proj.name || ''} onChange={e => updateProjects(projects.map(item => item.id === proj.id ? { ...item, name: e.target.value } : item))} />
                </div>
                <div>
                  <Label>Technologies (comma separated)</Label>
                  <Input value={proj.technologies?.join(', ') || ''} onChange={e => updateProjects(projects.map(item => item.id === proj.id ? { ...item, technologies: e.target.value.split(',').map((s: string)=>s.trim()) } : item))} />
                </div>
                <div>
                  <Label>Description</Label>
                  <Textarea value={proj.description || ''} onChange={e => updateProjects(projects.map(item => item.id === proj.id ? { ...item, description: e.target.value } : item))} />
                </div>
              </div>
            </div>
          ))}
          <Button variant="outline" onClick={() => updateProjects([...projects, { id: Date.now().toString(), name: '', description: '', technologies: [] }])} className="w-full">
            <Plus className="w-4 h-4 mr-2" /> Add Project
          </Button>
        </TabsContent>

        {/* Experience */}
        <TabsContent value="experience" className="space-y-4">
          {experience.map((exp: any) => (
            <div key={exp.id} className="p-6 border rounded-lg relative space-y-4 bg-gray-50 dark:bg-gray-900/50">
              <button 
                onClick={() => updateExperience(experience.filter(e => e.id !== exp.id))}
                className="absolute top-4 right-4 text-red-500 hover:text-red-700"
              >
                <Trash2 className="w-5 h-5" />
              </button>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Company</Label>
                  <Input value={exp.company || ''} onChange={e => updateExperience(experience.map(item => item.id === exp.id ? { ...item, company: e.target.value } : item))} />
                </div>
                <div>
                  <Label>Position</Label>
                  <Input value={exp.position || ''} onChange={e => updateExperience(experience.map(item => item.id === exp.id ? { ...item, position: e.target.value } : item))} />
                </div>
                <div>
                  <Label>Start Date</Label>
                  <Input type="date" value={exp.startDate || ''} onChange={e => updateExperience(experience.map(item => item.id === exp.id ? { ...item, startDate: e.target.value } : item))} />
                </div>
                <div>
                  <Label>End Date</Label>
                  <Input type="date" value={exp.endDate || ''} disabled={exp.isCurrent} onChange={e => updateExperience(experience.map(item => item.id === exp.id ? { ...item, endDate: e.target.value } : item))} />
                </div>
                <div className="flex items-center space-x-2 md:col-span-2 mt-[-8px]">
                  <input type="checkbox" id={`current-${exp.id}`} checked={exp.isCurrent || false} onChange={e => updateExperience(experience.map(item => item.id === exp.id ? { ...item, isCurrent: e.target.checked, endDate: e.target.checked ? '' : item.endDate } : item))} className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600" />
                  <Label htmlFor={`current-${exp.id}`} className="font-normal cursor-pointer">I currently work here</Label>
                </div>
                <div className="md:col-span-2">
                  <Label>Description</Label>
                  <Textarea value={exp.description || ''} onChange={e => updateExperience(experience.map(item => item.id === exp.id ? { ...item, description: e.target.value } : item))} />
                </div>
              </div>
            </div>
          ))}
          <Button variant="outline" onClick={() => updateExperience([...experience, { id: Date.now().toString(), company: '', position: '', startDate: '', endDate: '', isCurrent: false, description: '' }])} className="w-full">
            <Plus className="w-4 h-4 mr-2" /> Add Experience
          </Button>
        </TabsContent>

          <TabsContent value="skills" className="space-y-4">
            <div className="grid grid-cols-1 gap-6">
              <div className="space-y-2">
                <Label htmlFor="technical">Technical Skills</Label>
                <TagInput id="technical" tags={skills.technical || []} onChange={handleTechnicalSkillsChange} placeholder="React, Node.js, Python..." />
              </div>
              <div className="space-y-2">
                <Label htmlFor="soft">Soft Skills</Label>
                <TagInput id="soft" tags={skills.soft || []} onChange={handleSoftSkillsChange} placeholder="Leadership, Communication..." />
              </div>
            </div>
          </TabsContent>

        <TabsContent value="social" className="space-y-4">
          <div className="grid grid-cols-1 gap-6">
            <div className="space-y-2">
              <Label htmlFor="linkedin">LinkedIn URL</Label>
              <Input id="linkedin" name="linkedin" value={social.linkedin} onChange={handleSocialChange} placeholder="https://linkedin.com/in/johndoe" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="github">GitHub URL</Label>
              <Input id="github" name="github" value={social.github} onChange={handleSocialChange} placeholder="https://github.com/johndoe" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="portfolio">Portfolio URL</Label>
              <Input id="portfolio" name="portfolio" value={social.portfolio} onChange={handleSocialChange} placeholder="https://johndoe.com" />
            </div>
          </div>
        </TabsContent>
      </div>
    </Tabs>

      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-8 pt-6 border-t border-gray-200 dark:border-gray-800">
        <Button 
          type="button"
          variant="outline" 
          onClick={handlePrevTab} 
          disabled={activeTab === 'personal' || saving}
          className="w-full sm:w-auto flex items-center gap-2 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" /> Previous Section
        </Button>

        <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
          <Button 
            type="button"
            onClick={handleManualSave} 
            disabled={saving} 
            variant="secondary"
            className="w-full sm:w-auto border border-gray-200 dark:border-gray-800 cursor-pointer"
          >
            {saving ? 'Saving...' : 'Save Profile'}
          </Button>

          <Button 
            type="button"
            onClick={handleNextTab} 
            disabled={saving} 
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium w-full sm:w-auto flex items-center gap-2 cursor-pointer"
          >
            {activeTab === 'social' ? (
              <>Finish & View Dashboard <Check className="w-4 h-4" /></>
            ) : (
              <>Next Section <ArrowRight className="w-4 h-4" /></>
            )}
          </Button>
        </div>
      </div>
  </div>
  );
}

"use client";

import { useProfile } from '@/hooks/useProfile';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import ProfileForm from '@/components/profile/ProfileForm';
import { ResumeUploadWidget } from '@/components/profile/ResumeUploadWidget';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';
import { AlertCircle, BrainCircuit, CheckCircle2, Copy, Sparkles, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';

export default function ProfilePage() {
  const { profile, loading, completion } = useProfile();
  const router = useRouter();

  if (loading) {
    return (
      <div className="space-y-6 max-w-6xl mx-auto pb-12 w-full animate-in fade-in duration-500 pt-4">
        <div className="mb-8">
          <div className="h-10 w-48 bg-slate-800/50 rounded-lg animate-pulse mb-3"></div>
          <div className="h-5 w-80 bg-slate-800/50 rounded-lg animate-pulse"></div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 rounded-2xl h-[600px] bg-slate-800/30 animate-pulse border border-white/5"></div>
          <div className="space-y-6">
            <div className="rounded-2xl h-48 bg-slate-800/30 animate-pulse border border-white/5"></div>
            <div className="rounded-2xl h-48 bg-slate-800/30 animate-pulse border border-white/5"></div>
          </div>
        </div>
      </div>
    );
  }

  const handleCopyBio = () => {
    if (!profile) return;
    const name = profile.basicProfile?.fullName || 'A professional';
    const expCount = profile.experience?.length || 0;
    const title = profile.experience?.[0]?.position || 'professional';
    const skills = profile.skills?.technical?.slice(0, 3).join(', ') || '';
    
    let bio = `${name} is a ${title}`;
    if (expCount > 0) bio += ` with experience at ${profile.experience?.[0]?.company}`;
    if (skills) bio += `, specializing in ${skills}`;
    bio += '.';
    
    navigator.clipboard.writeText(bio);
    toast.success('AI Bio copied to clipboard!');
  };

  const handleCopySkills = () => {
    if (!profile?.skills) {
      toast.error('No skills found in profile.');
      return;
    }
    const skillsList = [...(profile.skills.technical || []), ...(profile.skills.soft || [])].join(', ');
    if (skillsList) {
      navigator.clipboard.writeText(skillsList);
      toast.success('Skills copied to clipboard!');
    } else {
      toast.error('No skills found in profile.');
    }
  };

  const handleCopyLinkedIn = () => {
    if (!profile?.socialLinks?.linkedin) {
      toast.error('No LinkedIn URL found.');
      return;
    }
    navigator.clipboard.writeText(profile.socialLinks.linkedin);
    toast.success('LinkedIn URL copied to clipboard!');
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12 animate-in fade-in duration-500">
      <button 
        onClick={() => router.back()} 
        className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white bg-slate-900/80 hover:bg-slate-800 px-3.5 py-1.5 rounded-full border border-white/10 transition-all w-fit cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <div>
        <h2 className="text-3xl font-bold tracking-tight text-white flex items-center gap-2">
          <BrainCircuit className="w-8 h-8 text-indigo-400" />
          AI Knowledge Base
        </h2>
        <p className="text-slate-400 mt-2">Manage the core identity that FormPilot uses to generate your answers.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Column */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-slate-900/80 rounded-2xl shadow-xl shadow-black/20 border border-white/10 p-6 backdrop-blur-xl">
            <ProfileForm initialData={profile || {}} />
          </div>
        </div>

        {/* Sidebar Column */}
        <div className="space-y-6">
          
          {/* AI Readiness Score */}
          <Card className="bg-slate-900/50 border-slate-800">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Sparkles className="w-5 h-5 text-amber-400" />
                AI Readiness Score
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4 mb-4">
                <Progress value={completion?.score || 0} className="w-full" />
                <span className="font-medium text-sm text-slate-200">
                  {completion?.score || 0}%
                </span>
              </div>
              
              {completion?.missing && completion.missing.length > 0 ? (
                <div className="space-y-2 mt-4">
                  <p className="text-sm text-slate-400 font-medium">Missing Information:</p>
                  <ul className="space-y-1">
                    {completion.missing.map((item: string, i: number) => (
                      <li key={i} className="text-xs text-amber-400/90 flex items-start gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-emerald-400 text-sm mt-4 bg-emerald-400/10 p-2 rounded-lg border border-emerald-400/20">
                  <CheckCircle2 className="w-4 h-4" />
                  Your profile is fully optimized for AI!
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick Copy Buttons */}
          <Card className="bg-slate-900/50 border-slate-800">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button variant="outline" className="w-full justify-start text-sm bg-slate-800/50 border-slate-700 hover:bg-slate-800" onClick={handleCopyBio}>
                <Copy className="w-4 h-4 mr-2" /> Copy AI Bio
              </Button>
              <Button variant="outline" className="w-full justify-start text-sm bg-slate-800/50 border-slate-700 hover:bg-slate-800" onClick={handleCopySkills}>
                <Copy className="w-4 h-4 mr-2" /> Copy Skills List
              </Button>
              <Button variant="outline" className="w-full justify-start text-sm bg-slate-800/50 border-slate-700 hover:bg-slate-800" onClick={handleCopyLinkedIn}>
                <Copy className="w-4 h-4 mr-2" /> Copy LinkedIn URL
              </Button>
            </CardContent>
          </Card>

          {/* Resume Upload */}
          <ResumeUploadWidget />

        </div>
      </div>
    </div>
  );
}

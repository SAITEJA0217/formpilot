"use client";

import { useState } from 'react';
import { useProfile } from '@/hooks/useProfile';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';
import { UploadCloud, FileText, AlertCircle, ArrowRight, Loader2, Sparkles, CheckCircle2, ArrowLeft } from 'lucide-react';
import { UserProfile } from '../../../../../shared/types';
import { Button } from '@/components/ui/button';

export default function ResumeIntelligencePage() {
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsedData, setParsedData] = useState<Partial<UserProfile> | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  
  const { updateProfile } = useProfile();
  const { user } = useAuth();
  const router = useRouter();

  // Missing fields checking
  const missingFields: string[] = [];
  if (parsedData) {
    if (!parsedData.basicProfile?.phone) missingFields.push("Phone Number");
    if (!parsedData.basicProfile?.email) missingFields.push("Email Address");
    if (!parsedData.skills?.technical?.length) missingFields.push("Technical Skills");
    if (!parsedData.experience?.length) missingFields.push("Work Experience");
  }

  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileSelection(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileSelection(e.target.files[0]);
    }
  };

  const handleFileSelection = async (selectedFile: File) => {
    if (selectedFile.type !== 'application/pdf') {
      alert("Please upload a PDF file.");
      return;
    }
    setFile(selectedFile);
    await parseResume(selectedFile);
  };

  const parseResume = async (pdfFile: File) => {
    setIsParsing(true);
    setParseError(null);
    try {
      // Get Firebase ID token for authenticated API call
      let authToken = '';
      if (user) {
        try {
          authToken = await user.getIdToken();
        } catch (tokenErr) {
          console.warn('Could not get auth token:', tokenErr);
        }
      }

      if (!authToken) {
        throw new Error('You must be signed in to parse a resume. Please log in and try again.');
      }

      const formData = new FormData();
      formData.append('resume', pdfFile);
      
      const res = await fetch('/api/ai/parse-resume', {
        method: 'POST',
        body: formData,
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });
      
      let data;
      try {
        data = await res.json();
      } catch (e) {
        throw new Error("Server returned an invalid response. The file may be too large or the server crashed.");
      }
      
      if (!res.ok) {
        throw new Error(data.error || "Failed to parse resume");
      }
      
      // Sanitize all null values → "" so React controlled inputs don't warn
      const sanitized = JSON.parse(JSON.stringify(data, (_k, v) => v === null ? '' : v));
      setParsedData(sanitized);
    } catch (err: any) {
      console.error(err);
      setParseError(err.message || "An unexpected error occurred while parsing.");
      setFile(null);
    } finally {
      setIsParsing(false);
    }
  };

  const handleSave = async () => {
    if (!parsedData) return;
    setIsSaving(true);
    try {
      await updateProfile(parsedData);
      router.push('/dashboard');
    } catch (err) {
      console.error(err);
      alert("Error saving profile");
    } finally {
      setIsSaving(false);
    }
  };

  const handleBasicInfoChange = (field: string, value: string) => {
    if (!parsedData) return;
    setParsedData({
      ...parsedData,
      basicProfile: {
        ...parsedData.basicProfile,
        [field]: value
      } as any
    });
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pt-4">
      <button 
        onClick={() => router.back()} 
        className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white bg-slate-900/80 hover:bg-slate-800 px-3.5 py-1.5 rounded-full border border-white/10 transition-all w-fit cursor-pointer"
      >
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-8">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-white mb-2">
            Resume Intelligence
          </h2>
          <p className="text-slate-400">Upload your PDF resume. Our AI will extract your profile instantly.</p>
        </div>
      </div>

      {parseError && !isParsing && (
        <div className="w-full max-w-3xl mx-auto rounded-3xl p-6 bg-red-500/10 border border-red-500/20 text-center mb-8">
          <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-3" />
          <h3 className="text-lg font-bold text-red-200 mb-1">Upload Failed</h3>
          <p className="text-red-300/80 text-sm">{parseError}</p>
          <Button 
            variant="ghost" 
            onClick={() => setParseError(null)}
            className="mt-4 text-red-400 hover:text-red-300 hover:bg-red-500/10"
          >
            Try Again
          </Button>
        </div>
      )}

      {!file && !isParsing && !parseError && (
        <div 
          className={`w-full max-w-3xl mx-auto border-2 border-dashed rounded-3xl p-12 text-center transition-colors ${
            isDragging ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-700 bg-slate-900/50 hover:bg-slate-900 hover:border-slate-600'
          }`}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleFileDrop}
        >
          <div className="w-20 h-20 rounded-2xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center mx-auto mb-6">
            <UploadCloud className="w-10 h-10" />
          </div>
          <h3 className="text-xl font-bold text-slate-200 mb-2">Drag & Drop your Resume</h3>
          <p className="text-slate-400 mb-8">Supports PDF format (Max 5MB)</p>
          
          <label className="cursor-pointer inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-xl font-semibold transition-all shadow-[0_0_20px_rgba(79,70,229,0.3)] hover:scale-105">
            <FileText className="w-5 h-5" />
            Select PDF File
            <input type="file" accept="application/pdf" className="hidden" onChange={handleFileChange} />
          </label>
        </div>
      )}

      {isParsing && (
        <div className="w-full max-w-3xl mx-auto rounded-3xl p-12 bg-slate-900/50 border border-white/5 text-center flex flex-col items-center justify-center min-h-[400px]">
          <Loader2 className="w-12 h-12 text-indigo-500 animate-spin mb-6" />
          <h3 className="text-xl font-bold text-slate-200 mb-2 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-400" /> AI is extracting your profile...
          </h3>
          <p className="text-slate-400 max-w-md">This usually takes about 5-10 seconds. We're reading your experience, skills, and projects.</p>
        </div>
      )}

      {parsedData && !isParsing && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Preview Column */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-slate-900/80 border border-white/10 rounded-3xl p-8 backdrop-blur-xl">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-white">Basic Information</h3>
                <span className="text-xs text-indigo-400 bg-indigo-500/10 px-3 py-1 rounded-full font-medium flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Extracted
                </span>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-400">Full Name</label>
                  <input 
                    type="text" 
                    value={parsedData.basicProfile?.fullName || ''} 
                    onChange={(e) => handleBasicInfoChange('fullName', e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-slate-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-400">Email Address</label>
                  <input 
                    type="email" 
                    value={parsedData.basicProfile?.email || ''} 
                    onChange={(e) => handleBasicInfoChange('email', e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-slate-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-400">Phone Number</label>
                  <input 
                    type="text" 
                    value={parsedData.basicProfile?.phone || ''} 
                    onChange={(e) => handleBasicInfoChange('phone', e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-slate-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>
            </div>

            <div className="bg-slate-900/80 border border-white/10 rounded-3xl p-8 backdrop-blur-xl">
              <h3 className="text-xl font-bold text-white mb-6">Experience & Projects</h3>
              <div className="space-y-4">
                {parsedData.experience?.map((exp, i) => (
                  <div key={i} className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                    <div className="font-semibold text-slate-200">{exp.position}</div>
                    <div className="text-sm text-indigo-400">{exp.company} • {exp.duration}</div>
                    <p className="text-sm text-slate-400 mt-2 line-clamp-2">{exp.description}</p>
                  </div>
                ))}
                {parsedData.projects?.map((proj, i) => (
                  <div key={`proj-${i}`} className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                    <div className="font-semibold text-slate-200">{proj.name}</div>
                    <div className="text-sm text-indigo-400 mt-1">{proj.technologies?.join(', ')}</div>
                    <p className="text-sm text-slate-400 mt-2 line-clamp-2">{proj.description}</p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-slate-500 mt-4 text-center">You can edit full details on your Profile page later.</p>
            </div>
          </div>

          {/* Completeness Engine Column */}
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-slate-900/80 border border-white/10 rounded-3xl p-6 backdrop-blur-xl relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/10 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2"></div>
              
              <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                Completeness Check
              </h3>
              
              {missingFields.length > 0 ? (
                <div className="space-y-3 mb-6">
                  <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-sm text-amber-200 flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 shrink-0 text-amber-400 mt-0.5" />
                    <div>
                      <span className="font-semibold block mb-1">Missing Information</span>
                      We couldn't extract the following fields from your resume:
                      <ul className="list-disc pl-4 mt-2 space-y-1 text-amber-200/80">
                        {missingFields.map(field => <li key={field}>{field}</li>)}
                      </ul>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-sm text-emerald-200 flex items-center gap-3 mb-6">
                  <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-400" />
                  <div>
                    <span className="font-semibold block">Looks Great!</span>
                    We extracted all essential fields successfully.
                  </div>
                </div>
              )}

              <div className="border-t border-slate-800 pt-6">
                <Button 
                  onClick={handleSave} 
                  disabled={isSaving}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 text-white h-12 rounded-xl font-bold shadow-[0_0_20px_rgba(79,70,229,0.3)] transition-all hover:scale-105"
                >
                  {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Sparkles className="w-4 h-4 mr-2" /> Save to Profile</>}
                </Button>
                <p className="text-xs text-slate-500 mt-3 text-center">This will merge with your existing profile data.</p>
              </div>
            </div>
            
            <div className="bg-slate-900/80 border border-white/10 rounded-3xl p-6 backdrop-blur-xl">
               <h3 className="text-sm font-bold text-slate-300 mb-4">Extracted Skills</h3>
               <div className="flex flex-wrap gap-2">
                 {parsedData.skills?.technical?.map((skill, i) => (
                   <span key={i} className="px-2.5 py-1 bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs rounded-lg font-medium">
                     {skill}
                   </span>
                 ))}
               </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

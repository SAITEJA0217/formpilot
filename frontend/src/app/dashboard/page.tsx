"use client";

import { useAuth } from '@/lib/auth-context';
import { useProfile } from '@/hooks/useProfile';
import { User as UserIcon, ArrowRight, Loader2, Sparkles, UploadCloud, Settings, Clock } from 'lucide-react';
import Link from 'next/link';

export default function DashboardPage() {
  const { user } = useAuth();
  const { profile, loading, completionPercentage } = useProfile();

  if (loading) {
    return (
      <div className="space-y-8 animate-in fade-in duration-500 pt-4 w-full">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-8">
          <div>
            <div className="h-10 w-64 bg-slate-800/50 rounded-lg animate-pulse mb-3"></div>
            <div className="h-6 w-96 bg-slate-800/50 rounded-lg animate-pulse"></div>
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 rounded-3xl h-64 bg-slate-800/30 animate-pulse border border-white/5"></div>
          <div className="rounded-3xl h-64 bg-slate-800/30 animate-pulse border border-white/5"></div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 rounded-3xl h-[280px] bg-slate-800/30 animate-pulse border border-white/5"></div>
          <div className="lg:col-span-2 rounded-3xl h-[280px] bg-slate-800/30 animate-pulse border border-white/5"></div>
        </div>
      </div>
    );
  }

  const skillCount = (profile?.skills?.technical?.length || 0) + (profile?.skills?.soft?.length || 0);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pt-4">
      
      {/* Personalized Greeting */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-8">
        <div>
          <h2 className="text-4xl font-bold tracking-tight text-white mb-2">
            Welcome back, <span className="bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">{user?.displayName || 'User'}</span>!
          </h2>
          <p className="text-slate-400 text-lg">Ready to conquer your next application?</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Profile Completion Hero Card (Takes up 2 columns on lg) */}
        <div className="lg:col-span-2 rounded-3xl p-8 bg-gradient-to-br from-slate-900/80 to-slate-900 border border-white/10 backdrop-blur-xl relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
          
          <div className="relative z-10 flex flex-col md:flex-row gap-8 items-center justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-5 h-5 text-indigo-400" />
                <h3 className="text-xl font-bold text-white">Profile Completion</h3>
              </div>
              <p className="text-slate-400 mb-6 max-w-md">
                {completionPercentage === 100 
                  ? "Your profile is fully optimized. The AI is ready to generate high-quality answers for any application." 
                  : "Complete your profile to increase the AI's accuracy and generate better answers for your applications."}
              </p>
              
              <div className="w-full bg-slate-800 rounded-full h-2.5 mb-2">
                <div 
                  className="bg-gradient-to-r from-indigo-500 to-purple-500 h-2.5 rounded-full transition-all duration-1000 ease-out shadow-[0_0_15px_rgba(99,102,241,0.5)]" 
                  style={{ width: `${completionPercentage}%` }}
                ></div>
              </div>
              <div className="flex justify-between text-sm font-medium">
                <span className="text-slate-400">Progress</span>
                <span className="text-indigo-400">{completionPercentage}%</span>
              </div>
            </div>
            
            <div className="shrink-0 flex items-center justify-center p-6 bg-slate-950/50 rounded-2xl border border-white/5">
              <Link 
                href="/dashboard/profile"
                className="inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-xl font-semibold transition-all shadow-[0_0_20px_rgba(79,70,229,0.3)] hover:scale-105"
              >
                {completionPercentage === 100 ? "Update Profile" : "Complete Profile"} <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </div>

        {/* Extension Status Card */}
        <div className="rounded-3xl p-8 bg-slate-900/80 border border-white/10 backdrop-blur-xl flex flex-col justify-center relative overflow-hidden">
           <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2"></div>
           <h3 className="text-lg font-bold text-white mb-6">Extension Status</h3>
           <div className="flex items-center gap-4 bg-slate-950/50 p-4 rounded-2xl border border-white/5">
             <div className="relative flex h-4 w-4 shrink-0">
               <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
               <span className="relative inline-flex rounded-full h-4 w-4 bg-emerald-500"></span>
             </div>
             <div>
               <div className="font-semibold text-emerald-400">Active & Ready</div>
               <div className="text-xs text-slate-500">Connected to Chrome</div>
             </div>
           </div>
           
           <div className="mt-6 flex justify-between items-center text-sm">
              <span className="text-slate-400">Total Skills Saved</span>
              <span className="font-bold text-white bg-slate-800 px-3 py-1 rounded-lg">{skillCount}</span>
           </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Quick Actions */}
        <div className="lg:col-span-1 space-y-4">
          <h3 className="text-xl font-bold text-white mb-4">Quick Actions</h3>
          
          <Link href="/dashboard/resume" className="flex items-center gap-4 p-4 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-indigo-500/30 transition-all group">
            <div className="w-10 h-10 rounded-lg bg-indigo-500/20 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
              <UploadCloud className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <div className="font-semibold text-slate-200">Upload Resume</div>
              <div className="text-xs text-slate-400">Let AI extract your details</div>
            </div>
          </Link>
          
          <Link href="/dashboard/profile" className="flex items-center gap-4 p-4 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-indigo-500/30 transition-all group">
            <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
              <UserIcon className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <div className="font-semibold text-slate-200">Edit Profile</div>
              <div className="text-xs text-slate-400">Manage experience & projects</div>
            </div>
          </Link>
          
          <button className="w-full flex items-center gap-4 p-4 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-indigo-500/30 transition-all group text-left cursor-not-allowed opacity-70">
            <div className="w-10 h-10 rounded-lg bg-slate-500/20 flex items-center justify-center shrink-0">
              <Settings className="w-5 h-5 text-slate-400" />
            </div>
            <div>
              <div className="font-semibold text-slate-200">Settings</div>
              <div className="text-xs text-slate-400">Preferences (Coming soon)</div>
            </div>
          </button>
        </div>

        {/* Recent Activity */}
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
             <h3 className="text-xl font-bold text-white">Recent Activity</h3>
             <span className="text-xs font-medium text-indigo-400 bg-indigo-500/10 px-2 py-1 rounded-md">Coming Soon</span>
          </div>
          <div className="rounded-3xl p-8 bg-slate-900/50 border border-white/5 backdrop-blur-sm h-[calc(100%-3rem)] flex flex-col items-center justify-center text-center">
             <div className="w-16 h-16 rounded-full bg-slate-800/80 flex items-center justify-center mb-4">
                <Clock className="w-8 h-8 text-slate-500" />
             </div>
             <h4 className="text-lg font-semibold text-slate-300 mb-2">No forms filled yet</h4>
             <p className="text-slate-500 max-w-sm">
                Once you start using the FormPilot Chrome extension to fill applications, your history will appear here.
             </p>
             <a href="https://forms.google.com" target="_blank" rel="noopener noreferrer" className="mt-6 inline-flex items-center gap-2 text-sm text-indigo-400 hover:text-indigo-300 font-medium">
                Try filling a Google Form <ArrowRight className="w-4 h-4" />
             </a>
          </div>
        </div>
      </div>

    </div>
  );
}

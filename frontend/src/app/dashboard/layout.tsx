"use client";

import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Download } from 'lucide-react';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  if (loading || !user) {
    return <div className="flex h-screen items-center justify-center">Loading...</div>;
  }

  return (
    <div className="flex h-screen flex-col bg-slate-950 relative overflow-hidden text-slate-200">
      {/* Background gradients */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-600/20 rounded-full mix-blend-screen filter blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-600/20 rounded-full mix-blend-screen filter blur-[120px]" />
      </div>

      <header className="flex items-center justify-between px-6 py-4 bg-slate-950/50 backdrop-blur-xl border-b border-white/10 z-10 sticky top-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white bg-slate-900/80 hover:bg-slate-800 border border-white/10 px-3 py-1.5 rounded-full transition-all cursor-pointer"
            title="Go Back"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back</span>
          </button>
          <img src="/logo-icon.png" alt="FormPilot Logo" className="w-9 h-9 object-contain rounded-xl bg-indigo-500/10 p-1 border border-indigo-500/20 shadow-lg shadow-indigo-500/10" />
          <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent tracking-tight">
            FormPilot
          </h1>
        </div>
        <nav className="flex items-center gap-4 md:gap-6">
          <a 
            href="/formpilot-extension.zip" 
            download="formpilot-extension.zip"
            className="flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-semibold transition-all text-xs sm:text-sm px-4 py-2 rounded-full shadow-[0_0_15px_rgba(99,102,241,0.3)] hover:scale-105"
          >
            <Download className="w-4 h-4" />
            <span>Install Extension</span>
          </a>
          <div className="w-px h-5 bg-white/10 hidden sm:block"></div>
          <Link href="/dashboard" className="text-slate-300 hover:text-white font-medium transition-colors text-sm">Dashboard</Link>
          <Link href="/dashboard/profile" className="text-slate-300 hover:text-white font-medium transition-colors text-sm">Profile</Link>
          <Button variant="ghost" className="text-slate-400 hover:text-white hover:bg-white/10 text-sm font-medium h-9 px-4 rounded-full" onClick={() => logout()}>Logout</Button>
        </nav>
      </header>
      <main className="flex-1 p-6 overflow-auto z-10 relative">
        <div className="max-w-5xl mx-auto w-full pb-12">
          {children}
        </div>
      </main>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { 
  CheckCircle2, Zap, Shield, ArrowRight, Sparkles, FormInput, FileJson, 
  CheckCircle, Puzzle, Download, Check, AlertCircle, Info 
} from "lucide-react";
import { motion } from "framer-motion";
import { detectBrowser, BrowserInfo } from "@/lib/browser-detection";
import { EXTENSION_STORE_URLS, SUPPORTED_BROWSERS_TEXT } from "@/lib/extension-config";
import { useExtensionDetection } from "@/hooks/useExtensionDetection";

export default function LandingPage() {
  const [browser, setBrowser] = useState<BrowserInfo>({
    name: 'unknown',
    label: 'Browser',
    isSupported: true,
    ctaText: 'Install FormPilot'
  });
  const [showUnsupportedModal, setShowUnsupportedModal] = useState<boolean>(false);
  const { isInstalled } = useExtensionDetection();

  useEffect(() => {
    setBrowser(detectBrowser());
  }, []);

  const handleInstallClick = (e: React.MouseEvent) => {
    if (!browser.isSupported) {
      e.preventDefault();
      setShowUnsupportedModal(true);
      return;
    }

    const storeUrl = EXTENSION_STORE_URLS[browser.name as keyof typeof EXTENSION_STORE_URLS] || EXTENSION_STORE_URLS.chrome;
    window.open(storeUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="flex flex-col min-h-screen bg-slate-950 text-white font-sans selection:bg-indigo-500/30 overflow-hidden">
      {/* Dynamic Background */}
      <div className="fixed inset-0 z-0">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-indigo-600/20 rounded-full mix-blend-screen filter blur-[128px] animate-blob" />
        <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-purple-600/20 rounded-full mix-blend-screen filter blur-[128px] animate-blob animation-delay-2000" />
        <div className="absolute bottom-0 left-1/3 w-96 h-96 bg-blue-600/20 rounded-full mix-blend-screen filter blur-[128px] animate-blob animation-delay-4000" />
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 mix-blend-overlay"></div>
      </div>

      {/* Header */}
      <motion.header 
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        className="px-6 py-4 flex items-center justify-between border-b border-white/10 bg-slate-950/50 backdrop-blur-xl sticky top-0 z-50"
      >
        <div className="text-2xl font-bold flex items-center gap-3">
          <img src="/logo-icon.png" alt="FormPilot Logo" className="w-9 h-9 object-contain rounded-xl bg-indigo-500/10 p-1 border border-indigo-500/20 shadow-lg shadow-indigo-500/10" />
          <span className="bg-gradient-to-r from-indigo-400 to-purple-400 text-transparent bg-clip-text">
            FormPilot
          </span>
        </div>
        <nav className="flex gap-4">
          <Link href="/login">
            <Button variant="ghost" className="text-slate-300 hover:text-white hover:bg-white/10 font-medium">Sign In</Button>
          </Link>
          <Link href="/login">
            <Button className="bg-indigo-600 hover:bg-indigo-500 text-white shadow-[0_0_20px_rgba(79,70,229,0.3)] font-medium rounded-full px-6">
              Get Started
            </Button>
          </Link>
        </nav>
      </motion.header>

      <main className="flex-1 flex flex-col items-center z-10">
        {/* Hero Section */}
        <section className="w-full min-h-[85vh] py-24 px-6 text-center flex flex-col items-center justify-center">
          <motion.h1 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-5xl md:text-8xl font-black tracking-tighter max-w-5xl mb-6 text-white leading-[1.1]"
          >
            Fill your profile once. <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400">
              Use it everywhere.
            </span>
          </motion.h1>

          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15 }}
            className="text-2xl md:text-3xl font-semibold text-slate-300 mb-8 max-w-3xl"
          >
            Apply to internships, jobs, hackathons, and scholarships up to 10x faster.
          </motion.h2>
          
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-xl text-slate-400 max-w-2xl mb-12 leading-relaxed font-light"
          >
            Stop typing the same information again and again. FormPilot uses AI to fill Google Forms instantly using your profile, skills, projects, and experience.
          </motion.p>
          
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="flex flex-col items-center gap-3 w-full max-w-xl mx-auto"
          >
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 w-full">
              {/* Primary CTA: Browser aware store installation */}
              <Button
                size="lg"
                onClick={handleInstallClick}
                className="h-14 px-8 text-base md:text-lg bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white shadow-[0_0_30px_rgba(79,70,229,0.4)] rounded-full transition-all hover:scale-105 font-bold flex items-center justify-center gap-2 min-w-[240px] w-full sm:w-auto"
              >
                {isInstalled ? (
                  <>
                    <Check className="w-5 h-5 text-emerald-400" aria-hidden="true" />
                    <span>FormPilot Installed</span>
                  </>
                ) : (
                  <>
                    <Puzzle className="w-5 h-5" aria-hidden="true" />
                    <span>{browser.ctaText}</span>
                    <ArrowRight className="w-5 h-5 ml-1" aria-hidden="true" />
                  </>
                )}
              </Button>

              {/* Secondary CTA: Create Account */}
              <Link href="/login" className="w-full sm:w-auto">
                <Button 
                  size="lg" 
                  variant="outline" 
                  className="h-14 px-8 text-base md:text-lg bg-white/10 hover:bg-white/20 text-white border-white/20 rounded-full transition-all hover:scale-105 font-bold w-full"
                >
                  Create Account
                </Button>
              </Link>
            </div>

            {/* Subtle Support Text */}
            <p className="text-slate-400 text-xs font-medium mt-1">
              {SUPPORTED_BROWSERS_TEXT}
            </p>

            <div className="flex items-center justify-center gap-1.5 text-slate-500 text-xs font-medium mt-2">
              <Sparkles className="w-3 h-3 text-indigo-400" /> Powered by Gemini 2.5 Flash
            </div>

            {/* Social Proof */}
            <div className="flex flex-wrap justify-center gap-6 text-sm text-slate-400 font-medium mt-4">
              <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400" /> Supports Google Forms</div>
              <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400" /> AI-Powered Answers</div>
              <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400" /> Review Before Submit</div>
            </div>

            {/* Developer & Internal Build Link */}
            <div className="mt-8 pt-6 border-t border-white/5 w-full max-w-md text-center">
              <p className="text-xs text-slate-500 mb-1.5">Developer & Internal Testing Option:</p>
              <a 
                href="/formpilot-extension.zip" 
                download="formpilot-extension.zip"
                className="inline-flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 font-medium underline underline-offset-4 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Developer Build (.zip)</span>
              </a>
            </div>
          </motion.div>

          {/* Product Mockup */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.4 }}
            className="mt-20 w-full max-w-5xl mx-auto rounded-2xl border border-white/10 bg-slate-900/40 backdrop-blur-xl shadow-2xl overflow-hidden text-left relative"
          >
             <img src="/demo-screenshot.png" alt="FormPilot extending Google Forms" className="w-full h-auto object-cover" />
             <div className="absolute top-4 right-4 bg-slate-900/80 backdrop-blur text-xs px-3 py-1.5 rounded-full text-slate-300 border border-white/10 pointer-events-none">
               Update public/demo-screenshot.png with your real screenshot
             </div>
          </motion.div>
        </section>

        {/* Stats Section */}
        <section className="w-full py-12 border-b border-white/5 bg-slate-950/80 backdrop-blur-sm relative z-20">
          <div className="max-w-6xl mx-auto px-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center divide-x divide-white/10">
              <div className="flex flex-col items-center gap-2 px-4">
                <span className="text-3xl mb-1">⚡</span>
                <span className="text-slate-300 font-medium text-sm md:text-base">Save up to 90% of form filling time</span>
              </div>
              <div className="flex flex-col items-center gap-2 px-4">
                <span className="text-3xl mb-1">🎯</span>
                <span className="text-slate-300 font-medium text-sm md:text-base">AI-powered profile matching</span>
              </div>
              <div className="flex flex-col items-center gap-2 px-4">
                <span className="text-3xl mb-1">🔒</span>
                <span className="text-slate-300 font-medium text-sm md:text-base">Review before every submission</span>
              </div>
              <div className="flex flex-col items-center gap-2 px-4">
                <span className="text-3xl mb-1">🚀</span>
                <span className="text-slate-300 font-medium text-sm md:text-base">Fill applications 10x faster</span>
              </div>
            </div>
          </div>
        </section>

        {/* Before/After Section */}
        <section className="w-full py-24 px-6 bg-slate-950/30">
          <div className="max-w-4xl mx-auto flex flex-col md:flex-row gap-4 md:gap-8 items-center justify-center">
            <div className="flex-1 w-full bg-red-500/10 border border-red-500/20 rounded-3xl p-8 flex flex-col items-center text-center">
              <h3 className="text-xl font-bold text-slate-300 mb-4">Before FormPilot</h3>
              <div className="text-5xl mb-4">⏱</div>
              <p className="text-2xl font-bold text-red-400">5–10 minutes</p>
              <p className="text-slate-400 mt-2 font-medium">per application</p>
            </div>
            
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-slate-800 text-slate-400 z-10 -my-6 md:my-0 md:-mx-10 border-4 border-slate-950 shrink-0 shadow-xl">
              <ArrowRight className="w-5 h-5 hidden md:block" />
              <ArrowRight className="w-5 h-5 block md:hidden rotate-90" />
            </div>

            <div className="flex-1 w-full bg-emerald-500/10 border border-emerald-500/20 rounded-3xl p-8 flex flex-col items-center text-center relative overflow-hidden shadow-[0_0_30px_rgba(16,185,129,0.1)]">
              <div className="absolute inset-0 bg-gradient-to-tr from-emerald-500/10 to-transparent"></div>
              <h3 className="text-xl font-bold text-white mb-4 relative z-10">After FormPilot</h3>
              <div className="text-5xl mb-4 relative z-10 drop-shadow-[0_0_10px_rgba(16,185,129,0.5)]">⚡</div>
              <p className="text-2xl font-bold text-emerald-400 relative z-10">Under 1 minute</p>
              <p className="text-slate-300 mt-2 font-medium relative z-10">per application</p>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section className="w-full py-32 px-6 border-t border-white/5 bg-slate-950/50 backdrop-blur-3xl">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-20">
              <h2 className="text-4xl md:text-5xl font-bold text-white mb-6 tracking-tight">How FormPilot Works</h2>
              <p className="text-slate-400 text-lg">Three simple steps to automate your applications.</p>
            </div>
            
            <div className="grid md:grid-cols-3 gap-8">
              {[
                { step: "1", title: "Create Your Profile", icon: UserIcon, desc: "Enter your personal info, education, skills, and experience into your secure FormPilot dashboard." },
                { step: "2", title: "Open a Google Form", icon: FormInput, desc: "Click the extension icon. FormPilot extracts all the questions instantly and analyzes the required fields." },
                { step: "3", title: "Review & Autofill", icon: CheckCircle, desc: "Our AI generates answers based on your profile. Review them in the beautiful side panel, and click autofill!" }
              ].map((item, i) => (
                <motion.div 
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.2 }}
                  className="flex flex-col items-center text-center p-8 rounded-3xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors group"
                >
                  <div className="w-16 h-16 rounded-2xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 mb-6 group-hover:scale-110 transition-transform">
                    <span className="text-2xl font-bold font-mono">{item.step}</span>
                  </div>
                  <h3 className="text-2xl font-bold text-white mb-4">{item.title}</h3>
                  <p className="text-slate-400 leading-relaxed">{item.desc}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Perfect For Section */}
        <section className="w-full py-24 px-6 bg-slate-950">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-3xl md:text-4xl font-bold text-center text-white mb-12 tracking-tight">Perfect For</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-6">
              {[
                { label: "Internship Applications", icon: "🎓" },
                { label: "Job Applications", icon: "💼" },
                { label: "Hackathon Registrations", icon: "🏆" },
                { label: "Scholarship Applications", icon: "📚" },
                { label: "Campus Ambassador Programs", icon: "🎤" },
                { label: "Event Registrations", icon: "🎟" },
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-3 p-4 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-indigo-500/30 transition-all">
                  <span className="text-2xl">{item.icon}</span>
                  <span className="text-slate-300 font-medium">{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Benefits Section */}
        <section className="w-full py-32 px-6">
          <div className="max-w-4xl mx-auto flex flex-col gap-6">
            <h2 className="text-4xl font-bold text-center mb-12 tracking-tight">Why people choose FormPilot</h2>
            
            <motion.div 
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="bg-gradient-to-r from-indigo-500/10 to-purple-500/10 p-8 rounded-3xl border border-white/10 flex items-start gap-6 backdrop-blur-sm hover:border-indigo-500/30 transition-colors"
            >
              <div className="w-12 h-12 rounded-full bg-indigo-500/20 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-6 h-6 text-indigo-400" />
              </div>
              <div>
                <h4 className="text-xl font-bold text-white mb-2">Never type your resume again</h4>
                <p className="text-slate-400 leading-relaxed text-lg">Store all your projects, experiences, and technical skills in one single source of truth. Apply faster by reusing your profile, projects, skills, and experience across every application.</p>
              </div>
            </motion.div>
            
            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="bg-gradient-to-r from-purple-500/10 to-pink-500/10 p-8 rounded-3xl border border-white/10 flex items-start gap-6 backdrop-blur-sm hover:border-purple-500/30 transition-colors"
            >
              <div className="w-12 h-12 rounded-full bg-purple-500/20 flex items-center justify-center shrink-0">
                <Shield className="w-6 h-6 text-purple-400" />
              </div>
              <div>
                <h4 className="text-xl font-bold text-white mb-2">Privacy First & Secure</h4>
                <p className="text-slate-400 leading-relaxed text-lg">Your data is stored securely in Firebase. FormPilot NEVER submits forms automatically—you are always in control of the final click.</p>
              </div>
            </motion.div>
          </div>
        </section>

        {/* Coming Soon Section */}
        <section className="w-full py-32 px-6 border-t border-white/5 bg-slate-950/50 backdrop-blur-3xl">
          <div className="max-w-4xl mx-auto text-center">
            <h2 className="text-3xl font-bold text-white mb-4">Coming Soon</h2>
            <p className="text-slate-400 mb-12">We are constantly evolving. Here's what's next for FormPilot.</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              {[
                { label: "Resume Upload", icon: "📄" },
                { label: "AI Profile Creation", icon: "🤖" },
                { label: "Smart Answer Memory", icon: "🎯" },
                { label: "More Form Platforms", icon: "🌐" },
              ].map((item, i) => (
                <div key={i} className="flex flex-col items-center justify-center p-6 rounded-2xl bg-white/5 border border-white/10 opacity-70 hover:opacity-100 transition-opacity">
                  <span className="text-3xl mb-3">{item.icon}</span>
                  <span className="text-slate-300 font-medium text-sm">{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="w-full py-12 border-t border-white/10 bg-slate-950 flex flex-col items-center gap-4 text-slate-500 z-10 relative">
        <div className="flex items-center gap-2">
          <FormInput className="w-5 h-5 text-indigo-500" />
          <span className="font-bold text-white tracking-tight">FormPilot</span>
        </div>
        <p className="text-sm">© {new Date().getFullYear()} FormPilot. Built with Next.js & Gemini AI.</p>
      </footer>

      {/* Unsupported Browser Modal */}
      {showUnsupportedModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-white/10 rounded-2xl p-6 max-w-md w-full shadow-2xl text-center space-y-4">
            <AlertCircle className="w-10 h-10 text-amber-400 mx-auto" />
            <h3 className="text-xl font-bold text-white">Browser Support Information</h3>
            <p className="text-slate-300 text-sm leading-relaxed">
              FormPilot currently supports Chromium-based browsers such as <strong className="text-indigo-400">Google Chrome</strong>, <strong className="text-indigo-400">Microsoft Edge</strong>, and <strong className="text-indigo-400">Brave</strong>.
            </p>
            <div className="pt-2 flex justify-center gap-3">
              <Button
                onClick={() => setShowUnsupportedModal(false)}
                className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-full px-6"
              >
                Got It
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Just an icon wrapper since lucide User doesn't export as UserIcon easily without aliasing
function UserIcon(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

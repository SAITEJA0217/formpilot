import { useEffect, useState } from 'react';
import { Settings, Play, CheckCircle, LogIn, AlertCircle } from 'lucide-react';

const DASHBOARD_URL = (import.meta.env.VITE_DASHBOARD_URL as string) || 'http://localhost:3000';

export default function Popup() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [isProfileComplete, setIsProfileComplete] = useState<boolean>(false);

  useEffect(() => {
    chrome.storage.local.get(['isAuthenticated', 'userProfile', 'isProfileComplete'], (data) => {
      if (data.isAuthenticated) {
        setIsAuthenticated(true);
      } else {
        setIsAuthenticated(false);
      }
      
      if (data.isProfileComplete) {
        setIsProfileComplete(true);
      }
    });
  }, []);

  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const handleAnalyze = () => {
    setIsAnalyzing(true);
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (activeTab && activeTab.url && !activeTab.url.includes("docs.google.com/forms")) {
        alert("This extension only works on Google Forms pages!");
        setIsAnalyzing(false);
        return;
      }
      
      if (activeTab.id) {
        chrome.tabs.sendMessage(activeTab.id, { action: 'EXTRACT_QUESTIONS' }, (response) => {
          if (chrome.runtime.lastError) {
            console.error("Content script not found:", chrome.runtime.lastError);
            alert("Could not connect to the page. Please refresh the Google Form tab and try again!");
            setIsAnalyzing(false);
            return;
          }
          // questions extracted
          if (response && response.questions) {
            if (response.questions.length === 0) {
              alert("No questions could be found on this form.");
              setIsAnalyzing(false);
              return;
            }
            const promise = chrome.runtime.sendMessage({ type: 'ANALYZE_FORM', payload: response.questions, tabId: tabs[0].id });
            if (promise) {
              promise.then((res: any) => {
                setIsAnalyzing(false);
                if (res && res.error) {
                  alert("Analysis failed: " + res.error);
                }
              }).catch(() => {
                setIsAnalyzing(false);
                alert("Connection to background script failed.");
              });
            } else {
              setIsAnalyzing(false);
            }
          } else {
            setIsAnalyzing(false);
            alert("Failed to extract questions from the form.");
          }
        });
      } else {
        setIsAnalyzing(false);
      }
    });
  };

  return (
    <div className="w-80 h-96 p-4 bg-gray-900 text-white flex flex-col font-sans">
      <div className="flex items-center justify-between mb-4 pb-2 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <img src="/logo-icon.png" alt="FormPilot Logo" className="w-8 h-8 object-contain rounded-lg bg-blue-500/10 p-0.5 border border-blue-500/20" />
          <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
            FormPilot
          </h1>
        </div>
        <Settings className="w-5 h-5 text-gray-400 hover:text-white cursor-pointer transition-colors" />
      </div>

      <div className="flex-1 flex flex-col space-y-4">
        {isAuthenticated === null ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
          </div>
        ) : !isAuthenticated ? (
          <div className="bg-gray-800 p-4 rounded-lg border border-red-700/50 flex flex-col items-center text-center space-y-3 mt-4">
            <div className="w-12 h-12 bg-red-500/20 rounded-full flex items-center justify-center mb-2">
              <LogIn className="w-6 h-6 text-red-500" />
            </div>
            <h2 className="font-medium text-white">Login Required</h2>
            <p className="text-sm text-gray-400">Please login to your FormPilot account to use the extension.</p>
            <a href={`${DASHBOARD_URL}/login`} target="_blank" rel="noreferrer" className="mt-2 inline-block bg-white text-gray-900 py-2 px-4 rounded font-medium hover:bg-gray-100 transition-colors">
              Login to FormPilot
            </a>
          </div>
        ) : isAuthenticated && !isProfileComplete ? (
          <div className="bg-gray-800 p-4 rounded-lg border border-yellow-700/50 flex flex-col items-center text-center space-y-3 mt-4">
            <div className="w-12 h-12 bg-yellow-500/20 rounded-full flex items-center justify-center mb-2">
              <AlertCircle className="w-6 h-6 text-yellow-500" />
            </div>
            <h2 className="font-medium text-white">Incomplete Profile</h2>
            <p className="text-sm text-gray-400">Please complete your profile information to enable AI generation.</p>
            <a href={`${DASHBOARD_URL}/dashboard/profile`} target="_blank" rel="noreferrer" className="mt-2 inline-block bg-white text-gray-900 py-2 px-4 rounded font-medium hover:bg-gray-100 transition-colors">
              Complete Profile
            </a>
          </div>
        ) : (
          <div className="flex flex-col space-y-4 mt-2">
            <div className="bg-gray-800 p-4 rounded-lg border border-green-700/50">
              <div className="flex items-center gap-3 mb-2">
                <CheckCircle className="w-5 h-5 text-green-400" />
                <h2 className="font-medium">Profile Ready</h2>
              </div>
              <p className="text-sm text-gray-400">Ready to autofill Google Forms</p>
            </div>

            <button
              onClick={handleAnalyze}
              disabled={isAnalyzing}
              className={`w-full bg-blue-600 hover:bg-blue-500 text-white py-3 px-4 rounded-lg font-medium flex items-center justify-center gap-2 transition-all shadow-lg hover:shadow-blue-500/20 mt-4 ${isAnalyzing ? 'opacity-70 cursor-not-allowed' : ''}`}
            >
              {isAnalyzing ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
              ) : (
                <Play className="w-4 h-4 fill-current" />
              )}
              {isAnalyzing ? 'Analyzing...' : 'Analyze Current Form'}
            </button>
          </div>
        )}
      </div>

      <div className="mt-auto text-center pt-4 border-t border-gray-800">
        <a href={`${DASHBOARD_URL}/dashboard`} target="_blank" rel="noreferrer" className="text-xs text-gray-500 hover:text-white transition-colors">
          Open Web Dashboard
        </a>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { UploadCloud, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { UserProfile } from '../../../../shared/types';
import { useProfile } from '@/hooks/useProfile';
import { toast } from 'sonner';

export function ResumeUploadWidget() {
  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const { updateProfile } = useProfile();

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
      toast.error("Please upload a PDF file.");
      return;
    }
    await parseResume(selectedFile);
  };

  const parseResume = async (pdfFile: File) => {
    setIsParsing(true);
    try {
      const formData = new FormData();
      formData.append('resume', pdfFile);
      
      const res = await fetch('/api/ai/parse-resume', {
        method: 'POST',
        body: formData
      });
      
      let data;
      try {
        data = await res.json();
      } catch (e) {
        throw new Error("Server returned an invalid response.");
      }
      
      if (!res.ok) {
        throw new Error(data.error || "Failed to parse resume");
      }
      
      await updateProfile(data);
      toast.success("Resume parsed and profile updated!");
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "An unexpected error occurred while parsing.");
    } finally {
      setIsParsing(false);
    }
  };

  if (isParsing) {
    return (
      <div className="flex flex-col items-center justify-center p-6 border border-slate-700 bg-slate-900/50 rounded-2xl">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mb-4" />
        <h3 className="text-sm font-medium text-slate-200">Extracting Profile...</h3>
        <p className="text-xs text-slate-400 mt-1 text-center">Using AI to analyze your resume.</p>
      </div>
    );
  }

  return (
    <div 
      className={`relative w-full border-2 border-dashed rounded-2xl p-6 text-center transition-colors cursor-pointer ${
        isDragging ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-700 bg-slate-900/50 hover:bg-slate-900 hover:border-slate-600'
      }`}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleFileDrop}
    >
      <input 
        type="file" 
        accept=".pdf" 
        onChange={handleFileChange} 
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      />
      <UploadCloud className="w-8 h-8 text-indigo-400 mx-auto mb-3" />
      <h3 className="text-sm font-bold text-slate-200 mb-1">Quick Auto-Fill</h3>
      <p className="text-xs text-slate-400">Upload PDF resume to extract data</p>
    </div>
  );
}

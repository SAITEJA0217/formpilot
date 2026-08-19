import { useState } from 'react';
import type { AIAnswer } from '../../../shared/types';
import { Check, X, Edit2, Play, Info } from 'lucide-react';

interface ReviewPanelProps {
  answers: AIAnswer[] | null;
  onFill: (answers: AIAnswer[]) => void;
  onClose: () => void;
}

export default function ReviewPanel({ answers: initialAnswers, onFill, onClose }: ReviewPanelProps) {
  const [answers, setAnswers] = useState<AIAnswer[]>(initialAnswers || []);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [expandedWhy, setExpandedWhy] = useState<number | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const handleEdit = (index: number) => {
    setEditingId(index);
    setEditValue(answers[index].answer || '');
  };

  const handleSaveEdit = (index: number) => {
    const newAnswers = [...answers];
    const originalAnswer = newAnswers[index].answer;
    newAnswers[index].answer = editValue;
    setAnswers(newAnswers);
    setEditingId(null);
    
    // Send correction to background script
    chrome.runtime.sendMessage({
      type: 'SEND_CORRECTION',
      payload: {
        originalQuestion: newAnswers[index].question,
        originalAnswer,
        userCorrection: editValue,
        sourceDetail: newAnswers[index].sourceDetail
      }
    }, (response) => {
      if (response && !response.error) {
        let msg = "Got it — I'll remember this phrasing for future forms.";
        if (response.type === 'fact-level') {
          msg = "Fact updated! I've learned this new information for future forms.";
        }
        setToastMessage(msg);
        setTimeout(() => setToastMessage(null), 4000);
      }
    });
  };

  const handleSkip = (index: number) => {
    const newAnswers = [...answers];
    newAnswers[index].answer = null; 
    setAnswers(newAnswers);
  };

  return (
    <div className="fixed top-4 right-4 w-96 bg-gray-900 text-white rounded-xl shadow-2xl border border-gray-700 z-[999999] flex flex-col font-sans max-h-[90vh]">
      <div className="p-4 border-b border-gray-700 flex justify-between items-center bg-gray-800 rounded-t-xl">
        <div className="flex items-center gap-2">
          <img 
            src={typeof chrome !== 'undefined' && chrome.runtime?.getURL ? chrome.runtime.getURL('logo-icon.png') : '/logo-icon.png'} 
            alt="FormPilot Logo" 
            className="w-7 h-7 object-contain rounded-lg bg-blue-500/10 p-0.5 border border-blue-500/20" 
          />
          <h2 className="font-bold text-lg bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">FormPilot Review</h2>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
          <X className="w-5 h-5" />
        </button>
      </div>
      
      {toastMessage && (
        <div className="bg-green-600 text-white text-xs px-4 py-2 text-center animate-in fade-in slide-in-from-top-2">
          {toastMessage}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {answers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-gray-400 text-center">
            <p>No questions could be found to answer.</p>
            <p className="text-sm mt-2 text-gray-500">Make sure you are on the actual form filling page (preview), not the form editor!</p>
          </div>
        ) : (
          answers.map((ans, idx) => (
            <div key={idx} className={`p-3 rounded-lg border ${ans.source === 'missing' ? 'border-yellow-500/50 bg-yellow-500/10' : ans.confidence < 70 ? 'border-orange-500/50 bg-orange-500/10' : 'border-gray-700 bg-gray-800'}`}>
              <div className="text-xs text-gray-400 mb-1 flex justify-between items-start gap-2">
                <span className="font-medium truncate">{ans.question}</span>
                <div className="flex flex-col items-end whitespace-nowrap">
                  {ans.source === 'missing' ? (
                    <span className="font-bold text-yellow-400">Missing Data</span>
                  ) : (
                    <span className={`font-bold ${ans.confidence >= 80 ? 'text-green-400' : ans.confidence >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>
                      {ans.confidence}% Match
                    </span>
                  )}
                  {ans.sourceDetail && (
                    <button 
                      onClick={() => setExpandedWhy(expandedWhy === idx ? null : idx)}
                      className="text-blue-400 hover:text-blue-300 mt-1 flex items-center gap-1 text-[10px]"
                    >
                      <Info className="w-3 h-3"/> Why?
                    </button>
                  )}
                </div>
              </div>
              
              {expandedWhy === idx && ans.sourceDetail && (
                <div className="mb-2 p-2 bg-gray-900/50 rounded text-xs text-gray-300 border border-gray-700">
                  <span className="font-semibold text-blue-300 block mb-1">Provenance Trail:</span>
                  {ans.isGenerated ? (
                    <p>This answer was <b>generated/inferred</b> rather than directly pulled. Referenced field: <code className="bg-gray-800 px-1 rounded">{ans.sourceDetail}</code>. Please review carefully.</p>
                  ) : (
                    <p>Sourced directly from your profile: <code className="bg-gray-800 px-1 rounded">{ans.sourceDetail}</code>.</p>
                  )}
                </div>
              )}
              
              {editingId === idx ? (
                <div className="flex gap-2 mt-2">
                  <input 
                    type="text" 
                    value={editValue} 
                    onChange={(e) => setEditValue(e.target.value)}
                    className="flex-1 bg-gray-900 border border-gray-600 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500 text-white"
                  />
                  <button onClick={() => handleSaveEdit(idx)} className="text-green-400 hover:text-green-300 bg-gray-900 p-1 rounded"><Check className="w-4 h-4"/></button>
                </div>
              ) : (
                <div className="flex justify-between items-start mt-2">
                  <div className={`text-sm ${!ans.answer ? 'text-gray-500 italic' : 'text-gray-100'}`}>
                    {ans.answer || (ans.source === 'missing' ? 'Please edit to provide answer' : 'Skipped')}
                  </div>
                  <div className="flex gap-2 ml-2">
                    <button onClick={() => handleEdit(idx)} className="text-blue-400 hover:text-blue-300"><Edit2 className="w-4 h-4"/></button>
                    <button onClick={() => handleSkip(idx)} className="text-red-400 hover:text-red-300"><X className="w-4 h-4"/></button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div className="p-4 border-t border-gray-700 bg-gray-800 rounded-b-xl flex gap-3">
        <button 
          disabled={answers.length === 0}
          onClick={() => onFill(answers)}
          className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white py-2 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors"
        >
          <Play className="w-4 h-4 fill-current" />
          Autofill Form
        </button>
      </div>
    </div>
  );
}

import React, { useState, KeyboardEvent } from 'react';
import { X } from 'lucide-react';

interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  id?: string;
}

export function TagInput({ tags, onChange, placeholder = "Type and press enter or comma...", id }: TagInputProps) {
  const [inputValue, setInputValue] = useState('');

  const commitTags = (val: string) => {
    if (!val) return;
    const newItems = val
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !tags.includes(s));
    
    if (newItems.length > 0) {
      onChange([...tags, ...newItems]);
    }
    setInputValue('');
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commitTags(inputValue);
    } else if (e.key === 'Backspace' && inputValue === '' && tags.length > 0) {
      e.preventDefault();
      onChange(tags.slice(0, -1));
    }
  };

  const handleBlur = () => {
    if (inputValue.trim()) {
      commitTags(inputValue);
    }
  };

  const removeTag = (indexToRemove: number) => {
    onChange(tags.filter((_, index) => index !== indexToRemove));
  };

  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex flex-wrap gap-2 items-center min-h-[42px] p-2 border border-slate-700 rounded-md bg-slate-900/50 focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-transparent transition-all">
        {tags.map((tag, index) => (
          <span 
            key={`${tag}-${index}`} 
            className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
          >
            {tag}
            <button
              type="button"
              onClick={() => removeTag(index)}
              className="text-indigo-400 hover:text-indigo-200 focus:outline-none"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <input
          id={id}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder={tags.length === 0 ? placeholder : ''}
          className="flex-1 min-w-[120px] bg-transparent outline-none text-sm text-slate-200 placeholder:text-slate-500 py-1"
        />
      </div>
    </div>
  );
}

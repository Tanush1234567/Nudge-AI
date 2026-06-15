'use client';

import * as React from 'react';
import { Youtube, ArrowRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';

export interface PasteInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  loading?: boolean;
  placeholder?: string;
  cta?: string;
  className?: string;
}

export function PasteInput({
  value,
  onChange,
  onSubmit,
  loading = false,
  placeholder = "Paste a YouTube URL",
  cta = "Watch it for me",
  className,
}: PasteInputProps) {
  const [isFocused, setIsFocused] = React.useState(false);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!loading) onSubmit();
      }}
      className={cn(
        'group flex items-center gap-1.5 p-1.5 pl-4 bg-surface-1 border rounded-r-4 transition-all duration-200 w-full',
        isFocused 
          ? 'border-brand-500 shadow-[0_0_0_4px_rgba(var(--brand-shadow),0.14),var(--shadow-2)]' 
          : 'border-strong shadow-1',
        className
      )}
    >
      <Youtube className="w-[18px] h-[18px] text-coral-500 shrink-0" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        placeholder={placeholder}
        disabled={loading}
        className="flex-1 min-w-0 bg-transparent border-none outline-none text-text-1 text-[15px] py-3 px-2 placeholder:text-text-4"
      />
      <Button 
        type="submit" 
        disabled={loading || !value.trim()}
        className="h-auto py-3 px-sp-5 rounded-r-r-2"
      >
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <>
            {cta}
            <ArrowRight className="w-3.5 h-3.5" />
          </>
        )}
      </Button>
    </form>
  );
}

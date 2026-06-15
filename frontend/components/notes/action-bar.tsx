'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Share2, Download, MessageSquare, BrainCircuit } from 'lucide-react';
import { cn } from '@/lib/utils';

export function NotesActionBar() {
  const handleExport = () => {
    // Browser print dialog → "Save as PDF" renders the notes exactly as shown.
    window.print();
  };

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 print:hidden">
      <div className={cn(
        "flex items-center gap-1 p-1.5 rounded-full border border-default shadow-3 transition-all duration-300",
        "bg-white/70 dark:bg-[#1A1A1E]/70 backdrop-blur-xl saturate-150"
      )}>
        <Button variant="ghost" size="sm" className="rounded-full gap-2 px-4 h-10 text-text-2 hover:text-text-1">
          <Share2 className="w-4 h-4" />
          <span className="hidden sm:inline">Share</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleExport}
          className="rounded-full gap-2 px-4 h-10 text-text-2 hover:text-text-1"
        >
          <Download className="w-4 h-4" />
          <span className="hidden sm:inline">Export PDF</span>
        </Button>
        <Button variant="ghost" size="sm" className="rounded-full gap-2 px-4 h-10 text-text-2 hover:text-text-1">
          <MessageSquare className="w-4 h-4" />
          <span className="hidden sm:inline">Ask</span>
        </Button>
        <div className="w-px h-6 bg-default mx-1" />
        <Button size="sm" className="rounded-full gap-2 px-5 h-10 bg-brand-500 hover:bg-brand-600 text-white shadow-md">
          <BrainCircuit className="w-4 h-4" />
          <span>Quiz me</span>
        </Button>
      </div>
    </div>
  );
}

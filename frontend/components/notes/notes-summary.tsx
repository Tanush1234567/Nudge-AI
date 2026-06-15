import * as React from 'react';
import { RichContent } from '@/components/notes/rich-content';

interface NotesSummaryProps {
  summary: string;
  topics: string[];
}

export function NotesSummary({ summary, topics }: NotesSummaryProps) {
  return (
    <div className="mt-8 bg-surface-2 border border-default rounded-xl p-5 md:p-6">
      <div className="text-[10.5px] tracking-widest uppercase text-text-3 font-bold mb-2">TL;DW</div>
      <RichContent
        className="text-[15.5px] leading-relaxed text-text-1 mb-4 prose dark:prose-invert max-w-none"
        html={summary}
      />
      <div className="flex flex-wrap gap-2">
        {topics.map(topic => (
          <span 
            key={topic} 
            className="text-[11.5px] text-text-2 px-2.5 py-1 rounded-full bg-surface-1 border border-default"
          >
            {topic}
          </span>
        ))}
      </div>
    </div>
  );
}

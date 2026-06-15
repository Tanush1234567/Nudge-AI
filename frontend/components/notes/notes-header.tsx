import * as React from 'react';
import { Tag } from '@/components/ui/tag';
import { VideoNotes } from '@/lib/types';
import { RichContent } from '@/components/notes/rich-content';
import { 
  User, 
  Clock, 
  Camera, 
  Sparkles, 
  Code, 
  Check 
} from 'lucide-react';

interface NotesHeaderProps {
  notes: VideoNotes;
}

export function NotesHeader({ notes }: NotesHeaderProps) {
  const { video, stats } = notes;

  return (
    <header className="max-w-[720px] mx-auto pt-12 px-8">
      <div className="flex flex-wrap gap-2 mb-4">
        {notes.topics[0] && <Tag kind="purple">{notes.topics[0]}</Tag>}
        <Tag kind="green" icon={<Check className="w-2.5 h-2.5" />}>Visual analysis enabled</Tag>
      </div>

      <h1 className="text-[38px] font-bold tracking-[-0.025em] leading-[1.1] mb-4 text-text-1">
        {video.title}
      </h1>

      <RichContent
        className="text-base text-text-2 leading-relaxed max-w-[640px] prose dark:prose-invert"
        html={notes.summary}
      />

      <div className="flex flex-wrap gap-4 mt-6 pt-6 border-t border-default text-[12.5px] text-text-3 font-medium">
        <div className="flex items-center gap-1.5">
          <User className="w-3.5 h-3.5" /> 
          {video.channel}
        </div>
        <div className="flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5" /> 
          {Math.floor(video.duration_seconds / 60)} min
        </div>
        <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          {stats.frames_captured} frames captured
        </div>
        <div className="flex items-center gap-1.5 text-purple-700 dark:text-purple-400">
          <div className="w-1.5 h-1.5 rounded-full bg-brand-500" />
          {stats.diagrams_generated} diagrams generated
        </div>
        <div className="flex items-center gap-1.5 text-coral-600 dark:text-coral-400">
          <div className="w-1.5 h-1.5 rounded-full bg-coral-500" />
          {stats.code_blocks_extracted} code blocks
        </div>
      </div>
    </header>
  );
}

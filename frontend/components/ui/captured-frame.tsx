import * as React from 'react';
import { cn } from '@/lib/utils';

export interface CapturedFrameProps {
  timestamp?: string;
  aspectRatio?: string;
  variant?: 'slide' | 'chalkboard' | 'code' | 'person' | 'plot';
  label?: string;
  children?: React.ReactNode;
  className?: string;
}

const backgrounds = {
  slide: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
  chalkboard: 'linear-gradient(135deg, #14532d 0%, #052e16 100%)',
  code: 'linear-gradient(135deg, #1e1b4b 0%, #0f0f23 100%)',
  person: 'linear-gradient(135deg, #4c1d95 0%, #1e1b4b 100%)',
  plot: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)',
};

export function CapturedFrame({
  timestamp = "12:34",
  aspectRatio = "16/9",
  variant = "slide",
  label = "Captured at",
  children,
  className,
}: CapturedFrameProps) {
  return (
    <div 
      className={cn(
        'relative rounded-lg overflow-hidden border border-strong w-full',
        className
      )}
      style={{ 
        aspectRatio,
        background: backgrounds[variant] 
      }}
    >
      {children}
      <div className="absolute top-2 left-2 bg-black/70 text-white text-[10px] font-mono px-1.5 py-0.5 rounded tracking-wide">
        {label} {timestamp}
      </div>
    </div>
  );
}

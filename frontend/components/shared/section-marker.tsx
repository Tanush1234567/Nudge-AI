import * as React from 'react';
import { cn } from '@/lib/utils';

export interface SectionMarkerProps {
  number: number | string;
  className?: string;
}

export function SectionMarker({ number, className }: SectionMarkerProps) {
  return (
    <span 
      className={cn(
        'inline-flex items-center justify-center w-6 h-6 rounded-full bg-brand-500 text-white text-[12px] font-bold shrink-0',
        className
      )}
    >
      {number}
    </span>
  );
}

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface AuroraBgProps {
  className?: string;
  intensity?: number;
}

export function AuroraBg({ className, intensity = 0.5 }: AuroraBgProps) {
  return (
    <div className={cn('absolute inset-0 overflow-hidden pointer-events-none -z-10', className)}>
      <div 
        className="absolute top-[-30%] left-1/2 -translate-x-1/2 w-[80%] h-[70%] blur-[40px]"
        style={{
          background: `radial-gradient(ellipse at center, rgba(var(--brand-shadow), ${0.18 * intensity}) 0%, transparent 70%)`
        }}
      />
      <div 
        className="absolute top-[-10%] left-[-10%] w-[40%] h-[50%] blur-[40px]"
        style={{
          background: `radial-gradient(ellipse at center, rgba(16, 185, 129, ${0.07 * intensity}) 0%, transparent 70%)`
        }}
      />
      <div 
        className="absolute top-[-10%] right-[-10%] w-[40%] h-[50%] blur-[40px]"
        style={{
          background: `radial-gradient(ellipse at center, rgba(245, 158, 11, ${0.06 * intensity}) 0%, transparent 70%)`
        }}
      />
    </div>
  );
}

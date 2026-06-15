import * as React from 'react';
import Link from 'next/link';
import { Eye } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface LogoProps {
  className?: string;
  size?: number;
}

export function Logo({ className, size = 22 }: LogoProps) {
  return (
    <Link
      href="/"
      className={cn('inline-flex items-center gap-2 group', className)}
    >
      <Eye
        size={size}
        strokeWidth={2.25}
        className="shrink-0 transition-transform duration-300 group-hover:scale-110"
        style={{ color: 'var(--brand-500)' }}
      />
      <span className="font-semibold text-text-1 tracking-tight" style={{ fontSize: size * 0.78 }}>
        Pupil
      </span>
    </Link>
  );
}

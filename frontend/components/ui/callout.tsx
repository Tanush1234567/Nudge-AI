import * as React from 'react';
import { cn } from '@/lib/utils';

export interface CalloutProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'purple' | 'green' | 'amber';
  title?: string;
}

const Callout = React.forwardRef<HTMLDivElement, CalloutProps>(
  ({ className, variant = 'purple', title, children, ...props }, ref) => {
    const variants = {
      purple: 'bg-purple-50 border-purple-500 text-purple-900 dark:bg-[rgba(139,92,246,0.08)] dark:text-[#DBCFFB]',
      green: 'bg-emerald-50 border-emerald-500 text-emerald-900 dark:bg-[rgba(16,185,129,0.08)] dark:text-[#B6F0D7]',
      amber: 'bg-amber-50 border-amber-500 text-amber-900 dark:bg-[rgba(245,158,11,0.08)] dark:text-[#FBE4B1]',
    };

    return (
      <div
        ref={ref}
        className={cn(
          'border-l-3 p-sp-4 rounded-r-r-2 text-[13px] line-height-[1.6]',
          variants[variant],
          className
        )}
        {...props}
      >
        {title && <div className="font-semibold mb-1">{title}</div>}
        {children}
      </div>
    );
  }
);

Callout.displayName = 'Callout';

export { Callout };

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface TagProps extends React.HTMLAttributes<HTMLSpanElement> {
  kind?: 'purple' | 'green' | 'coral' | 'amber' | 'neutral';
  icon?: React.ReactNode;
}

const Tag = React.forwardRef<HTMLSpanElement, TagProps>(
  ({ className, kind = 'neutral', icon, children, ...props }, ref) => {
    const variants = {
      neutral: 'bg-neutral-100 text-neutral-700 dark:bg-surface-2 dark:text-text-2',
      purple: 'bg-purple-50 text-purple-800 dark:bg-[rgba(139,92,246,0.18)] dark:text-purple-300',
      green: 'bg-emerald-50 text-emerald-800 dark:bg-[rgba(16,185,129,0.18)] dark:text-emerald-300',
      coral: 'bg-coral-50 text-coral-800 dark:bg-[rgba(244,63,94,0.18)] dark:text-coral-200',
      amber: 'bg-amber-50 text-amber-800 dark:bg-[rgba(245,158,11,0.18)] dark:text-amber-300',
    };

    const dots = {
      neutral: 'bg-neutral-500',
      purple: 'bg-purple-500',
      green: 'bg-emerald-500',
      coral: 'bg-coral-500',
      amber: 'bg-amber-500',
    };

    return (
      <span
        ref={ref}
        className={cn(
          'inline-flex items-center gap-1.5 px-2 py-0.5 text-[10.5px] font-medium rounded-[6px] whitespace-nowrap letter-spacing-[0.01em]',
          variants[kind],
          className
        )}
        {...props}
      >
        {kind !== 'neutral' && !icon && (
          <span className={cn('h-1.5 w-1.5 rounded-full flex-shrink-0', dots[kind])} />
        )}
        {icon && <span className="flex-shrink-0">{icon}</span>}
        {children}
      </span>
    );
  }
);

Tag.displayName = 'Tag';

export { Tag };

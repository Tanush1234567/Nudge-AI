import * as React from 'react';
import { cn } from '@/lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', ...props }, ref) => {
    const variants = {
      primary: 'bg-brand-500 text-white shadow-[0_1px_2px_rgba(var(--brand-shadow),0.3)] hover:bg-brand-600 active:scale-[0.98]',
      secondary: 'bg-transparent border border-strong text-text-1 hover:bg-surface-2',
      ghost: 'bg-transparent text-text-2 hover:bg-surface-2 hover:text-text-1',
    };

    const sizes = {
      sm: 'px-3 py-1.5 text-xs rounded-r-1',
      md: 'px-sp-4 py-2.5 text-sm rounded-r-2 font-medium',
      lg: 'px-6 py-3 text-base rounded-r-3 font-semibold',
    };

    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center gap-2 whitespace-nowrap transition-all duration-150 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:pointer-events-none disabled:opacity-50',
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
      />
    );
  }
);

Button.displayName = 'Button';

export { Button };

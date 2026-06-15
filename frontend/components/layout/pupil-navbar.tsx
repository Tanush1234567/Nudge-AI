'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Eye } from 'lucide-react';

const navLinks = [
  { label: 'How it works', href: '#how-it-works' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'Nudge', href: '/' },
];

export function PupilNavbar() {
  const [scrolled, setScrolled] = React.useState(false);
  const router = useRouter();

  React.useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <nav
      className={cn(
        'sticky top-0 z-50 w-full transition-all duration-200 border-b',
        scrolled
          ? 'bg-bg/95 border-default py-3'
          : 'bg-transparent border-transparent py-5'
      )}
    >
      <div className="container max-w-6xl mx-auto px-6 flex items-center justify-between">
        <Link href="/pupil" className="inline-flex items-center gap-2 group">
          <Eye
            size={24}
            strokeWidth={2.25}
            className="shrink-0 transition-transform duration-300 group-hover:scale-110"
            style={{ color: 'var(--brand-600)' }}
          />
          <span className="font-semibold text-text-1 tracking-tight text-[19px]">
            Pupil
          </span>
        </Link>

        <div className="hidden md:flex items-center gap-8">
          {navLinks.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="text-sm font-medium text-text-2 hover:text-text-1 transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="hidden sm:inline-flex"
            onClick={() => router.push('/login')}
          >
            Sign in
          </Button>
          <Button
            size="sm"
            className="bg-emerald-600 text-white hover:bg-emerald-700 shadow-none"
            onClick={() => router.push('/login?mode=signup')}
          >
            Get started
          </Button>
        </div>
      </div>
    </nav>
  );
}

'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Logo } from '@/components/shared/logo';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const navLinks = [
  { label: 'Product', href: '#product' },
  { label: 'How it works', href: '#how-it-works' },
  { label: 'Pricing', href: '#pricing' },
];

export function Navbar() {
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
          ? 'bg-bg/80 backdrop-blur-md border-strong py-3' 
          : 'bg-transparent border-transparent py-5'
      )}
    >
      <div className="container max-w-7xl mx-auto px-4 flex items-center justify-between">
        <Logo size={24} />

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
            onClick={() => router.push('/login?mode=signup')}
          >
            Get Started
          </Button>
        </div>
      </div>
    </nav>
  );
}

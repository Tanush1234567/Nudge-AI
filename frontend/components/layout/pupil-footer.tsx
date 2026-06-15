import * as React from 'react';
import { cn } from '@/lib/utils';
import { Eye } from 'lucide-react';
import Link from 'next/link';

export function PupilFooter() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t border-default bg-surface-1 py-12">
      <div className="container max-w-6xl mx-auto px-6">
        <div className="flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex flex-col items-center md:items-start gap-4">
            <Link href="/pupil" className="inline-flex items-center gap-2">
              <Eye
                size={20}
                strokeWidth={2.25}
                className="shrink-0"
                style={{ color: 'var(--brand-600)' }}
              />
              <span className="font-semibold text-text-1 tracking-tight text-base">
                Pupil
              </span>
            </Link>
            <p className="text-sm text-text-3 text-center md:text-left max-w-xs leading-relaxed">
              Turn any YouTube lecture into structured notes with AI vision.
              Equations, diagrams, code — captured from the screen.
            </p>
          </div>

          <div className="flex flex-col items-center md:items-end gap-2">
            <div className="flex gap-6 mb-2">
              <Link href="/" className="text-sm text-text-2 hover:text-emerald-600 transition-colors">
                Nudge
              </Link>
              <a href="#" className="text-sm text-text-2 hover:text-emerald-600 transition-colors">Privacy</a>
              <a href="#" className="text-sm text-text-2 hover:text-emerald-600 transition-colors">Terms</a>
            </div>
            <p className="text-xs text-text-4">
              © {currentYear} Nudge AI. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}

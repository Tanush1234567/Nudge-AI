import * as React from 'react';
import { Logo } from '@/components/shared/logo';
import { cn } from '@/lib/utils';

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t border-default bg-surface-1 py-12">
      <div className="container max-w-7xl mx-auto px-4">
        <div className="flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex flex-col items-center md:items-start gap-4">
            <Logo size={20} />
            <p className="text-sm text-text-3 text-center md:text-left max-w-xs">
              Every other tool reads the subtitles. We actually watch the video.
            </p>
          </div>

          <div className="flex flex-col items-center md:items-end gap-2">
            <div className="flex gap-6 mb-2">
              <a href="#" className="text-sm text-text-2 hover:text-brand-500 transition-colors">Privacy</a>
              <a href="#" className="text-sm text-text-2 hover:text-brand-500 transition-colors">Terms</a>
              <a href="#" className="text-sm text-text-2 hover:text-brand-500 transition-colors">Twitter</a>
            </div>
            <p className="text-xs text-text-4">
              © {currentYear} Pupil AI. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}

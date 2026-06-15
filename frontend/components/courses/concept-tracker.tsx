"use client";

/**
 * Concept Tracker — renders one concept's journey across a course.
 *
 * Used inside the course Concepts panel either expanded inline (when a card
 * is clicked) or as a standalone read-only view.
 */

import * as React from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { ChevronRight } from 'lucide-react';

import type { ConceptData } from '@/lib/types';
import { cn } from '@/lib/utils';

function renderKatex(latex: string, display = false): string {
  try {
    return katex.renderToString(latex.replace(/^\$\$|\$\$$/g, ''), {
      displayMode: display,
      throwOnError: false,
    });
  } catch {
    return `<span class="font-mono text-red-500">${latex}</span>`;
  }
}

interface ConceptTrackerProps {
  concept: ConceptData;
  onJumpToLecture?: (lectureNumber: number) => void;
  onJumpToConcept?: (name: string) => void;
}

export function ConceptTracker({
  concept,
  onJumpToLecture,
  onJumpToConcept,
}: ConceptTrackerProps) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-5">
      <h3 className="text-[16px] font-semibold tracking-tight text-[var(--text-1)]">
        {concept.name}
      </h3>
      <div className="mt-1 text-[12px] text-[var(--text-3)]">
        First introduced:{' '}
        <button
          onClick={() => onJumpToLecture?.(concept.first_appearance.lecture)}
          className="text-[var(--brand-500)] hover:underline font-semibold border-none bg-transparent cursor-pointer p-0"
        >
          Lecture {concept.first_appearance.lecture}
        </button>{' '}
        · {concept.first_appearance.timestamp}
      </div>

      {/* Timeline */}
      <div className="mt-4 relative pl-5">
        <div className="absolute left-1.5 top-1 bottom-1 w-px bg-[var(--border)]" />
        {concept.appearances.map((app, i) => (
          <div key={i} className="relative pb-3 last:pb-0">
            <div
              className={cn(
                "absolute -left-[14px] top-1 w-2.5 h-2.5 rounded-full border-2",
                app.context === 'definition'
                  ? 'bg-[var(--brand-500)] border-[var(--brand-500)]'
                  : 'bg-[var(--surface-1)] border-[var(--brand-500)]',
              )}
            />
            <button
              onClick={() => onJumpToLecture?.(app.lecture)}
              className="text-left block w-full border-none bg-transparent p-0 cursor-pointer hover:opacity-80"
            >
              <div className="text-[12.5px] font-semibold text-[var(--text-1)]">
                Lecture {app.lecture}{' '}
                <span className="text-[var(--text-3)] font-normal font-mono text-[11px]">
                  ({app.timestamp})
                </span>{' '}
                <span
                  className={cn(
                    'ml-1 text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded',
                    app.context === 'definition'
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                      : app.context === 'review'
                        ? 'bg-[var(--surface-2)] text-[var(--text-2)]'
                        : 'bg-[var(--brand-500)]/10 text-[var(--brand-500)]',
                  )}
                >
                  {app.context}
                </span>
              </div>
              {app.section_title && (
                <div className="text-[11.5px] text-[var(--text-3)] mt-0.5 truncate">
                  {app.section_title}
                </div>
              )}
              {app.equation && (
                <div
                  className="text-[12px] text-[var(--text-2)] mt-0.5 overflow-x-auto"
                  dangerouslySetInnerHTML={{ __html: renderKatex(app.equation, false) }}
                />
              )}
            </button>
          </div>
        ))}
      </div>

      <div className="mt-3 text-[11.5px] text-[var(--text-3)]">
        Appears in {concept.total_appearances} of {concept.appearances.length === concept.total_appearances ? concept.total_appearances : '—'}{' '}
        lectures
      </div>

      {(concept.depends_on.length > 0 || concept.leads_to.length > 0) && (
        <div className="mt-4 grid grid-cols-2 gap-3">
          {concept.depends_on.length > 0 && (
            <div>
              <div className="text-[10.5px] uppercase tracking-wider font-semibold text-[var(--text-3)] mb-1.5">
                Depends on
              </div>
              <div className="flex flex-wrap gap-1.5">
                {concept.depends_on.map((d) => (
                  <button
                    key={d}
                    onClick={() => onJumpToConcept?.(d)}
                    className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20 hover:bg-amber-500/15 cursor-pointer"
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
          )}
          {concept.leads_to.length > 0 && (
            <div>
              <div className="text-[10.5px] uppercase tracking-wider font-semibold text-[var(--text-3)] mb-1.5">
                Leads to
              </div>
              <div className="flex flex-wrap gap-1.5">
                {concept.leads_to.map((d) => (
                  <button
                    key={d}
                    onClick={() => onJumpToConcept?.(d)}
                    className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--brand-500)]/10 text-[var(--brand-500)] border border-[var(--brand-500)]/20 hover:bg-[var(--brand-500)]/20 cursor-pointer inline-flex items-center gap-1"
                  >
                    {d} <ChevronRight size={10} />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

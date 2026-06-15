"use client";

/**
 * Custom BlockNote blocks used by the course overview page.
 *
 * WHY: The course overview is a real BlockNote document so users can rearrange
 * AI-generated sections, drop their own notes between them, and use slash
 * commands. The blocks below are the AI-generated ones: a progress dashboard,
 * a lecture card, and a syllabus topic entry. All three are display-only
 * (content: "none"). Arrays are stored as JSON strings because BlockNote
 * propSchema only supports primitive defaults.
 */

import * as React from 'react';
import { createReactBlockSpec } from '@blocknote/react';
import { Check, RefreshCw, BookOpen, Sparkles } from 'lucide-react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

// --- helpers ----------------------------------------------------------------

function safeParseArray<T = unknown>(raw: string | undefined | null): T[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function renderKatexHTML(latex: string, display = true): string {
  try {
    return katex.renderToString(latex, { displayMode: display, throwOnError: false });
  } catch {
    return `<span class="font-mono text-red-500">${latex}</span>`;
  }
}

function stripDollars(s: string): string {
  return s.replace(/^\$\$|\$\$$/g, '').replace(/^\$|\$$/g, '').trim();
}

// --- 1. ProgressBlock -------------------------------------------------------

export const ProgressBlock = createReactBlockSpec(
  {
    type: 'progress',
    propSchema: {
      totalVideos: { default: 0 },
      processedVideos: { default: 0 },
      totalConcepts: { default: 0 },
      totalEquations: { default: 0 },
      totalFrames: { default: 0 },
      status: { default: 'processing' },
    },
    content: 'none',
  },
  {
    render: ({ block }) => {
      const p = block.props as {
        totalVideos: number;
        processedVideos: number;
        totalConcepts: number;
        totalEquations: number;
        totalFrames: number;
        status: string;
      };
      const pct = p.totalVideos > 0
        ? Math.min(100, Math.round((p.processedVideos / p.totalVideos) * 100))
        : 0;
      const isComplete = p.status === 'complete';

      return (
        <div className="w-full rounded-xl bg-[var(--surface-2)] border border-[var(--border)] p-4 my-2">
          {isComplete ? (
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-semibold text-[13.5px]">
              <Check size={16} />
              Course fully processed
            </div>
          ) : (
            <>
              <div className="h-1.5 w-full bg-[var(--surface-3)] rounded-full overflow-hidden">
                <div
                  className={`h-full bg-[var(--brand-500)] rounded-full transition-[width] duration-300 ${
                    p.status === 'processing' ? 'animate-pulse' : ''
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="mt-2 text-[13px] font-semibold text-[var(--text-1)]">
                {p.processedVideos}/{p.totalVideos} lectures processed
              </div>
            </>
          )}
          <div className="mt-2 text-[12px] text-[var(--text-3)] flex items-center gap-2 flex-wrap">
            <span>{p.totalConcepts} concepts</span>
            <span>·</span>
            <span>{p.totalEquations} equations</span>
            <span>·</span>
            <span>{p.totalFrames} captured frames</span>
          </div>
        </div>
      );
    },
  },
);

// --- 2. LectureCardBlock ---------------------------------------------------

export const LectureCardBlock = createReactBlockSpec(
  {
    type: 'lectureCard',
    propSchema: {
      lectureNumber: { default: 1 },
      title: { default: '' },
      status: { default: 'queued' },
      keyTakeaway: { default: '' },
      keyEquation: { default: '' },
      videoId: { default: '' },
      newCount: { default: 0 },
      reviewCount: { default: 0 },
      appliedCount: { default: 0 },
      keyConnection: { default: '' },
    },
    content: 'none',
  },
  {
    render: ({ block }) => {
      const p = block.props as {
        lectureNumber: number;
        title: string;
        status: string;
        keyTakeaway: string;
        keyEquation: string;
        videoId: string;
        newCount: number;
        reviewCount: number;
        appliedCount: number;
        keyConnection: string;
      };
      const isComplete = p.status === 'complete';
      const isProcessing = !isComplete && p.status !== 'queued' && p.status !== 'error';

      const onOpen = () => {
        if (!p.videoId || !isComplete) return;
        // Soft client-side nav — keeps the BlockNote editor unmounted cleanly.
        const url = `/dashboard?page=notes&jobId=${encodeURIComponent(p.videoId)}`;
        window.history.pushState({}, '', url);
        window.dispatchEvent(new PopStateEvent('popstate'));
      };

      // KaTeX preview for the lecture's key equation (display mode false → inline).
      const eqHtml = p.keyEquation
        ? renderKatexHTML(stripDollars(p.keyEquation), false)
        : null;

      return (
        <div
          onClick={onOpen}
          className={`group flex items-center gap-3 px-3.5 py-3 my-2 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] transition-all ${
            isComplete ? 'cursor-pointer hover:-translate-y-0.5 hover:shadow-md hover:border-[var(--brand-500)]/40' : 'opacity-75'
          }`}
        >
          {/* Lecture number circle */}
          <div
            className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-[12px] font-bold ${
              isComplete
                ? 'bg-[var(--brand-500)] text-white'
                : isProcessing
                  ? 'bg-[var(--brand-500)]/15 text-[var(--brand-500)] animate-pulse'
                  : 'bg-[var(--surface-3)] text-[var(--text-3)]'
            }`}
          >
            {p.lectureNumber}
          </div>

          {/* Title + takeaway + equation */}
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-semibold text-[var(--text-1)] truncate group-hover:text-[var(--brand-500)]">
              {p.title || 'Untitled lecture'}
            </div>
            {p.keyTakeaway && (
              <div className="text-[11.5px] text-[var(--text-2)] line-clamp-1 mt-0.5">
                {p.keyTakeaway.replace(/<[^>]+>/g, '')}
              </div>
            )}
            {eqHtml && (
              <div
                className="text-[12px] text-[var(--text-2)] mt-1 truncate"
                dangerouslySetInnerHTML={{ __html: eqHtml }}
              />
            )}
            {(p.newCount > 0 || p.reviewCount > 0 || p.appliedCount > 0) && (
              <div
                className="mt-2 flex items-center gap-1.5 flex-wrap"
                title={p.keyConnection || undefined}
                onClick={(e) => { e.stopPropagation(); }}
              >
                {p.newCount > 0 && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">
                    🆕 {p.newCount} new
                  </span>
                )}
                {p.reviewCount > 0 && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[var(--surface-2)] text-[var(--text-2)]">
                    🔄 {p.reviewCount} review
                  </span>
                )}
                {p.appliedCount > 0 && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[var(--brand-500)]/12 text-[var(--brand-500)]">
                    ⚡ {p.appliedCount} applied
                  </span>
                )}
                {p.keyConnection && (
                  <span className="text-[10.5px] text-[var(--text-3)] italic line-clamp-1">
                    💡 {p.keyConnection}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Status indicator */}
          <div className="shrink-0 text-[var(--text-3)]">
            {isComplete ? (
              <Check size={15} className="text-emerald-500" />
            ) : isProcessing ? (
              <RefreshCw size={14} className="text-[var(--brand-500)] animate-spin" />
            ) : (
              <span className="inline-block w-3 h-3 rounded-full border border-[var(--text-3)]" />
            )}
          </div>
        </div>
      );
    },
  },
);

// --- 3. SyllabusEntryBlock --------------------------------------------------

export const SyllabusEntryBlock = createReactBlockSpec(
  {
    type: 'syllabusEntry',
    propSchema: {
      title: { default: '' },
      lecturesJson: { default: '[]' },
      equationsJson: { default: '[]' },
      conceptsJson: { default: '[]' },
      prerequisitesJson: { default: '[]' },
    },
    content: 'none',
  },
  {
    render: ({ block }) => {
      const p = block.props as {
        title: string;
        lecturesJson: string;
        equationsJson: string;
        conceptsJson: string;
        prerequisitesJson: string;
      };
      const lectures = safeParseArray<number>(p.lecturesJson);
      const equations = safeParseArray<string>(p.equationsJson);
      const concepts = safeParseArray<string>(p.conceptsJson);
      const prerequisites = safeParseArray<string>(p.prerequisitesJson);

      const scrollToLecture = (n: number) => {
        const target = document.querySelector(`[data-lecture-anchor="${n}"]`);
        target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };

      return (
        <div className="my-3 rounded-r-lg border-l-[3px] border-[var(--brand-500)] bg-[var(--brand-500)]/[0.04] dark:bg-[var(--brand-500)]/[0.08] p-4">
          <div className="text-[15px] font-semibold tracking-tight text-[var(--text-1)] leading-snug">
            {p.title || 'Untitled topic'}
          </div>

          {lectures.length > 0 && (
            <div className="mt-2 flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] uppercase tracking-wider text-[var(--text-3)] font-semibold">
                Lectures
              </span>
              {lectures.map((n) => (
                <button
                  key={n}
                  onClick={() => scrollToLecture(n)}
                  className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[var(--brand-500)]/15 text-[var(--brand-500)] hover:bg-[var(--brand-500)]/25 border-none cursor-pointer"
                >
                  L{n}
                </button>
              ))}
            </div>
          )}

          {equations.length > 0 && (
            <div className="mt-3">
              <div className="text-[11px] uppercase tracking-wider text-[var(--text-3)] font-semibold mb-1">
                Key equations
              </div>
              <div className="flex flex-col gap-1.5">
                {equations.map((eq, i) => (
                  <div
                    key={i}
                    className="overflow-x-auto"
                    dangerouslySetInnerHTML={{ __html: renderKatexHTML(stripDollars(eq), true) }}
                  />
                ))}
              </div>
            </div>
          )}

          {concepts.length > 0 && (
            <div className="mt-3 flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] uppercase tracking-wider text-[var(--text-3)] font-semibold">
                Concepts
              </span>
              {concepts.map((c, i) => (
                <span
                  key={i}
                  className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--surface-2)] text-[var(--text-2)] border border-[var(--border)]"
                >
                  {c}
                </span>
              ))}
            </div>
          )}

          {prerequisites.length > 0 && (
            <div className="mt-3 flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] uppercase tracking-wider text-[var(--text-3)] font-semibold">
                Prerequisites
              </span>
              {prerequisites.map((p2, i) => (
                <span
                  key={i}
                  className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20"
                  title={p2}
                >
                  {p2}
                </span>
              ))}
            </div>
          )}
        </div>
      );
    },
  },
);

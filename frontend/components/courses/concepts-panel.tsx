"use client";

/**
 * Course concepts grid view — sort/search/filter the concept inventory and
 * drill into each concept with the ConceptTracker.
 */

import * as React from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { Search, Sparkles, Loader2 as LoaderIcon, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { ConceptData, ConceptGraph } from '@/lib/types';
import {
  generateCourseConcepts,
  getCourseConcepts,
} from '@/lib/api';
import { ConceptTracker } from './concept-tracker';

function renderKatexInline(latex: string): string {
  try {
    return katex.renderToString(latex.replace(/^\$\$|\$\$$/g, ''), {
      displayMode: false,
      throwOnError: false,
    });
  } catch {
    return `<span class="font-mono text-red-500">${latex}</span>`;
  }
}

type SortMode = 'frequency' | 'first_appearance' | 'alphabetical';

function classifyConceptType(c: ConceptData): 'equation' | 'theorem' | 'definition' | 'technique' {
  const hasEq = c.appearances.some((a) => !!a.equation);
  if (hasEq) return 'equation';
  const name = c.name.toLowerCase();
  if (/theorem|lemma|corollary|law/.test(name)) return 'theorem';
  if (/method|technique|algorithm|procedure|approach/.test(name)) return 'technique';
  return 'definition';
}

interface ConceptsPanelProps {
  courseId: string;
  onJumpToLecture?: (lectureNumber: number) => void;
}

export function ConceptsPanel({ courseId, onJumpToLecture }: ConceptsPanelProps) {
  const [graph, setGraph] = React.useState<ConceptGraph | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [generating, setGenerating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [search, setSearch] = React.useState('');
  const [sortMode, setSortMode] = React.useState<SortMode>('frequency');
  const [typeFilter, setTypeFilter] = React.useState<'all' | 'equation' | 'theorem' | 'definition' | 'technique'>('all');
  const [activeConceptName, setActiveConceptName] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const g = await getCourseConcepts(courseId);
      setGraph(g);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load concepts');
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  React.useEffect(() => { load(); }, [load]);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      await generateCourseConcepts(courseId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Concept extraction failed.');
    } finally {
      setGenerating(false);
    }
  };

  const concepts = graph?.concepts || [];
  const visible = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = concepts.filter((c) => {
      if (typeFilter !== 'all' && classifyConceptType(c) !== typeFilter) return false;
      if (q && !c.name.toLowerCase().includes(q)) return false;
      return true;
    });
    if (sortMode === 'frequency') {
      list = list.slice().sort((a, b) => b.total_appearances - a.total_appearances);
    } else if (sortMode === 'first_appearance') {
      list = list.slice().sort((a, b) => a.first_appearance.lecture - b.first_appearance.lecture);
    } else {
      list = list.slice().sort((a, b) => a.name.localeCompare(b.name));
    }
    return list;
  }, [concepts, search, sortMode, typeFilter]);

  const activeConcept = activeConceptName
    ? concepts.find((c) => c.name === activeConceptName) || null
    : null;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-[var(--text-3)] text-sm gap-3">
        <LoaderIcon className="w-6 h-6 animate-spin text-[var(--brand-500)]" />
        Loading concepts…
      </div>
    );
  }

  if (concepts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center max-w-md mx-auto gap-4">
        <Sparkles size={28} className="text-[var(--brand-500)]" />
        <div>
          <h3 className="text-[15px] font-semibold tracking-tight">No concepts yet</h3>
          <p className="text-[12.5px] text-[var(--text-2)] mt-1 leading-relaxed">
            Concepts auto-extract when all lectures finish processing, or you can run the extractor manually now.
          </p>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="flex items-center gap-1.5 py-2 px-3.5 bg-[var(--brand-500)] hover:bg-[var(--brand-600)] text-white text-[12.5px] font-semibold rounded-lg border-none cursor-pointer disabled:opacity-60"
        >
          {generating ? <LoaderIcon size={13} className="animate-spin" /> : <Sparkles size={13} />}
          Extract concepts now
        </button>
      </div>
    );
  }

  if (activeConcept) {
    return (
      <div>
        <button
          onClick={() => setActiveConceptName(null)}
          className="text-[12px] text-[var(--text-3)] hover:text-[var(--text-1)] inline-flex items-center gap-1 border-none bg-transparent cursor-pointer mb-3"
        >
          <X size={12} /> Back to all concepts
        </button>
        <ConceptTracker
          concept={activeConcept}
          onJumpToLecture={onJumpToLecture}
          onJumpToConcept={(name) => setActiveConceptName(name)}
        />
      </div>
    );
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2.5 mb-4">
        <div className="flex items-center gap-2 px-2.5 py-1 bg-[var(--surface-2)] border border-[var(--border)] rounded-lg flex-1 min-w-[180px]">
          <Search size={13} className="text-[var(--text-3)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search concepts…"
            className="flex-1 bg-transparent border-none outline-none text-[12.5px] text-[var(--text-1)] placeholder-[var(--text-3)]"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as any)}
          className="text-[12px] py-1 px-2 bg-[var(--surface-2)] border border-[var(--border)] rounded-lg text-[var(--text-1)] outline-none cursor-pointer"
        >
          <option value="all">All types</option>
          <option value="equation">Equations</option>
          <option value="theorem">Theorems</option>
          <option value="definition">Definitions</option>
          <option value="technique">Techniques</option>
        </select>
        <select
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as any)}
          className="text-[12px] py-1 px-2 bg-[var(--surface-2)] border border-[var(--border)] rounded-lg text-[var(--text-1)] outline-none cursor-pointer"
        >
          <option value="frequency">By frequency</option>
          <option value="first_appearance">By first appearance</option>
          <option value="alphabetical">Alphabetical</option>
        </select>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="flex items-center gap-1.5 py-1 px-2.5 bg-transparent text-[var(--text-2)] border border-[var(--border)] hover:bg-[var(--hover)] hover:text-[var(--text-1)] rounded-lg text-[12px] font-semibold transition-colors border-none cursor-pointer disabled:opacity-60"
        >
          {generating ? <LoaderIcon width={12} height={12} className="animate-spin" /> : <Sparkles size={12} />}
          Re-extract
        </button>
      </div>

      <div className="text-[11.5px] text-[var(--text-3)] mb-3">
        {visible.length} of {concepts.length} concepts
      </div>

      {/* Cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {visible.map((c) => {
          const type = classifyConceptType(c);
          const firstEq = c.appearances.find((a) => a.equation)?.equation;
          return (
            <button
              key={c.id}
              onClick={() => setActiveConceptName(c.name)}
              className="text-left p-4 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] hover:border-[var(--brand-500)]/40 hover:-translate-y-0.5 hover:shadow-md transition-all bg-transparent cursor-pointer"
              style={{ borderStyle: 'solid' }}
            >
              <div className="flex items-start justify-between gap-3">
                <h4 className="text-[13.5px] font-semibold tracking-tight text-[var(--text-1)] leading-snug">
                  {c.name}
                </h4>
                <span
                  className={cn(
                    'shrink-0 text-[9.5px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded',
                    type === 'equation' && 'bg-[var(--brand-500)]/10 text-[var(--brand-500)]',
                    type === 'theorem' && 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
                    type === 'definition' && 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                    type === 'technique' && 'bg-[var(--surface-2)] text-[var(--text-2)]',
                  )}
                >
                  {type}
                </span>
              </div>
              <div className="mt-1 text-[11.5px] text-[var(--text-3)]">
                Appears in {c.total_appearances} {c.total_appearances === 1 ? 'lecture' : 'lectures'}
              </div>
              {firstEq && (
                <div
                  className="mt-2 text-[12px] text-[var(--text-2)] overflow-x-auto"
                  dangerouslySetInnerHTML={{ __html: renderKatexInline(firstEq) }}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

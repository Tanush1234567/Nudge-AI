"use client";

/**
 * Exam study guide — rendered as a BlockNote document inside the course
 * overview. The blocks are real BlockNote blocks so the student can edit,
 * rearrange, delete, or interleave their own notes.
 */

import * as React from 'react';
import "@mantine/core/styles.css";
import { MantineProvider } from "@mantine/core";
import {
  BlockNoteSchema,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
} from "@blocknote/core";
import {
  useCreateBlockNote,
  createReactInlineContentSpec,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import {
  Sparkles,
  Loader2 as LoaderIcon,
  Lock,
  RefreshCw,
} from 'lucide-react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

import { cn } from '@/lib/utils';
import type {
  CourseWithLectures,
  ExamGuide as ExamGuideData,
  ExamTopic,
  MasterEquationDetail,
} from '@/lib/types';
import { generateExamGuide, getExamGuide } from '@/lib/api';

// --- Schema (same math inline + native blocks, no custom block specs) ------

const MathInline = createReactInlineContentSpec(
  {
    type: 'math',
    propSchema: { latex: { default: '' }, display: { default: 'false' } },
    content: 'none',
  },
  {
    render: ({ inlineContent }) => {
      const latex = inlineContent.props.latex as string;
      const display = inlineContent.props.display === 'true';
      try {
        const html = katex.renderToString(latex, {
          displayMode: display,
          throwOnError: false,
        });
        return (
          <span
            className={display ? 'pupil-math-display' : 'pupil-math-inline'}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      } catch {
        return <span className="font-mono text-red-500 text-sm">{latex}</span>;
      }
    },
  },
);

const examSchema = BlockNoteSchema.create({
  blockSpecs: { ...defaultBlockSpecs },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    math: MathInline,
  },
});

// --- Block builder ---------------------------------------------------------

function paragraph(text: string): any {
  return { type: 'paragraph', content: [{ type: 'text', text, styles: {} }] };
}

function heading(level: 1 | 2 | 3, text: string): any {
  return {
    type: 'heading',
    props: { level },
    content: [{ type: 'text', text, styles: {} }],
  };
}

function callout(icon: string, body: string, color: 'default' | 'red' | 'yellow' | 'blue' = 'default'): any {
  return {
    type: 'callout',
    props: { icon, backgroundColor: color },
    content: [{ type: 'text', text: body, styles: {} }],
  };
}

function divider(): any {
  return {
    type: 'paragraph',
    content: [{ type: 'text', text: '———', styles: { textColor: 'gray' } as any }],
  };
}

function equationParagraph(latex: string): any {
  const clean = latex.replace(/^\$\$|\$\$$/g, '').trim();
  return {
    type: 'paragraph',
    content: [{ type: 'math', props: { latex: clean, display: 'true' } }],
  };
}

function inlineWithMath(textWithDollars: string): any {
  // Split on $$...$$ and produce a paragraph with text + math inline runs.
  const parts: any[] = [];
  const re = /\$\$([\s\S]*?)\$\$/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(textWithDollars)) !== null) {
    if (m.index > lastIndex) {
      parts.push({ type: 'text', text: textWithDollars.slice(lastIndex, m.index), styles: {} });
    }
    parts.push({ type: 'math', props: { latex: m[1].trim(), display: 'false' } });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < textWithDollars.length) {
    parts.push({ type: 'text', text: textWithDollars.slice(lastIndex), styles: {} });
  }
  if (parts.length === 0) parts.push({ type: 'text', text: textWithDollars, styles: {} });
  return { type: 'paragraph', content: parts };
}

function importanceIcon(importance: string): string {
  if (importance === 'HIGH') return '🔴';
  if (importance === 'MEDIUM') return '🟡';
  return '⚪';
}

export function buildExamGuideBlocks(guide: ExamGuideData): any[] {
  const blocks: any[] = [];

  blocks.push(heading(2, '📝 Exam study guide'));
  if (guide.overview) {
    blocks.push(paragraph(guide.overview));
  }

  if (guide.topics?.length) {
    for (const t of guide.topics as ExamTopic[]) {
      const tag = importanceIcon(t.importance);
      blocks.push(heading(3, `${tag} ${t.title} — ${t.importance}`));
      if (t.explanation) blocks.push(paragraph(t.explanation));

      for (const eq of (t.equations || [])) {
        blocks.push(equationParagraph(eq.latex));
        if (eq.description) {
          blocks.push({
            type: 'paragraph',
            content: [{ type: 'text', text: eq.description, styles: { italic: true } }],
          });
        }
      }

      if (t.best_source?.lecture) {
        blocks.push(
          callout(
            '📺',
            `Best explanation: Lecture ${t.best_source.lecture} at ${t.best_source.timestamp || '0:00'}`,
            'blue',
          ),
        );
      }
      if (t.exam_patterns?.length) {
        blocks.push(
          callout(
            '🎯',
            `Exam patterns: ${t.exam_patterns.join(' · ')}`,
            'default',
          ),
        );
      }
      if (t.connections?.length) {
        blocks.push({
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Connects to: ', styles: { italic: true, textColor: 'gray' } as any },
            { type: 'text', text: t.connections.join(', '), styles: {} },
          ],
        });
      }
    }
  }

  if (guide.master_equations?.length) {
    blocks.push(divider());
    blocks.push(heading(2, '📊 Master equation sheet'));
    for (const eq of guide.master_equations as MasterEquationDetail[]) {
      blocks.push(equationParagraph(eq.latex));
      const meta: string[] = [];
      if (eq.variables) meta.push(eq.variables);
      if (eq.when_to_use) meta.push(`Use when: ${eq.when_to_use}`);
      if (eq.lecture || eq.timestamp) {
        meta.push(`Source: L${eq.lecture}${eq.timestamp ? `, ${eq.timestamp}` : ''}`);
      }
      if (eq.topic) meta.push(`Topic: ${eq.topic}`);
      blocks.push({
        type: 'paragraph',
        content: [
          { type: 'text', text: meta.join(' — '), styles: { italic: true, textColor: 'gray' } as any },
        ],
      });
    }
  }

  if (guide.quick_reference) {
    blocks.push(divider());
    blocks.push(heading(2, '⚡ Quick reference'));

    const qr = guide.quick_reference;
    if (qr.definitions?.length) {
      blocks.push(heading(3, 'Definitions'));
      blocks.push({
        type: 'bulletListItem',
        content: [{ type: 'text', text: '', styles: {} }],
      });
      // Use individual bullet items so each renders as its own line.
      for (const d of qr.definitions) {
        blocks.push({
          type: 'bulletListItem',
          content: [
            { type: 'text', text: d.term + ': ', styles: { bold: true } },
            { type: 'text', text: d.definition, styles: {} },
          ],
        });
      }
    }

    if (qr.theorems?.length) {
      blocks.push(heading(3, 'Theorems'));
      for (const th of qr.theorems) {
        blocks.push({
          type: 'bulletListItem',
          content: [
            { type: 'text', text: th.name + '. ', styles: { bold: true } },
            { type: 'text', text: th.statement, styles: {} },
            ...(th.proof_ref
              ? [{ type: 'text', text: ` (proof: ${th.proof_ref})`, styles: { italic: true, textColor: 'gray' } as any }]
              : []),
          ],
        });
      }
    }

    if (qr.common_mistakes?.length) {
      blocks.push(
        callout(
          '⚠️',
          'Common mistakes:\n- ' + qr.common_mistakes.join('\n- '),
          'red',
        ),
      );
    }

    if (qr.patterns?.length) {
      blocks.push(heading(3, 'If you see X, use Y'));
      for (const p of qr.patterns) {
        blocks.push(
          callout('💡', `If you see ${p.if_you_see} → use ${p.use}`, 'yellow'),
        );
      }
    }
  }

  blocks.push(divider());
  blocks.push(heading(2, 'My exam notes'));
  blocks.push(paragraph(''));

  return blocks;
}

// --- Component -------------------------------------------------------------

interface ExamGuideProps {
  course: CourseWithLectures;
}

export function ExamGuidePanel({ course }: ExamGuideProps) {
  const [guide, setGuide] = React.useState<ExamGuideData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [generating, setGenerating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [isDark, setIsDark] = React.useState(false);

  const isComplete = course.status === 'complete';

  // Initial fetch.
  const load = React.useCallback(async () => {
    try {
      const res = await getExamGuide(course.id);
      setGuide(res.exam_guide);
    } catch (e) {
      // 404 just means no guide yet — not an error.
      setGuide(null);
    } finally {
      setLoading(false);
    }
  }, [course.id]);

  React.useEffect(() => { load(); }, [load]);

  React.useEffect(() => {
    const check = () => setIsDark(document.documentElement.classList.contains('dark'));
    check();
    const obs = new MutationObserver(check);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  const handleGenerate = async () => {
    if (!isComplete) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await generateExamGuide(course.id);
      setGuide(res.exam_guide);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Exam guide generation failed.');
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-[var(--text-3)] text-sm gap-3">
        <LoaderIcon className="w-6 h-6 animate-spin text-[var(--brand-500)]" />
        Loading exam guide…
      </div>
    );
  }

  if (!guide && !isComplete) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center max-w-md mx-auto gap-3">
        <Lock size={28} className="text-[var(--text-3)]" />
        <h3 className="text-[15px] font-semibold tracking-tight">Exam guide locked</h3>
        <p className="text-[12.5px] text-[var(--text-2)] leading-relaxed">
          The exam guide unlocks once every lecture in this course has finished processing.
          You're at {course.processed_videos}/{course.total_videos} lectures.
        </p>
      </div>
    );
  }

  if (!guide && isComplete) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center max-w-md mx-auto gap-4">
        <Sparkles size={28} className="text-[var(--brand-500)]" />
        <div>
          <h3 className="text-[15px] font-semibold tracking-tight">Generate your exam study guide</h3>
          <p className="text-[12.5px] text-[var(--text-2)] mt-1 leading-relaxed">
            Pupil reads all {course.total_videos} lectures and produces a topic-organised guide with
            equations, exam patterns, and a quick-reference cheat sheet.
          </p>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="flex items-center gap-1.5 py-2 px-3.5 bg-[var(--brand-500)] hover:bg-[var(--brand-600)] text-white text-[13px] font-semibold rounded-lg border-none cursor-pointer disabled:opacity-60"
        >
          {generating ? <LoaderIcon size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {generating ? `Analysing ${course.total_videos} lectures…` : 'Generate exam guide'}
        </button>
        {generating && (
          <p className="text-[11.5px] text-[var(--text-3)] max-w-xs">
            Generating your exam guide… this analyses all {course.total_videos} lectures and usually takes ~30 seconds.
          </p>
        )}
      </div>
    );
  }

  // We have a guide — render it as an editable BlockNote.
  return (
    <div>
      <div className="flex items-center justify-end gap-2 mb-3">
        <button
          onClick={handleGenerate}
          disabled={generating}
          title="Regenerate from current lecture content"
          className="flex items-center gap-1.5 py-1 px-2.5 bg-transparent text-[var(--text-2)] border border-[var(--border)] hover:bg-[var(--hover)] hover:text-[var(--text-1)] rounded-lg text-[12px] font-semibold transition-colors cursor-pointer disabled:opacity-60"
        >
          {generating ? <LoaderIcon width={12} height={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Regenerate
        </button>
      </div>
      {error && <p className="mb-2 text-xs text-red-400">{error}</p>}
      <ExamGuideEditor guide={guide!} isDark={isDark} />
    </div>
  );
}

function ExamGuideEditor({ guide, isDark }: { guide: ExamGuideData; isDark: boolean }) {
  const blocks = React.useMemo(() => buildExamGuideBlocks(guide), [guide]);
  const editor = useCreateBlockNote({ schema: examSchema, initialContent: blocks });
  return (
    <MantineProvider forceColorScheme={isDark ? 'dark' : 'light'}>
      <div className={cn('prose dark:prose-invert max-w-none')}>
        <BlockNoteView editor={editor} theme={isDark ? 'dark' : 'light'} />
      </div>
    </MantineProvider>
  );
}

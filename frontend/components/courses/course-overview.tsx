"use client";

/**
 * Course overview page rendered as a BlockNote document.
 *
 * The document is a regular editor with custom blocks (progress / lecture
 * card / syllabus entry) pre-populated. Users can rearrange, delete, or
 * insert their own blocks freely — it's their study page.
 */

import * as React from 'react';
import "@mantine/core/styles.css";
import { MantineProvider } from "@mantine/core";
import {
  BlockNoteSchema,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
} from "@blocknote/core";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import {
  MessageSquare,
  Sparkles,
  RefreshCw,
  Download,
  Lock,
  Loader2 as LoaderIcon,
  ChevronLeft,
} from 'lucide-react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

import { cn } from '@/lib/utils';
import type { CourseWithLectures } from '@/lib/types';
import {
  generateExamGuide,
  generateSyllabus,
  getCourseSyllabus,
  getLectureDiff,
} from '@/lib/api';
import {
  LectureCardBlock,
  ProgressBlock,
  SyllabusEntryBlock,
} from '@/components/notes/course-blocks';
import { ConceptsPanel } from '@/components/courses/concepts-panel';
import { ExamGuidePanel } from '@/components/courses/exam-guide';
import type { LectureDiff } from '@/lib/types';

// --- Combined schema --------------------------------------------------------

// Inline math spec — same as notes-editor.tsx so equations render the same way
// inside the course document.
import { createReactInlineContentSpec } from '@blocknote/react';

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
        const html = katex.renderToString(latex, { displayMode: display, throwOnError: false });
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

const courseSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    progress: ProgressBlock(),
    lectureCard: LectureCardBlock(),
    syllabusEntry: SyllabusEntryBlock(),
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    math: MathInline,
  },
});

// --- Block builder ----------------------------------------------------------

function formatHours(totalSeconds: number): string {
  if (!totalSeconds) return '—';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.round((totalSeconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function paragraph(text: string): any {
  return { type: 'paragraph', content: [{ type: 'text', text, styles: {} }] };
}

function heading(level: 1 | 2 | 3, text: string): any {
  return { type: 'heading', props: { level }, content: [{ type: 'text', text, styles: {} }] };
}

function divider(): any {
  // BlockNote has no native divider; use an em-dash separator paragraph.
  return { type: 'paragraph', content: [{ type: 'text', text: '———', styles: { textColor: 'gray' } as any }] };
}

interface BuildArgs {
  course: CourseWithLectures;
  syllabus: any | null;
  diffs?: Record<number, LectureDiff>;
}

export function buildCourseBlocks({ course, syllabus, diffs }: BuildArgs): any[] {
  const blocks: any[] = [];

  // 1. Title + meta
  blocks.push(heading(1, course.title));
  const totalDuration = (course.lectures || []).reduce(
    (sum, l) => sum + (l.duration_seconds || 0),
    0,
  );
  const platform = course.platform || 'youtube';
  blocks.push(
    paragraph(
      `${course.total_videos} lectures · ${formatHours(totalDuration)} · ${platform}`,
    ),
  );

  // 2. Progress dashboard
  const equationCount = (course.lectures || []).reduce((sum, l) => {
    return sum + (l.first_equation ? 1 : 0);
  }, 0);
  blocks.push({
    type: 'progress',
    props: {
      totalVideos: course.total_videos,
      processedVideos: course.processed_videos,
      totalConcepts: 0,
      totalEquations: equationCount,
      totalFrames: 0,
      status: course.status,
    },
  });

  // 3. Lectures heading + cards
  blocks.push(heading(2, 'Lectures'));
  for (const lec of course.lectures || []) {
    const d = diffs?.[lec.lecture_number];
    blocks.push({
      type: 'lectureCard',
      props: {
        lectureNumber: lec.lecture_number,
        title: lec.title || 'Untitled lecture',
        status: lec.status,
        keyTakeaway: lec.key_takeaway || '',
        keyEquation: lec.first_equation || '',
        videoId: lec.job_id,
        newCount: d?.new_concepts.length || 0,
        reviewCount: d?.review_concepts.length || 0,
        appliedCount: d?.applied_concepts.length || 0,
        keyConnection: d?.key_connection || '',
      },
    });
  }

  // 4. Syllabus
  if (syllabus && typeof syllabus === 'object') {
    blocks.push(divider());
    blocks.push(heading(2, 'Syllabus'));
    if (syllabus.overview) {
      blocks.push(paragraph(String(syllabus.overview)));
    }
    for (const topic of syllabus.topics || []) {
      blocks.push({
        type: 'syllabusEntry',
        props: {
          title: topic.title || '',
          lecturesJson: JSON.stringify(topic.lectures || []),
          equationsJson: JSON.stringify(topic.equations || []),
          conceptsJson: JSON.stringify(topic.concepts || []),
          prerequisitesJson: JSON.stringify(topic.prerequisites || []),
        },
      });
    }
  }

  // 5. Master equations (rendered as inline math paragraphs for simplicity)
  const masterEquations = Array.isArray(syllabus?.master_equations)
    ? syllabus!.master_equations
    : [];
  if (masterEquations.length > 0) {
    blocks.push(divider());
    blocks.push(heading(2, 'Master equation sheet'));
    for (const eq of masterEquations) {
      const latex = String(eq.latex || '').replace(/^\$\$|\$\$$/g, '');
      const cite = [eq.name, eq.topic, eq.lecture ? `L${eq.lecture}` : null]
        .filter(Boolean)
        .join(' · ');
      if (cite) blocks.push(paragraph(cite));
      blocks.push({
        type: 'paragraph',
        content: [
          { type: 'math', props: { latex, display: 'true' } },
        ],
      });
    }
  }

  // 6. User notes
  blocks.push(divider());
  blocks.push(heading(2, 'My notes'));
  blocks.push(paragraph(''));

  return blocks;
}

// --- Action bar -------------------------------------------------------------

interface CourseActionBarProps {
  course: CourseWithLectures;
  onSyllabusUpdated: () => void;
  onOpenChat: () => void;
  onOpenExamGuide: () => void;
  onBack: () => void;
}

function CourseActionBar({
  course,
  onSyllabusUpdated,
  onOpenChat,
  onOpenExamGuide,
  onBack,
}: CourseActionBarProps) {
  const [syllabusLoading, setSyllabusLoading] = React.useState(false);

  const isComplete = course.status === 'complete';
  const hasAtLeastOne = course.processed_videos >= 1;
  const chatUnlocked = course.processed_videos >= 5;

  const handleRegenerateSyllabus = async () => {
    if (!hasAtLeastOne) return;
    setSyllabusLoading(true);
    try {
      await generateSyllabus(course.id);
      onSyllabusUpdated();
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : 'Syllabus generation failed.');
    } finally {
      setSyllabusLoading(false);
    }
  };

  return (
    <div className="sticky top-0 z-30 h-[56px] px-6 bg-[var(--bg)]/95 border-b border-[var(--border)] flex items-center justify-between shrink-0 backdrop-blur-md select-none">
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-[12.5px] font-semibold text-[var(--text-3)] hover:text-[var(--text-1)] py-1 px-1.5 rounded hover:bg-[var(--hover)] border-none bg-transparent cursor-pointer"
      >
        <ChevronLeft size={13} /> Library
      </button>

      <div className="flex items-center gap-1.5">
        <ActionButton
          onClick={onOpenChat}
          icon={<MessageSquare size={13} />}
          label="Course AI"
          disabled={!chatUnlocked}
          tooltip={chatUnlocked ? undefined : `Unlocks at 5 processed lectures (${course.processed_videos}/5)`}
        />
        <ActionButton
          onClick={onOpenExamGuide}
          icon={<Sparkles size={13} />}
          label={course.has_exam_guide ? 'Exam guide' : 'Generate exam guide'}
          disabled={!isComplete}
          tooltip={isComplete ? 'Open exam study guide tab' : 'Available when all lectures are processed'}
        />
        <ActionButton
          onClick={handleRegenerateSyllabus}
          icon={syllabusLoading ? <LoaderIcon width={13} height={13} className="animate-spin" /> : <RefreshCw size={13} />}
          label={course.has_syllabus ? 'Regenerate syllabus' : 'Generate syllabus'}
          disabled={!hasAtLeastOne || syllabusLoading}
          tooltip={hasAtLeastOne ? undefined : 'Wait for at least one lecture to complete'}
        />
        <ActionButton
          onClick={() => window.print()}
          icon={<Download size={13} />}
          label="Export"
        />
      </div>
    </div>
  );
}

function ActionButton({
  onClick,
  icon,
  label,
  disabled,
  tooltip,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
  tooltip?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={tooltip}
      className={cn(
        'flex items-center gap-1.5 py-1 px-2.5 rounded-lg text-[12.5px] font-semibold transition-colors border bg-transparent cursor-pointer',
        disabled
          ? 'text-[var(--text-4)] border-[var(--border)] cursor-not-allowed'
          : 'text-[var(--text-2)] border-[var(--border)] hover:bg-[var(--hover)] hover:text-[var(--text-1)]',
      )}
    >
      {disabled ? <Lock size={11} /> : icon}
      {label}
    </button>
  );
}

// --- Main component ---------------------------------------------------------

interface CourseOverviewProps {
  course: CourseWithLectures;
  onBack: () => void;
}

export function CourseOverview({ course, onBack }: CourseOverviewProps) {
  const [syllabus, setSyllabus] = React.useState<any | null>(null);
  const [isDark, setIsDark] = React.useState(false);
  const [activePanel, setActivePanel] = React.useState<'notes' | 'concepts' | 'exam'>('notes');
  const [diffs, setDiffs] = React.useState<Record<number, LectureDiff>>({});

  // Fetch per-lecture diffs in parallel so the cards can show new/review/applied counts.
  React.useEffect(() => {
    let cancelled = false;
    const lectures = (course.lectures || []).filter((l) => l.status === 'complete');
    if (lectures.length === 0) return;
    Promise.allSettled(
      lectures.map((l) => getLectureDiff(course.id, l.lecture_number)),
    ).then((results) => {
      if (cancelled) return;
      const map: Record<number, LectureDiff> = {};
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value) {
          map[lectures[i].lecture_number] = r.value;
        }
      });
      setDiffs(map);
    });
    return () => { cancelled = true; };
  }, [course.id, course.processed_videos]);

  // Pull syllabus the moment the page mounts (and after regenerate).
  const loadSyllabus = React.useCallback(async () => {
    if (!course.has_syllabus) {
      setSyllabus(null);
      return;
    }
    try {
      const res = await getCourseSyllabus(course.id);
      // The endpoint returns master_equations separately; merge so the block
      // builder can read both off one object.
      setSyllabus({
        ...(res.syllabus || {}),
        master_equations: res.master_equations || res.syllabus?.master_equations || [],
      });
    } catch (e) {
      console.error('Failed to load syllabus:', e);
      setSyllabus(null);
    }
  }, [course.id, course.has_syllabus]);

  React.useEffect(() => { loadSyllabus(); }, [loadSyllabus]);

  // Track dark mode via the same MutationObserver pattern as notes-editor.
  React.useEffect(() => {
    const check = () => setIsDark(document.documentElement.classList.contains('dark'));
    check();
    const obs = new MutationObserver(check);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  const initialBlocks = React.useMemo(
    () => buildCourseBlocks({ course, syllabus, diffs }),
    [course, syllabus, diffs],
  );

  // Editor key includes diff-count signature so badges update once diffs arrive.
  const diffSignature = Object.keys(diffs).sort().join(',');
  const editorKey = `${course.id}-${course.processed_videos}-${course.has_syllabus ? 'syl' : 'no'}-${diffSignature}`;

  const handleJumpToLecture = (lectureNumber: number) => {
    const lec = course.lectures.find((l) => l.lecture_number === lectureNumber);
    if (!lec) return;
    window.location.href = `/dashboard?page=notes&jobId=${encodeURIComponent(lec.job_id)}`;
  };

  return (
    <div className="flex flex-col h-full w-full bg-[var(--bg)]">
      <CourseActionBar
        course={course}
        onSyllabusUpdated={loadSyllabus}
        onOpenChat={() => alert('Course AI is coming soon.')}
        onOpenExamGuide={() => setActivePanel('exam')}
        onBack={onBack}
      />

      {/* Panel tabs */}
      <div className="px-6 pt-2 flex items-center gap-1 border-b border-[var(--border)] shrink-0">
        {(['notes', 'concepts', 'exam'] as const).map((p) => {
          const label = p === 'notes' ? 'Notes' : p === 'concepts' ? 'Concepts' : 'Exam guide';
          return (
            <button
              key={p}
              onClick={() => setActivePanel(p)}
              className={cn(
                'py-1.5 px-3 -mb-px text-[12.5px] font-semibold border-b-2 transition-colors border-none bg-transparent cursor-pointer inline-flex items-center gap-1',
                activePanel === p
                  ? 'text-[var(--brand-500)]'
                  : 'text-[var(--text-3)] hover:text-[var(--text-1)]',
              )}
              style={{
                borderBottomStyle: 'solid',
                borderBottomWidth: 2,
                borderBottomColor: activePanel === p ? 'var(--brand-500)' : 'transparent',
              }}
            >
              {label}
              {p === 'exam' && course.status !== 'complete' && (
                <Lock size={10} className="text-[var(--text-3)]" />
              )}
            </button>
          );
        })}
      </div>

      <ProgressiveUnlockBanners course={course} />

      <div className="flex-1 overflow-y-auto">
        {activePanel === 'notes' && (
          <div className="max-w-[760px] mx-auto px-4 pt-6 pb-40 select-text">
            <BlockNoteInner key={editorKey} blocks={initialBlocks} isDark={isDark} />
          </div>
        )}
        {activePanel === 'concepts' && (
          <div className="max-w-[960px] mx-auto px-6 pt-6 pb-40 select-text">
            <ConceptsPanel courseId={course.id} onJumpToLecture={handleJumpToLecture} />
          </div>
        )}
        {activePanel === 'exam' && (
          <div className="max-w-[760px] mx-auto px-4 pt-6 pb-40 select-text">
            <ExamGuidePanel course={course} />
          </div>
        )}
      </div>
    </div>
  );
}

function BlockNoteInner({ blocks, isDark }: { blocks: any[]; isDark: boolean }) {
  const editor = useCreateBlockNote({ schema: courseSchema, initialContent: blocks });
  return (
    <MantineProvider forceColorScheme={isDark ? 'dark' : 'light'}>
      <div className="prose dark:prose-invert max-w-none">
        <BlockNoteView editor={editor} theme={isDark ? 'dark' : 'light'} />
      </div>
    </MantineProvider>
  );
}

// --- Progressive unlock banners --------------------------------------------

function ProgressiveUnlockBanners({ course }: { course: CourseWithLectures }) {
  const messages: { icon: React.ReactNode; text: string; tone: 'info' | 'warn' }[] = [];

  if (course.status !== 'complete') {
    messages.push({
      icon: <Lock size={12} />,
      text: 'Syllabus auto-unlocks when all lectures finish processing.',
      tone: 'info',
    });
  }
  if (course.processed_videos < 5) {
    messages.push({
      icon: <Lock size={12} />,
      text: `Course AI unlocks after 5 processed lectures (${course.processed_videos}/5).`,
      tone: 'info',
    });
  }
  if (course.status !== 'complete') {
    messages.push({
      icon: <Lock size={12} />,
      text: 'Exam guide unlocks when all lectures are processed.',
      tone: 'info',
    });
  }

  if (messages.length === 0) return null;

  return (
    <div className="px-6 py-2.5 border-b border-[var(--border)] bg-[var(--brand-500)]/[0.04] flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[11.5px] text-[var(--text-2)]">
      {messages.map((m, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          <span className="text-[var(--brand-500)]">{m.icon}</span>
          {m.text}
        </span>
      ))}
    </div>
  );
}

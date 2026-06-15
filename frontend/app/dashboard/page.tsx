"use client";

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { 
  Play, 
  Plus, 
  Search, 
  Camera, 
  Folder, 
  ChevronDown, 
  Grid, 
  List, 
  MessageSquare, 
  Layers, 
  RefreshCw, 
  FileText, 
  Settings, 
  Sparkles, 
  Clock, 
  ArrowLeft, 
  Check, 
  ExternalLink,
  ChevronLeft,
  X,
  Crown,
  ChevronRight,
  Sun,
  Moon,
  Info,
  BookOpen,
  Download
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Sidebar } from '@/components/layout/sidebar';
import { ClassificationBadge } from '@/components/notes/classification-badge';
import { NotesHeader } from '@/components/notes/notes-header';
import { NotesSummary } from '@/components/notes/notes-summary';
import { NotesSection } from '@/components/notes/notes-section';
import { NewVideoModal, ProcessingModal, UpgradeModal } from '@/components/notes/modals';
import { getNotes, startAnalysis, listJobs, getCurrentUser, listFolders, createFolder, searchVideos, listCourses, getCourse, getJobStatus, type CurrentUser, type FolderItem, type SearchResult } from '@/lib/api';
import type { Course, CourseWithLectures, JobStatus } from '@/lib/types';
import { PlaylistModal } from '@/components/courses/playlist-modal';
import { CourseOverview } from '@/components/courses/course-overview';
import { getSupabaseClient } from '@/lib/supabase';
import { VideoNotes, JobListItem } from '@/lib/types';

// Dynamically import BlockNote Editor (Client-only, no SSR)
const NotesEditor = dynamic(
  () => import('@/components/notes/notes-editor').then((mod) => mod.NotesEditor),
  { 
    ssr: false,
    loading: () => (
      <div className="flex flex-col items-center justify-center p-16 space-y-4">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--brand-500)]" />
        <p className="text-[var(--text-3)] text-sm animate-pulse">Initializing Pupil editor...</p>
      </div>
    )
  }
);

// Loader helper
function Loader2({ className, ...props }: React.ComponentProps<'svg'>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("animate-spin", className)}
      {...props}
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

// Compare two slim list-shaped courses for the fields the dashboard actually
// renders / polls on. Used to avoid replacing a course object (and the whole
// `courses` array) on an 8s poll tick when nothing observable changed — which
// would otherwise re-render the tree and re-trigger the lecture backfill.
function shallowEqualCourse(a: Course, b: Course): boolean {
  return (
    a.id === b.id &&
    a.title === b.title &&
    a.status === b.status &&
    a.total_videos === b.total_videos &&
    a.processed_videos === b.processed_videos &&
    a.description === b.description &&
    a.thumbnail_url === b.thumbnail_url &&
    a.updated_at === b.updated_at
  );
}

// ─── PFrame Component for beautiful background representation ─────────────────

const frameGradients: Record<string, string> = {
  slide:       'radial-gradient(ellipse at 30% 20%, #1e3a8a 0%, #0f172a 60%)',
  whiteboard:  'linear-gradient(135deg, #14532d 0%, #052e16 100%)',
  code:        'linear-gradient(135deg, #1e1b4b 0%, #0a0a18 100%)',
  person:      'linear-gradient(160deg, #4c1d95 0%, #1e1b4b 100%)',
  plot:        'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)',
  diagram:     'linear-gradient(160deg, #1f2937 0%, #111827 100%)',
  transformer: 'linear-gradient(135deg, #312e81 0%, #1e1b4b 100%)',
  softmax:     'linear-gradient(160deg, #064e3b 0%, #022c22 100%)',
};

function PFrame({ 
  variant = 'slide', 
  children,
  className
}: { 
  variant?: string; 
  children?: React.ReactNode;
  className?: string;
}) {
  const bg = frameGradients[variant] || frameGradients.slide;
  return (
    <div 
      className={cn("relative w-full h-full rounded-lg overflow-hidden border border-[var(--border)]", className)}
      style={{ background: bg }}
    >
      {children}
    </div>
  );
}

// ─── Main Suspense Wrapper ───────────────────────────────────────────────────

export default function Dashboard() {
  return (
    <React.Suspense fallback={
      <div className="min-h-screen bg-[#FAFAF9] dark:bg-[#0F0F10] flex flex-col items-center justify-center space-y-4">
        <Loader2 className="w-10 h-10 animate-spin text-[#37352F] dark:text-[#EDEDEF]" />
        <p className="text-zinc-500 text-sm animate-pulse">Entering Pupil Workspace...</p>
      </div>
    }>
      <DashboardContent />
    </React.Suspense>
  );
}

// ─── Inner Dashboard Layout ──────────────────────────────────────────────────

function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Route State
  const activeView = searchParams.get('page') || 'library';
  const activeJobId = searchParams.get('jobId') || searchParams.get('videoId') || null;

  // Sidebar Layout State
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const [isPro, setIsPro] = React.useState(false);

  // Modal States
  const [activeModal, setActiveModal] = React.useState<'new-video' | 'processing' | 'upgrade' | 'new-course' | null>(null);
  const [modalJobId, setModalJobId] = React.useState<string>('');
  const [prefilledUrl, setPrefilledUrl] = React.useState<string>('');

  // Jobs State
  const [jobs, setJobs] = React.useState<JobListItem[]>([]);
  const [loadingJobs, setLoadingJobs] = React.useState(true);

  // Track network online/offline so we can show a banner during blips.
  // Always initialise to `true` so SSR and client first-render agree
  // (avoids a React hydration mismatch). The real value is read in the
  // effect below, after mount.
  const [online, setOnline] = React.useState<boolean>(true);
  React.useEffect(() => {
    setOnline(navigator.onLine);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  // Current user state (from Supabase + backend /api/user)
  const [currentUser, setCurrentUser] = React.useState<CurrentUser | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    getCurrentUser()
      .then((u) => { if (!cancelled) setCurrentUser(u); })
      .catch((e) => console.error('Failed to load current user:', e));
    return () => { cancelled = true; };
  }, []);

  const handleSignOut = React.useCallback(async () => {
    try {
      await getSupabaseClient().auth.signOut();
    } finally {
      router.replace('/login');
    }
  }, [router]);

  // Notes View State
  const [activeNotes, setActiveNotes] = React.useState<VideoNotes | null>(null);
  // Initialise to `true` when the page is hard-loaded directly onto a notes
  // deep-link (?page=notes&jobId=...). The effect that flips loadingNotes true
  // only runs AFTER mount, so without this lazy initial value the first paint
  // would briefly render the "Failed to load notes" error branch (notes=null
  // + loading=false) before the fetch even starts. Mirrors the same
  // activeView==='notes' && activeJobId condition the fetch effect uses.
  const [loadingNotes, setLoadingNotes] = React.useState<boolean>(
    () => activeView === 'notes' && !!activeJobId
  );
  const [notesError, setNotesError] = React.useState<string | null>(null);
  const [showChatPanel, setShowChatPanel] = React.useState(false);

  // Workspace state: folders + search
  const [folders, setFolders] = React.useState<FolderItem[]>([]);
  const [foldersLoaded, setFoldersLoaded] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState<string>('');
  const [searchResults, setSearchResults] = React.useState<SearchResult[] | null>(null);
  const [searchLoading, setSearchLoading] = React.useState(false);

  const fetchFolders = React.useCallback(async () => {
    try {
      const list = await listFolders();
      setFolders(list);
      // Only flip out of skeleton state on success — a transient failure
      // would otherwise flash "No folders yet" before the next poll lands.
      setFoldersLoaded(true);
    } catch (err) {
      console.error('Failed to load folders:', err);
    }
  }, []);

  React.useEffect(() => { fetchFolders(); }, [fetchFolders]);

  // Courses — list + per-course lecture lazy-load on expand.
  const [courses, setCourses] = React.useState<Course[]>([]);
  const [courseLectures, setCourseLectures] = React.useState<Record<string, CourseWithLectures>>({});

  const fetchCourses = React.useCallback(async () => {
    try {
      const list = await listCourses();
      // The 8s poll fires constantly. If we blindly replaced `courses` every
      // tick we'd hand React a brand-new array reference even when nothing
      // changed — re-rendering the large dashboard tree and (via the backfill
      // effect below, which depends on `courses`) re-running per-course work.
      // So only commit new state when the list actually differs, and when it
      // does, reuse the previous element object for any unchanged course so
      // its identity is stable for memoized children.
      setCourses((prev) => {
        if (prev.length === list.length) {
          const prevById = new Map(prev.map((c) => [c.id, c]));
          let changed = false;
          const merged = list.map((next) => {
            const old = prevById.get(next.id);
            if (old && shallowEqualCourse(old, next)) return old; // keep stable ref
            changed = true;
            return next;
          });
          return changed ? merged : prev; // no diff → keep old array ref (no re-render)
        }
        return list;
      });
    } catch (err) {
      console.error('Failed to load courses:', err);
    }
  }, []);

  React.useEffect(() => {
    fetchCourses();
    // Keep the list fresh so processing progress trickles into the sidebar.
    const interval = setInterval(fetchCourses, 8000);
    return () => clearInterval(interval);
  }, [fetchCourses]);

  // Lazily backfill lectures for any course we don't have yet, so the lecture
  // page can render its course breadcrumb + prev/next without the user first
  // expanding the course in the sidebar.
  //
  // This fires only for courses that are actually MISSING their detail. Once a
  // course is fetched it lives in `courseLectures` forever, so it's never
  // re-fetched. The `inFlight` ref guards against a second tick firing a
  // duplicate `getCourse` for the same id before the first resolves. Combined
  // with the dedup in `fetchCourses` (stable array ref when nothing changed),
  // an idle 8s poll no longer re-runs this effect at all — and even if it does
  // (e.g. a real list change), already-detailed courses are skipped.
  const backfillInFlightRef = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    courses.forEach((c) => {
      if (courseLectures[c.id] || backfillInFlightRef.current.has(c.id)) return;
      backfillInFlightRef.current.add(c.id);
      getCourse(c.id)
        .then((full) => setCourseLectures((prev) => ({ ...prev, [c.id]: full })))
        .catch(() => { /* best-effort */ })
        .finally(() => { backfillInFlightRef.current.delete(c.id); });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courses]);

  const loadCourseLectures = React.useCallback(async (courseId: string) => {
    try {
      const full = await getCourse(courseId);
      setCourseLectures((prev) => ({ ...prev, [courseId]: full }));
    } catch (err) {
      console.error('Failed to load course lectures:', err);
    }
  }, []);

  // Derive the sidebar-shaped course list (with lectures when available).
  const sidebarCourses = React.useMemo(() => {
    return courses.map((c) => {
      const full = courseLectures[c.id];
      return {
        id: c.id,
        title: c.title,
        status: c.status,
        total_videos: c.total_videos,
        processed_videos: c.processed_videos,
        lectures: full?.lectures.map((l) => ({
          job_id: l.job_id,
          lecture_number: l.lecture_number,
          title: l.title,
          status: l.status,
        })),
      };
    });
  }, [courses, courseLectures]);

  // Pick up ?q= (+ optional scope/courseId) from the URL so deep links resume the search.
  React.useEffect(() => {
    const q = searchParams.get('q');
    const scope = (searchParams.get('scope') as 'all' | 'course' | null) || 'all';
    const courseId = searchParams.get('courseId') || undefined;
    if (q && q !== searchQuery) {
      setSearchQuery(q);
      setSearchLoading(true);
      setSearchResults(null);
      searchVideos(q, { scope, courseId })
        .then((res) => setSearchResults(res.results))
        .catch(() => setSearchResults([]))
        .finally(() => setSearchLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const handleCreateFolder = React.useCallback(async () => {
    const name = window.prompt('Folder name')?.trim();
    if (!name) return;
    try {
      await createFolder(name);
      await fetchFolders();
    } catch (err) {
      alert('Failed to create folder');
      console.error(err);
    }
  }, [fetchFolders]);

  const handleSearch = React.useCallback(async (
    q: string,
    opts?: { scope?: 'all' | 'course'; courseId?: string },
  ) => {
    setSearchQuery(q);
    setSearchLoading(true);
    setSearchResults(null);
    const params = new URLSearchParams({ page: 'search', q });
    if (opts?.scope) params.set('scope', opts.scope);
    if (opts?.courseId) params.set('courseId', opts.courseId);
    router.push(`/dashboard?${params.toString()}`);
    try {
      const res = await searchVideos(q, opts);
      setSearchResults(res.results);
    } catch (err) {
      console.error('Search failed:', err);
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, [router]);

  const clearSearch = React.useCallback(() => {
    setSearchQuery('');
    setSearchResults(null);
    router.push('/dashboard?page=library');
  }, [router]);

  const handleToggleTheme = React.useCallback(() => {
    const root = document.documentElement;
    const isDarkNow = root.classList.toggle('dark');
    try { localStorage.setItem('pupil_theme', isDarkNow ? 'dark' : 'light'); } catch {}
  }, []);

  // Track jobs that transition processing→complete so we can show a toast.
  const prevJobsRef = React.useRef<Map<string, string>>(new Map());
  const [toast, setToast] = React.useState<{
    jobId: string;
    title: string;
  } | null>(null);

  // 1. Fetch library items (Jobs)
  const fetchJobs = React.useCallback(async () => {
    try {
      const allJobs = await listJobs();
      // Detect status transitions to 'complete' so we can surface a toast.
      const prev = prevJobsRef.current;
      let newlyComplete: JobListItem | null = null;
      for (const j of allJobs) {
        const wasStatus = prev.get(j.id);
        if (wasStatus && wasStatus !== 'complete' && j.status === 'complete') {
          newlyComplete = j;
        }
      }
      prevJobsRef.current = new Map(allJobs.map((j) => [j.id, j.status]));
      setJobs(allJobs);
      // Only flip out of the loading state once we've successfully fetched
      // at least once. Transient failures (which the api client already
      // retries once) must NOT trip the empty-state UI.
      setLoadingJobs(false);
      if (newlyComplete) {
        setToast({
          jobId: newlyComplete.id,
          title: newlyComplete.title || 'Your notes',
        });
      }
    } catch (err) {
      console.error('Failed to load jobs list:', err);
      // Deliberately do NOT flip loadingJobs here — keeping the skeleton
      // visible is much better than flashing "Library is empty".
    }
  }, []);

  // Auto-dismiss the completion toast after 8 seconds.
  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);

  React.useEffect(() => {
    fetchJobs();

    // Background polling for library list updates (e.g. jobs completing in background)
    const interval = setInterval(fetchJobs, 6000);
    return () => clearInterval(interval);
  }, [fetchJobs]);

  // 2. Fetch specific notes when jobId changes.
  // Flip into the loading state SYNCHRONOUSLY (before the async fetch fires)
  // so the NotesView doesn't briefly render its "not found" branch with the
  // stale notes=null + loading=false state between effect commit and the
  // first setState inside the async function.
  React.useEffect(() => {
    if (activeView === 'notes' && activeJobId) {
      let isMounted = true;
      setLoadingNotes(true);
      setNotesError(null);
      setActiveNotes(null);
      (async () => {
        try {
          const data = await getNotes(activeJobId);
          if (!isMounted) return;
          setActiveNotes(data);
        } catch (err) {
          if (isMounted) {
            setNotesError(err instanceof Error ? err.message : 'Failed to fetch notes');
            setActiveNotes(null);
          }
        } finally {
          if (isMounted) setLoadingNotes(false);
        }
      })();
      return () => {
        isMounted = false;
      };
    } else {
      setActiveNotes(null);
    }
  }, [activeView, activeJobId]);

  // Handle client-side routing
  const navigateTo = (view: string, params?: Record<string, string>) => {
    const urlParams = new URLSearchParams();
    urlParams.set('page', view);
    if (params) {
      Object.entries(params).forEach(([key, val]) => {
        urlParams.set(key, val);
      });
    }
    router.push(`/dashboard?${urlParams.toString()}`);
  };

  // Keyboard shortcut CMD+K / CTRL+K to open Search view
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        navigateTo('search');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [router]);

  // Check for newVideoUrl redirect from Landing page
  React.useEffect(() => {
    const newVideoUrl = searchParams.get('newVideoUrl');
    if (newVideoUrl) {
      setPrefilledUrl(newVideoUrl);
      setActiveModal('new-video');
      
      // Clean query params
      const params = new URLSearchParams(searchParams.toString());
      params.delete('newVideoUrl');
      router.replace(`/dashboard?${params.toString()}`);
    }
  }, [searchParams, router]);

  // Handle starting a new video analysis job
  const handleStartJob = async (url: string, folderId: string | null) => {
    const res = await startAnalysis(url);

    // If the user picked a folder, move the new job into it server-side.
    if (folderId) {
      try {
        const { moveJobToFolder } = await import('@/lib/api');
        await moveJobToFolder(res.job_id, folderId);
      } catch (err) {
        console.error('Failed to move new job into folder:', err);
      }
    }

    await fetchJobs();
    setActiveModal(null);
    setModalJobId(res.job_id);
    setActiveModal('processing');
  };

  return (
    <div className="flex h-screen w-full bg-[var(--bg)] text-[var(--text-1)] select-none overflow-hidden font-sans print:h-auto print:overflow-visible">
      
      {/* PERSISTENT COLLAPSIBLE SIDEBAR */}
      <Sidebar
        activeView={activeView}
        activeJobId={activeJobId}
        activeCourseId={searchParams.get('courseId')}
        onNav={navigateTo}
        onNewVideo={() => setActiveModal('new-video')}
        onNewCourse={() => setActiveModal('new-course')}
        collapsed={sidebarCollapsed}
        setCollapsed={setSidebarCollapsed}
        jobs={jobs}
        isPro={isPro}
        currentUser={currentUser}
        onSignOut={handleSignOut}
        folders={folders}
        foldersLoaded={foldersLoaded}
        courses={sidebarCourses}
        onLoadCourseLectures={loadCourseLectures}
        onCreateFolder={handleCreateFolder}
        onSearch={handleSearch}
        searchDefaultScope={activeView === 'course' && searchParams.get('courseId') ? 'course' : 'all'}
        searchDefaultCourseId={activeView === 'course' ? searchParams.get('courseId') : null}
        searchDefaultCourseTitle={
          activeView === 'course'
            ? courses.find((c) => c.id === searchParams.get('courseId'))?.title || null
            : null
        }
        onToggleTheme={handleToggleTheme}
        onOpenProcessing={(id) => {
          setModalJobId(id);
          setActiveModal('processing');
        }}
      />

      {/* MAIN VIEW CONTENT AREA */}
      <main className="flex-1 min-w-0 flex flex-col relative bg-[var(--bg)] print:hidden">
        
        {/* Main Content Router */}
        <div className="flex-1 overflow-y-auto min-w-0 relative">
          {(activeView === 'library' || activeView === 'recent') && (
            <LibraryView
              jobs={jobs}
              folders={folders}
              recentOnly={activeView === 'recent'}
              loadingJobs={loadingJobs}
              onNav={navigateTo}
              onNewVideo={() => setActiveModal('new-video')}
              onOpenProcessing={(id) => {
                setModalJobId(id);
                setActiveModal('processing');
              }}
            />
          )}

          {activeView === 'notes' && (() => {
            // Find which course (if any) this lecture belongs to, plus the
            // adjacent lectures for prev/next navigation.
            let courseContext: {
              courseId: string;
              courseTitle: string;
              lectureNumber: number;
              prev: { jobId: string; title: string; number: number } | null;
              next: { jobId: string; title: string; number: number } | null;
            } | null = null;
            for (const c of Object.values(courseLectures)) {
              const idx = c.lectures.findIndex((l) => l.job_id === activeJobId);
              if (idx >= 0) {
                const here = c.lectures[idx];
                const prev = c.lectures[idx - 1];
                const next = c.lectures[idx + 1];
                courseContext = {
                  courseId: c.id,
                  courseTitle: c.title,
                  lectureNumber: here.lecture_number,
                  prev: prev ? { jobId: prev.job_id, title: prev.title, number: prev.lecture_number } : null,
                  next: next ? { jobId: next.job_id, title: next.title, number: next.lecture_number } : null,
                };
                break;
              }
            }
            return (
              <NotesView
                notes={activeNotes}
                loading={loadingNotes}
                error={notesError}
                jobId={activeJobId}
                onNav={navigateTo}
                showChat={showChatPanel}
                onShowChat={() => setShowChatPanel(!showChatPanel)}
                courseContext={courseContext}
              />
            );
          })()}

          {activeView === 'search' && (
            <SearchView
              onNav={navigateTo}
              query={searchQuery}
              results={searchResults}
              loading={searchLoading}
              onSearch={handleSearch}
              onClear={clearSearch}
              courses={courses}
              scope={(searchParams.get('scope') as 'all' | 'course' | null) || 'all'}
              scopeCourseId={searchParams.get('courseId')}
            />
          )}

          {activeView === 'concepts' && (
            <ConceptsView />
          )}

          {activeView === 'course' && (
            <CourseView
              courseId={searchParams.get('courseId') || ''}
              onNav={navigateTo}
            />
          )}

          {activeView === 'resurfacing' && (
            <ResurfacingView />
          )}

          {activeView === 'chat' && (
            <ChatView />
          )}

          {activeView === 'settings' && (
            <SettingsView isPro={isPro} setIsPro={setIsPro} />
          )}
        </div>

        {/* Global Floating Light/Dark Mode Switcher */}
        <button
          onClick={() => {
            const body = document.documentElement;
            const isDarkNow = body.classList.toggle('dark');
            localStorage.setItem('pupil_theme', isDarkNow ? 'dark' : 'light');
          }}
          className="absolute top-4 right-5 z-30 w-8.5 h-8.5 rounded-full border border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-2)] hover:text-[var(--text-1)] flex items-center justify-center shadow-sm backdrop-blur-md cursor-pointer hover:bg-[var(--hover)] transition-all"
          title="Toggle color theme"
        >
          <Sun size={15} className="dark:hidden block text-amber-500 fill-amber-500" />
          <Moon size={15} className="hidden dark:block text-slate-400" />
        </button>
      </main>

      {/* OVERLAY MODALS */}
      <NewVideoModal
        isOpen={activeModal === 'new-video'}
        onClose={() => {
          setActiveModal(null);
          setPrefilledUrl('');
        }}
        onStart={handleStartJob}
        initialUrl={prefilledUrl}
        folders={folders}
        onProcessAsCourse={(url) => {
          setPrefilledUrl(url);
          setActiveModal('new-course');
        }}
      />

      {/* Offline banner — only render when the browser reports offline so
          there's a single source of truth that something is wrong. */}
      {!online && (
        <div
          className="fixed top-3 left-1/2 -translate-x-1/2 z-[130] bg-amber-500/95 text-black text-[12.5px] font-semibold px-3.5 py-1.5 rounded-full shadow-lg flex items-center gap-2"
          role="status"
        >
          <span className="inline-block w-2 h-2 rounded-full bg-black/60 animate-pulse" />
          You're offline. Pupil will reconnect automatically.
        </div>
      )}

      {/* Completion toast — fires when a previously-processing job flips to complete */}
      {toast && (
        <div
          className="fixed bottom-6 right-6 z-[120] max-w-sm bg-[var(--surface-1)] border border-[var(--brand-500)]/30 rounded-xl shadow-2xl p-4 flex items-start gap-3 animate-[pupil-fade_0.2s_ease]"
          role="status"
        >
          <div className="shrink-0 w-9 h-9 rounded-full bg-emerald-500/12 text-emerald-500 flex items-center justify-center">
            <Check size={17} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-[var(--text-1)]">Notes ready</div>
            <div className="text-[11.5px] text-[var(--text-2)] truncate mt-0.5" title={toast.title}>
              {toast.title}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={() => {
                  navigateTo('notes', { jobId: toast.jobId });
                  setToast(null);
                }}
                className="py-1 px-2.5 bg-[var(--brand-500)] hover:bg-[var(--brand-600)] text-white text-[11.5px] font-semibold rounded-md border-none cursor-pointer"
              >
                Open notes
              </button>
              <button
                onClick={() => setToast(null)}
                className="py-1 px-2 bg-transparent text-[var(--text-3)] hover:text-[var(--text-1)] text-[11.5px] font-semibold rounded-md border-none cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      <PlaylistModal
        isOpen={activeModal === 'new-course'}
        initialUrl={prefilledUrl}
        onClose={() => {
          setActiveModal(null);
          setPrefilledUrl('');
        }}
        onCreated={(courseId) => {
          fetchCourses();
          loadCourseLectures(courseId);
          navigateTo('course', { courseId });
        }}
      />

      <ProcessingModal 
        isOpen={activeModal === 'processing'} 
        jobId={modalJobId} 
        onClose={() => setActiveModal(null)}
        onDone={() => {
          setActiveModal(null);
          navigateTo('notes', { jobId: modalJobId });
        }}
      />

      <UpgradeModal 
        isOpen={activeModal === 'upgrade'} 
        onClose={() => setActiveModal(null)}
        onUpgrade={() => {
          setIsPro(true);
          setActiveModal(null);
        }}
      />

      {/* PRINT-ONLY CLEAN NOTES VIEW (matching the previous UI styling) */}
      {activeView === 'notes' && activeNotes && (
        <div className="hidden print:block print:w-full bg-[var(--bg)] text-[var(--text-1)] min-h-screen select-text">
          <NotesHeader notes={activeNotes} />
          <article className="max-w-[720px] mx-auto px-8 w-full">
            <NotesSummary summary={activeNotes.summary} topics={activeNotes.topics} />
            <div className="mt-4 space-y-0">
              {(activeNotes.sections ?? []).map((section) => (
                <NotesSection
                  key={section.number}
                  section={section}
                  videoId={activeNotes.video.youtube_id}
                />
              ))}
            </div>
          </article>
        </div>
      )}
    </div>
  );
}

// ─── 1. LIBRARY VIEW SCREEN ──────────────────────────────────────────────────

function LibraryView({
  jobs,
  folders,
  recentOnly,
  loadingJobs,
  onNav,
  onNewVideo,
  onOpenProcessing
}: {
  jobs: JobListItem[];
  folders: FolderItem[];
  recentOnly?: boolean;
  loadingJobs: boolean;
  onNav: (v: string, params?: any) => void;
  onNewVideo: () => void;
  onOpenProcessing: (id: string) => void;
}) {
  const [viewType, setViewType] = React.useState<'grid' | 'list'>('grid');
  const [folderFilter, setFolderFilter] = React.useState<string>('All folders');
  const [searchTerm, setSearchTerm] = React.useState('');
  const [sortMode, setSortMode] = React.useState<'recently_processed' | 'recently_added' | 'alphabetical'>('recently_processed');

  // Folder id -> name (so we can render the chip on each card)
  const folderNameById = React.useMemo(() => {
    const m: Record<string, string> = {};
    folders.forEach(f => { m[f.id] = f.name; });
    return m;
  }, [folders]);

  // Filter & Search computation
  const filteredJobs = React.useMemo(() => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const filtered = jobs.filter((job: any) => {
      if (recentOnly) {
        const t = job.completed_at || job.created_at;
        if (!t || new Date(t).getTime() < sevenDaysAgo) return false;
      }
      if (folderFilter !== 'All folders') {
        const name = job.folder_id ? folderNameById[job.folder_id] : null;
        if (folderFilter === 'Unfiled' && job.folder_id) return false;
        if (folderFilter !== 'Unfiled' && name !== folderFilter) return false;
      }
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        const titleMatch = job.title.toLowerCase().includes(query);
        const channelMatch = (job.channel || '').toLowerCase().includes(query);
        return titleMatch || channelMatch;
      }
      return true;
    });

    const ts = (j: any, key: 'completed_at' | 'created_at') =>
      j[key] ? new Date(j[key]).getTime() : 0;

    const sorted = [...filtered];
    if (sortMode === 'recently_processed') {
      sorted.sort((a, b) => (ts(b, 'completed_at') || ts(b, 'created_at')) - (ts(a, 'completed_at') || ts(a, 'created_at')));
    } else if (sortMode === 'recently_added') {
      sorted.sort((a, b) => ts(b, 'created_at') - ts(a, 'created_at'));
    } else {
      sorted.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    }
    return sorted;
  }, [jobs, folderFilter, searchTerm, recentOnly, folderNameById, sortMode]);

  const isEmpty = !loadingJobs && filteredJobs.length === 0 && jobs.length === 0;
  const showSkeleton = loadingJobs && jobs.length === 0;

  return (
    <div className="max-w-[1200px] mx-auto px-10 py-10 pb-20 select-none animate-[pupil-fade_0.22s_ease]">
      {/* Header */}
      <div className="flex justify-between items-baseline mb-6 border-b border-[var(--border)] pb-4">
        <div>
          <div className="text-[11px] text-[var(--text-3)] font-semibold tracking-wider uppercase mb-1">
            Workspace Library
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-[var(--text-1)]">{recentOnly ? 'Recent' : 'All videos'}</h1>
        </div>
        <div className="text-[13px] text-[var(--text-2)]">
          {jobs.filter(j => j.status === 'complete').length} notes ready · {jobs.length} total
        </div>
      </div>

      {showSkeleton ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="bg-[var(--surface-1)] border border-[var(--border)] rounded-xl overflow-hidden animate-pulse"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <div className="aspect-[16/9] bg-[var(--surface-2)]" />
              <div className="p-4 space-y-2.5">
                <div className="h-3.5 bg-[var(--surface-2)] rounded w-[85%]" />
                <div className="h-3 bg-[var(--surface-2)] rounded w-[55%]" />
                <div className="h-2 bg-[var(--surface-2)] rounded w-[30%] mt-3" />
              </div>
            </div>
          ))}
        </div>
      ) : isEmpty ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-24 h-24 rounded-full bg-[var(--surface-2)] flex items-center justify-center mb-6">
            <BookOpen size={40} className="text-[var(--brand-500)]" />
          </div>
          <h2 className="text-xl font-bold mb-2">Your video library is empty</h2>
          <p className="text-[14px] text-[var(--text-2)] max-w-sm mx-auto mb-6 leading-relaxed">
            Paste a YouTube URL to get started — Pupil will extract equations, code, and diagrams from the video.
          </p>
          <button
            onClick={onNewVideo}
            className="flex items-center gap-1.5 py-2 px-4 bg-[var(--brand-500)] hover:bg-[var(--brand-600)] text-white font-medium text-[13.5px] rounded-lg shadow transition-colors cursor-pointer border-none"
          >
            <Plus size={14} /> Add Video
          </button>
        </div>
      ) : (
        <>
          {/* Library Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
            {/* Folder Filters */}
            <div className="flex gap-1.5 overflow-x-auto py-0.5">
              {['All folders', ...folders.map(f => f.name), 'Unfiled'].map(f => (
                <button
                  key={f}
                  onClick={() => setFolderFilter(f)}
                  className={cn(
                    "py-1 px-3 rounded-full text-xs font-semibold select-none cursor-pointer border transition-colors",
                    f === folderFilter
                      ? "bg-[var(--brand-500)] text-white border-[var(--brand-500)] shadow-sm"
                      : "bg-[var(--surface-1)] text-[var(--text-2)] hover:text-[var(--text-1)] border-[var(--border)]"
                  )}
                >
                  {f}
                </button>
              ))}
            </div>

            {/* Sort, view type & text filter */}
            <div className="flex items-center gap-3 w-full sm:w-auto mt-2 sm:mt-0">
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as any)}
                className="text-xs py-1 px-2 bg-[var(--surface-2)] border border-[var(--border)] rounded-lg text-[var(--text-1)] outline-none cursor-pointer"
              >
                <option value="recently_processed">Recently processed</option>
                <option value="recently_added">Recently added</option>
                <option value="alphabetical">Alphabetical</option>
              </select>
              <div className="flex items-center gap-2 px-2.5 py-1 bg-[var(--surface-2)] border border-[var(--border)] rounded-lg w-full sm:w-48">
                <Search size={13} className="text-[var(--text-3)]" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Filter by title..."
                  className="flex-1 bg-transparent border-none outline-none text-xs text-[var(--text-1)] placeholder-[var(--text-3)]"
                />
              </div>

              <div className="flex p-0.5 bg-[var(--surface-2)] border border-[var(--border)] rounded-lg shrink-0">
                <button 
                  onClick={() => setViewType('grid')} 
                  className={cn(
                    "p-1 rounded-md cursor-pointer border-none",
                    viewType === 'grid' ? "bg-[var(--surface-1)] shadow-sm text-[var(--text-1)]" : "text-[var(--text-3)] hover:text-[var(--text-2)]"
                  )}
                >
                  <Grid size={14} />
                </button>
                <button 
                  onClick={() => setViewType('list')} 
                  className={cn(
                    "p-1 rounded-md cursor-pointer border-none",
                    viewType === 'list' ? "bg-[var(--surface-1)] shadow-sm text-[var(--text-1)]" : "text-[var(--text-3)] hover:text-[var(--text-2)]"
                  )}
                >
                  <List size={14} />
                </button>
              </div>
            </div>
          </div>

          {/* Cards Grid or List */}
          {viewType === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {filteredJobs.map((job) => (
                <div 
                  key={job.id}
                  onClick={() => {
                    if (job.status === 'complete') {
                      onNav('notes', { jobId: job.id });
                    } else if (job.status === 'error') {
                      alert('Job failed: ' + (job.error_message || 'Unknown error'));
                    } else {
                      onOpenProcessing(job.id);
                    }
                  }}
                  className={cn(
                    "group bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden shadow-sm flex flex-col text-left transition-all duration-200 select-none",
                    job.status === 'complete' ? "cursor-pointer hover:-translate-y-0.5 hover:shadow-md hover:border-[var(--border-strong)]" : "cursor-default"
                  )}
                >
                  {/* Thumbnail area */}
                  <div className="relative aspect-[16/9] w-full shrink-0 bg-zinc-800">
                    {job.thumbnail_url ? (
                      <img 
                        src={job.thumbnail_url} 
                        alt="" 
                        className={cn("w-full h-full object-cover", job.status !== 'complete' && "opacity-40 saturate-50")}
                      />
                    ) : (
                      <div className="w-full h-full" style={{ background: frameGradients.slide }} />
                    )}

                    {/* Channel name pill */}
                    <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 px-2 py-0.5 bg-black/65 backdrop-blur-sm rounded-full text-[10px] text-white select-none">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="#FF0000" className="block"><path d="M23.498 6.163a3.003 3.003 0 0 0-2.11-2.107C19.518 3.545 12 3.545 12 3.545s-7.518 0-9.388.511a3.002 3.002 0 0 0-2.11 2.107C0 8.033 0 12 0 12s0 3.967.502 5.837a3.003 3.003 0 0 0 2.11 2.107c1.87.511 9.388.511 9.388.511s7.518 0 9.388-.511a3.002 3.002 0 0 0 2.11-2.107c.502-1.87.502-5.837.502-5.837s0-3.967-.502-5.837zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
                      <span className="truncate max-w-[100px]">{job.channel || 'Video'}</span>
                    </div>

                    {/* Duration badge */}
                    {job.duration_seconds && (() => {
                      const totalSec = Math.round(job.duration_seconds);
                      return (
                        <div className="absolute bottom-2.5 right-2.5 px-1.5 py-0.5 bg-black/70 backdrop-blur-sm rounded text-[9.5px] font-mono text-white select-none">
                          {Math.floor(totalSec / 60)}:{(totalSec % 60).toString().padStart(2, '0')}
                        </div>
                      );
                    })()}

                    {/* In Progress Overlay */}
                    {job.status !== 'complete' && job.status !== 'error' && (
                      <div className="absolute inset-0 bg-black/55 flex flex-col items-center justify-center p-4 text-white gap-2 select-none">
                        <div className="flex items-center gap-1.5 text-xs font-semibold">
                          <Loader2 width={13} height={13} className="animate-spin text-white" />
                          <span>{job.status === 'queued' ? 'Queued' : `Processing · ${Math.round(job.progress)}%`}</span>
                        </div>
                        <div className="w-2/3 h-1 bg-white/20 rounded-full overflow-hidden">
                          <div className="h-full bg-[var(--brand-500)] rounded-full transition-all duration-300" style={{ width: `${job.progress}%` }} />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Details Area */}
                  <div className="p-4 flex-1 flex flex-col justify-between">
                    <div>
                      <h3 className="font-semibold text-[13.5px] text-[var(--text-1)] group-hover:text-[var(--brand-500)] transition-colors leading-snug line-clamp-2">
                        {job.title}
                      </h3>
                    </div>

                    <div className="flex items-center justify-between mt-3 text-[11px] text-[var(--text-3)] font-medium">
                      <div className="flex items-center gap-1 shrink-0">
                        {job.folder_id && folderNameById[job.folder_id] ? (
                          <>
                            <Folder size={11} className="text-[var(--brand-400)]" />
                            <span>{folderNameById[job.folder_id]}</span>
                          </>
                        ) : (
                          <span>Unfiled</span>
                        )}
                        <span>·</span>
                        <span>{new Date(job.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                      </div>

                      {job.status === 'complete' && (
                        <span className="text-[10px] bg-[var(--surface-2)] text-[var(--text-2)] px-2 py-0.5 rounded-full select-none">
                          Notes Ready
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            // List view representation
            <div className="bg-[var(--surface-1)] border border-[var(--border)] rounded-xl overflow-hidden shadow-sm flex flex-col divide-y divide-[var(--border)]">
              {filteredJobs.map((job) => (
                <div
                  key={job.id}
                  onClick={() => {
                    if (job.status === 'complete') {
                      onNav('notes', { jobId: job.id });
                    } else if (job.status === 'error') {
                      alert('Job failed');
                    } else {
                      onOpenProcessing(job.id);
                    }
                  }}
                  className={cn(
                    "flex items-center gap-4 p-3.5 text-left transition-colors cursor-pointer select-none",
                    job.status === 'complete' ? "hover:bg-[var(--hover)]" : "bg-[var(--surface-2)]/30"
                  )}
                >
                  <div className="w-16 aspect-[16/9] rounded-md overflow-hidden shrink-0 bg-zinc-800 relative">
                    {job.thumbnail_url ? (
                      <img src={job.thumbnail_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full" style={{ background: frameGradients.slide }} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-sm text-[var(--text-1)] truncate leading-normal">{job.title}</h3>
                    <div className="text-[11px] text-[var(--text-3)] flex items-center gap-1.5 mt-0.5">
                      <span>{job.channel || 'YouTube'}</span>
                      <span>·</span>
                      <span>{new Date(job.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    {job.folder_id && folderNameById[job.folder_id] && (
                      <span className="text-[10px] bg-[var(--surface-2)] text-[var(--text-2)] border border-[var(--border)] px-2 py-0.5 rounded-md flex items-center gap-1">
                        <Folder size={9} /> {folderNameById[job.folder_id]}
                      </span>
                    )}
                    <span 
                      className={cn(
                        "text-[10.5px] font-semibold px-2 py-0.5 rounded-full",
                        job.status === 'complete' ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" :
                        job.status === 'error' ? "bg-red-500/10 text-red-500" : "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 animate-pulse"
                      )}
                    >
                      {job.status === 'complete' ? 'Ready' : job.status === 'error' ? 'Failed' : `${Math.round(job.progress)}%`}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── 2. NOTES VIEW SCREEN ────────────────────────────────────────────────────

interface NotesViewProps {
  notes: VideoNotes | null;
  loading: boolean;
  error: string | null;
  jobId: string | null;
  onNav: (v: string, params?: any) => void;
  showChat: boolean;
  onShowChat: () => void;
  courseContext?: {
    courseId: string;
    courseTitle: string;
    lectureNumber: number;
    prev: { jobId: string; title: string; number: number } | null;
    next: { jobId: string; title: string; number: number } | null;
  } | null;
}

// ─── Inline processing view ─────────────────────────────────────────────────
// Used when the user lands on a notes URL whose job hasn't finished yet.
// Polls /api/status/{id} every few seconds and reloads when the job flips to
// 'complete'. Friendlier than the old "Failed to load" panel which was misleading.
const _PROCESSING_STAGES: { key: JobStatus['status']; label: string }[] = [
  { key: 'queued', label: 'Queued' },
  { key: 'downloading', label: 'Downloading video' },
  { key: 'transcribing', label: 'Extracting transcript' },
  { key: 'capturing', label: 'Capturing key frames' },
  { key: 'reading', label: 'Analysing visual content' },
  { key: 'writing', label: 'Synthesising notes' },
];

function NotesProcessingInline({
  jobId,
  initialStatus,
  onBack,
}: {
  jobId: string;
  initialStatus?: JobStatus['status'];
  onBack: () => void;
}) {
  const [job, setJob] = React.useState<JobStatus | null>(null);
  const [pollError, setPollError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        const j = await getJobStatus(jobId);
        if (cancelled) return;
        setJob(j);
        setPollError(null);
        if (j.status === 'complete') {
          // Reload once so NotesView re-mounts with the now-complete payload.
          window.location.reload();
          return;
        }
        if (j.status === 'error') return; // stop polling
      } catch (e) {
        if (!cancelled) setPollError(e instanceof Error ? e.message : 'Lost connection');
      }
      if (!cancelled) timer = setTimeout(tick, 3500);
    };
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId]);

  const status = job?.status ?? initialStatus ?? 'queued';
  const progress = job?.progress ?? 0;
  const stageDetail = job?.stage_detail ?? '';
  const errored = status === 'error';
  const activeIdx = _PROCESSING_STAGES.findIndex((s) => s.key === status);

  return (
    <div className="h-full w-full flex flex-col items-center justify-center px-6 select-none">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2 mb-4">
          <button
            onClick={onBack}
            className="text-[12px] text-[var(--text-3)] hover:text-[var(--text-1)] inline-flex items-center gap-1 border-none bg-transparent cursor-pointer p-0"
          >
            <ChevronLeft size={13} /> Library
          </button>
        </div>

        <div className="flex items-baseline justify-between mb-1">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-[var(--text-3)]">
            {errored ? 'Failed' : 'Processing'}
          </div>
          <div className="text-[12px] font-mono text-[var(--text-2)]">{Math.round(progress)}%</div>
        </div>

        <h2 className="text-[18px] font-semibold tracking-tight text-[var(--text-1)] mb-1 truncate">
          {job?.video_title || 'Your video'}
        </h2>
        <div className="text-[12.5px] text-[var(--text-3)] mb-4 min-h-[18px]">
          {errored
            ? job?.error_message || 'Processing failed.'
            : stageDetail || _PROCESSING_STAGES[Math.max(0, activeIdx)]?.label || 'Starting…'}
        </div>

        <div className="h-1.5 w-full bg-[var(--surface-2)] rounded-full overflow-hidden mb-5">
          <div
            className={cn(
              'h-full rounded-full transition-[width] duration-500 ease-out',
              errored ? 'bg-red-500' : 'bg-[var(--brand-500)]',
              !errored && 'animate-pulse',
            )}
            style={{ width: `${Math.max(2, Math.round(progress))}%` }}
          />
        </div>

        <ul className="space-y-1.5 mb-6">
          {_PROCESSING_STAGES.slice(1).map((s, i) => {
            const stageIndex = i + 1;
            const reached = activeIdx >= stageIndex;
            const isCurrent = status === s.key;
            return (
              <li
                key={s.key}
                className={cn(
                  'flex items-center gap-2 text-[12.5px] transition-colors',
                  isCurrent
                    ? 'text-[var(--brand-500)] font-semibold'
                    : reached
                      ? 'text-[var(--text-2)]'
                      : 'text-[var(--text-4)]',
                )}
              >
                {isCurrent ? (
                  <Loader2 width={12} height={12} className="animate-spin" />
                ) : reached ? (
                  <Check size={12} className="text-emerald-500" />
                ) : (
                  <span className="inline-block w-3 h-3 rounded-full border border-[var(--text-4)]" />
                )}
                <span>{s.label}</span>
              </li>
            );
          })}
        </ul>

        {pollError && (
          <div className="text-[11.5px] text-amber-500 mb-3">
            Couldn't refresh status: {pollError}. Retrying…
          </div>
        )}

        <div className="text-[11.5px] text-[var(--text-3)] leading-relaxed">
          You can close this tab — processing continues in the background.
          The page will refresh automatically when your notes are ready.
        </div>
      </div>
    </div>
  );
}

function NotesView({
  notes,
  loading,
  error,
  jobId,
  onNav,
  showChat,
  onShowChat,
  courseContext,
}: NotesViewProps) {
  const [folderName, setFolderName] = React.useState('Transformers');
  const [readerMode, setReaderMode] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [activeSection, setActiveSection] = React.useState<number | null>(null);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (notes?.video?.title) {
      const localFolders = JSON.parse(localStorage.getItem('pupil_folders') || '{}');
      setFolderName(localFolders[notes.job_id] || 'Transformers');
    }
  }, [notes]);

  // Track scroll progress through the notes container.
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const max = el.scrollHeight - el.clientHeight;
      const pct = max <= 0 ? 0 : Math.min(100, Math.max(0, (el.scrollTop / max) * 100));
      setProgress(pct);
    };
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [notes]);

  // Tag rendered H2s with section ids + observe to highlight the active one.
  React.useEffect(() => {
    if (!notes) return;
    const el = scrollRef.current;
    if (!el) return;

    // Wait for BlockNote to mount, then assign data-section-num to each h2.
    let cleanup: (() => void) | undefined;
    const setup = () => {
      const headings = Array.from(el.querySelectorAll('.bn-editor h2')) as HTMLElement[];
      if (headings.length === 0) return false;
      headings.forEach((h, i) => {
        const num = notes.sections?.[i]?.number;
        if (num != null) h.dataset.sectionNum = String(num);
        h.style.scrollMarginTop = '72px';
      });
      const obs = new IntersectionObserver(
        (entries) => {
          // Pick the topmost visible heading.
          const visible = entries
            .filter((e) => e.isIntersecting)
            .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
          if (visible.length > 0) {
            const num = (visible[0].target as HTMLElement).dataset.sectionNum;
            if (num) setActiveSection(Number(num));
          }
        },
        { root: el, rootMargin: '-72px 0px -65% 0px', threshold: 0 },
      );
      headings.forEach((h) => obs.observe(h));
      cleanup = () => obs.disconnect();
      return true;
    };

    // Poll briefly for BlockNote to render its content.
    let tries = 0;
    const interval = window.setInterval(() => {
      if (setup() || ++tries > 30) window.clearInterval(interval);
    }, 100);

    return () => {
      window.clearInterval(interval);
      cleanup?.();
    };
  }, [notes]);

  const scrollToSection = (num: number) => {
    const el = scrollRef.current?.querySelector<HTMLElement>(`.bn-editor h2[data-section-num="${num}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (loading) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 space-y-4">
        <Loader2 className="w-10 h-10 animate-spin text-[var(--brand-500)]" />
        <p className="text-[var(--text-3)] text-sm animate-pulse">Retrieving study guide...</p>
      </div>
    );
  }

  // If notes returned (HTTP 200 OR 202) but the payload has no `.video`, the
  // job isn't actually complete yet. Show a live processing view that polls
  // the status endpoint instead of a generic "failed to load" panel.
  if (!error && notes && !notes.video && jobId) {
    return (
      <NotesProcessingInline
        jobId={jobId}
        initialStatus={(notes as any).status}
        onBack={() => onNav('library')}
      />
    );
  }

  if (error || !notes || !notes.video) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center max-w-md mx-auto space-y-6 select-none">
        <div className="w-14 h-14 bg-red-500/10 border border-red-500/20 text-red-500 rounded-full flex items-center justify-center">
          <Info size={28} />
        </div>
        <div>
          <h2 className="text-xl font-bold mb-1.5">Failed to load notes</h2>
          <p className="text-[13px] text-[var(--text-2)] leading-relaxed">
            {error || 'The requested video notes could not be found or are still processing.'}
          </p>
        </div>
        <div className="flex gap-2.5 w-full">
          <button 
            onClick={() => onNav('library')}
            className="flex-1 py-2 px-3 bg-[var(--surface-2)] text-[var(--text-2)] hover:text-[var(--text-1)] rounded-lg text-sm transition-colors border border-[var(--border)] cursor-pointer"
          >
            Go to Library
          </button>
          <button 
            onClick={() => window.location.reload()}
            className="flex-1 py-2 px-3 bg-[var(--brand-500)] hover:bg-[var(--brand-600)] text-white font-medium rounded-lg text-sm transition-colors border-none cursor-pointer"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex h-full w-full select-text notes-reader", readerMode && "reader-mode")}>

      {/* Dynamic Left Note Editor Area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto min-w-0 relative flex flex-col bg-[var(--bg)]">

        {/* Reading progress bar */}
        <div className="sticky top-0 z-30 h-[2px] bg-transparent shrink-0">
          <div
            className="h-full bg-[var(--brand-500)] transition-[width] duration-150 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Sticky Actions Bar */}
        <div className="sticky top-[2px] z-20 h-[52px] px-6 bg-[var(--bg)]/95 border-b border-[var(--border)] flex items-center justify-between shrink-0 shadow-sm backdrop-blur-md select-none">
          <div className="flex items-center gap-1.5 text-xs text-[var(--text-3)] font-medium min-w-0">
            <button
              onClick={() => onNav('library')}
              className="flex items-center gap-1 hover:text-[var(--text-1)] border-none bg-transparent cursor-pointer py-1 px-1.5 rounded hover:bg-[var(--hover)] text-xs font-semibold shrink-0"
            >
              <ChevronLeft size={13} /> Library
            </button>
            <span>/</span>
            {courseContext ? (
              <>
                <button
                  onClick={() => onNav('course', { courseId: courseContext.courseId })}
                  className="text-[var(--text-2)] hover:text-[var(--text-1)] truncate shrink-0 max-w-[180px] border-none bg-transparent cursor-pointer p-0 font-semibold inline-flex items-center gap-1"
                  title={courseContext.courseTitle}
                >
                  <span aria-hidden>📘</span>
                  <span className="truncate">{courseContext.courseTitle}</span>
                </button>
                <span>/</span>
                <span className="text-[var(--text-3)] shrink-0">L{courseContext.lectureNumber}</span>
                <span>·</span>
              </>
            ) : (
              <>
                <span className="text-[var(--text-2)] truncate shrink-0">{folderName}</span>
                <span>/</span>
              </>
            )}
            <span className="text-[var(--text-1)] truncate font-semibold">{notes.video.title}</span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => setReaderMode((v) => !v)}
              title={readerMode ? 'Exit reader mode' : 'Enter reader mode'}
              className={cn(
                "flex items-center gap-1.5 py-1 px-2.5 rounded-lg text-[12.5px] font-semibold transition-colors cursor-pointer border",
                readerMode
                  ? "bg-[var(--brand-500)] text-white border-[var(--brand-500)]"
                  : "bg-transparent text-[var(--text-2)] border-[var(--border)] hover:bg-[var(--hover)] hover:text-[var(--text-1)]"
              )}
            >
              <BookOpen size={13} /> Reader
            </button>
            {!readerMode && (
              <button
                onClick={onShowChat}
                className={cn(
                  "flex items-center gap-1.5 py-1 px-2.5 rounded-lg text-[12.5px] font-semibold transition-colors cursor-pointer border",
                  showChat
                    ? "bg-[var(--brand-500)] text-white border-[var(--brand-500)]"
                    : "bg-transparent text-[var(--text-2)] border-[var(--border)] hover:bg-[var(--hover)] hover:text-[var(--text-1)]"
                )}
              >
                <MessageSquare size={13} /> Chat with Video
              </button>
            )}
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 py-1 px-2.5 bg-transparent text-[var(--text-2)] border border-[var(--border)] hover:bg-[var(--hover)] hover:text-[var(--text-1)] rounded-lg text-[12.5px] font-semibold transition-colors cursor-pointer select-none"
            >
              <Download size={13} /> Export PDF
            </button>
          </div>
        </div>

        {/* Cover Banner — hidden in reader mode */}
        {!readerMode && notes.video.thumbnail_url ? (
          <div className="w-full h-[200px] relative bg-zinc-800 shrink-0 overflow-hidden select-none">
            <img 
              src={notes.video.thumbnail_url} 
              alt="Video Cover" 
              className="w-full h-full object-cover opacity-80 filter saturate-[0.9] dark:saturate-[0.75]" 
            />
            {/* Gradient fade at bottom */}
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[var(--bg)] opacity-60" />
            {/* Play Button Overlay */}
            <a 
              href={`https://youtube.com/watch?v=${notes.video.youtube_id}`}
              target="_blank"
              rel="noreferrer"
              className="absolute inset-0 flex items-center justify-center bg-black/10 hover:bg-black/25 transition-colors cursor-pointer group"
            >
              <div className="w-10 h-10 rounded-full bg-white/90 dark:bg-[#1A1A1E]/90 flex items-center justify-center shadow-lg transform group-hover:scale-110 transition-all">
                <Play size={14} className="text-black dark:text-white fill-current ml-0.5" />
              </div>
            </a>
          </div>
        ) : !readerMode ? (
          <div className="w-full h-24 shrink-0" style={{ background: frameGradients.slide }} />
        ) : null}

        {/* Note Body Area — Notion content width */}
        <div className={cn("w-full mx-auto px-4 pb-40", readerMode ? "max-w-[680px] pt-10" : "max-w-[740px] pt-6")}>
          {/* Floating Page Icon — hidden in reader mode */}
          {!readerMode && (
            <div className="relative -mt-10 mb-5 inline-flex items-center justify-center w-16 h-16 bg-[var(--surface-1)] border border-[var(--border)] rounded-xl shadow-md text-3xl select-none">
              🎥
            </div>
          )}

          {/* Title */}
          <h1 className="text-[2.4rem] font-extrabold tracking-tight text-[var(--text-1)] leading-[1.15] outline-none select-text mb-3">
            {notes.video.title}
          </h1>
          {/* Reserved row so the page doesn't visually jump when the badge
              renders. We always render the wrapper; the badge component
              itself returns null when no classification is available. */}
          <div className="mt-1 mb-2 min-h-[22px]">
            <ClassificationBadge classification={notes.content_classification} />
          </div>

          {/* Notion-style database properties grid — hidden in reader mode */}
          <div className={cn(
            "grid grid-cols-[130px_1fr] gap-x-3 gap-y-2.5 text-[13px] border-t border-[var(--border)] pt-4 pb-3 mt-4 mb-8",
            readerMode && "hidden"
          )}>
            <div className="text-[var(--text-3)] font-medium flex items-center gap-1.5 select-none h-7">
              <Folder size={13} /> Folder
            </div>
            <div className="text-[var(--text-1)] flex items-center h-7">
              <span className="bg-[var(--surface-2)] px-2 py-0.5 rounded text-xs border border-[var(--border)] font-medium">
                {folderName}
              </span>
            </div>

            <div className="text-[var(--text-3)] font-medium flex items-center gap-1.5 select-none h-7">
              <Clock size={13} /> Duration
            </div>
            <div className="text-[var(--text-1)] font-mono text-[13px] flex items-center h-7">
              {(() => {
                const totalSec = Math.round(notes.video.duration_seconds);
                return `${Math.floor(totalSec / 60)}:${(totalSec % 60).toString().padStart(2, '0')}`;
              })()}
            </div>

            <div className="text-[var(--text-3)] font-medium flex items-center gap-1.5 select-none h-7">
              <Sparkles size={13} /> Key Concepts
            </div>
            <div className="text-[var(--text-1)] flex flex-wrap gap-1.5 items-center min-h-7">
              {notes.topics && notes.topics.length > 0 ? (
                notes.topics.map((t, idx) => (
                  <span key={idx} className="bg-[var(--brand-500)]/10 text-[var(--brand-500)] px-2 py-0.5 rounded-full text-[11.5px] font-semibold select-none">
                    {t}
                  </span>
                ))
              ) : (
                <span className="text-[var(--text-3)] text-[13px]">None extracted</span>
              )}
            </div>

            <div className="text-[var(--text-3)] font-medium flex items-center gap-1.5 select-none h-7">
              <ExternalLink size={13} /> Video Source
            </div>
            <div className="text-[var(--text-1)] flex items-center h-7">
              <a
                href={`https://youtube.com/watch?v=${notes.video.youtube_id}`}
                target="_blank"
                rel="noreferrer"
                className="text-[var(--brand-500)] hover:underline flex items-center gap-1 font-medium text-[13px]"
              >
                {notes.video.channel || 'Watch Video'} <ExternalLink size={11} />
              </a>
            </div>
          </div>

          {/* DYNAMIC BLOCKNOTE NOTE EDITOR */}
          <div className="select-text">
            <NotesEditor notes={notes} />
          </div>

          {/* Lecture-to-lecture navigation when this video is part of a course */}
          {courseContext && (courseContext.prev || courseContext.next) && (
            <div className="mt-12 pt-6 border-t border-[var(--border)] grid grid-cols-2 gap-3">
              {courseContext.prev ? (
                <button
                  onClick={() => onNav('notes', { jobId: courseContext.prev!.jobId })}
                  className="text-left p-4 rounded-lg border border-[var(--border)] hover:border-[var(--brand-500)]/40 hover:bg-[var(--hover)] transition-colors border-none bg-transparent cursor-pointer"
                  style={{ borderStyle: 'solid' }}
                >
                  <div className="text-[10.5px] uppercase tracking-wider font-semibold text-[var(--text-3)] flex items-center gap-1">
                    <ChevronLeft size={11} /> Previous
                  </div>
                  <div className="text-[13px] font-semibold text-[var(--text-1)] mt-1">
                    L{courseContext.prev.number}: {courseContext.prev.title}
                  </div>
                </button>
              ) : <span />}
              {courseContext.next ? (
                <button
                  onClick={() => onNav('notes', { jobId: courseContext.next!.jobId })}
                  className="text-right p-4 rounded-lg border border-[var(--border)] hover:border-[var(--brand-500)]/40 hover:bg-[var(--hover)] transition-colors bg-transparent cursor-pointer"
                  style={{ borderStyle: 'solid' }}
                >
                  <div className="text-[10.5px] uppercase tracking-wider font-semibold text-[var(--text-3)] flex items-center gap-1 justify-end">
                    Next <ChevronRight size={11} />
                  </div>
                  <div className="text-[13px] font-semibold text-[var(--text-1)] mt-1">
                    L{courseContext.next.number}: {courseContext.next.title}
                  </div>
                </button>
              ) : <span />}
            </div>
          )}
        </div>
      </div>

      {/* Collapsible Chat Panel on the right */}
      {showChat && (
        <ChatPanel
          videoTitle={notes.video.title}
          onClose={onShowChat}
          courseTitle={courseContext?.courseTitle ?? null}
        />
      )}
    </div>
  );
}

// ─── 2B. NOTE-LEVEL CHAT PANEL ──────────────────────────────────────────────

function ChatPanel({
  videoTitle,
  onClose,
  courseTitle,
}: {
  videoTitle: string;
  onClose: () => void;
  courseTitle?: string | null;
}) {
  const [messages, setMessages] = React.useState<any[]>([
    {
      role: 'ai',
      text: "I've watched this video and indexed all visual frames. Ask me anything, and I'll cite exact moments or code blocks from the screen."
    }
  ]);
  const [inputText, setInputText] = React.useState('');
  const [isTyping, setIsTyping] = React.useState(false);
  const [scope, setScope] = React.useState<'lecture' | 'course'>('lecture');
  const bottomRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const handleSend = () => {
    if (!inputText.trim()) return;

    setMessages(prev => [...prev, { role: 'user', text: inputText.trim() }]);
    setInputText('');
    setIsTyping(true);

    // Mock response after 1s
    setTimeout(() => {
      setIsTyping(false);
      setMessages(prev => [...prev, {
        role: 'ai',
        text: `In this lecture, this concept is discussed starting around 12:45. Let's look at the formula captured from the screen:`,
        eq: 'Attention(Q, K, V) = softmax(Q K^T / \\sqrt{d_k}) V',
        explain: 'The queries and keys are multiplied and scaled to prevent gradients from saturating during large projections.'
      }]);
    }, 1200);
  };

  return (
    <aside className="w-[380px] bg-[var(--bg)] border-l border-[var(--border)] flex flex-col shrink-0 h-full select-none animate-[pupil-fade_0.15s_ease]">
      {/* Header */}
      <div className="p-3.5 border-b border-[var(--border)] flex items-center justify-between shrink-0 bg-[var(--sidebar)]/40">
        <div className="flex items-center gap-2 min-w-0">
          <MessageSquare size={15} className="text-[var(--brand-500)] shrink-0" />
          <div className="min-w-0">
            <div className="text-[13px] font-bold truncate">Chat with Video</div>
            <div className="text-[10px] text-[var(--text-3)] truncate">{videoTitle}</div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-[var(--hover)] text-[var(--text-3)] hover:text-[var(--text-1)] border-none cursor-pointer shrink-0"
        >
          <X size={15} />
        </button>
      </div>

      {/* Scope toggle — only visible when this lecture is part of a course */}
      {courseTitle && (
        <div className="px-3.5 py-2 border-b border-[var(--border)] bg-[var(--sidebar)]/20 flex items-center gap-1 shrink-0">
          <button
            onClick={() => setScope('lecture')}
            className={cn(
              "flex-1 py-1 px-2 rounded-md text-[11.5px] font-semibold transition-colors border-none cursor-pointer",
              scope === 'lecture'
                ? "bg-[var(--surface-1)] text-[var(--text-1)] shadow-sm"
                : "bg-transparent text-[var(--text-3)] hover:text-[var(--text-1)]"
            )}
          >
            This lecture
          </button>
          <button
            onClick={() => setScope('course')}
            title={courseTitle}
            className={cn(
              "flex-1 py-1 px-2 rounded-md text-[11.5px] font-semibold transition-colors border-none cursor-pointer truncate",
              scope === 'course'
                ? "bg-[var(--surface-1)] text-[var(--text-1)] shadow-sm"
                : "bg-transparent text-[var(--text-3)] hover:text-[var(--text-1)]"
            )}
          >
            Entire course
          </button>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 select-text">
        {messages.map((m, i) => (
          <div key={i} className={cn("flex flex-col gap-1.5", m.role === 'user' ? "items-end" : "items-start")}>
            {m.role === 'ai' && (
              <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-3)] font-semibold select-none mb-0.5">
                <div className="w-4 h-4 rounded-full bg-[var(--brand-500)] flex items-center justify-center text-[8px] text-white">
                  <Sparkles size={8} className="fill-white" />
                </div>
                <span>Pupil AI</span>
              </div>
            )}
            <div 
              className={cn(
                "max-w-[85%] rounded-xl py-2 px-3 text-[13px] leading-relaxed shadow-sm",
                m.role === 'user' 
                  ? "bg-[var(--brand-500)] text-white rounded-br-sm" 
                  : "bg-[var(--surface-2)] text-[var(--text-1)] rounded-bl-sm border border-[var(--border)]"
              )}
            >
              {m.text}
            </div>

            {m.eq && (
              <div className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg p-3 text-center my-1.5 font-mono text-[11.5px] overflow-x-auto text-[var(--text-1)]">
                {m.eq}
              </div>
            )}

            {m.explain && (
              <div className="text-[12px] text-[var(--text-2)] leading-relaxed italic px-2">
                {m.explain}
              </div>
            )}
          </div>
        ))}
        {isTyping && (
          <div className="flex items-center gap-1 text-[11px] text-[var(--text-3)] animate-pulse pl-1.5">
            <Loader2 width={10} height={10} className="animate-spin text-[var(--text-3)]" />
            <span>AI is reviewing video transcripts...</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-3.5 border-t border-[var(--border)] bg-[var(--sidebar)]/10 shrink-0">
        <div className="flex gap-2 items-center py-1.5 px-3 bg-[var(--surface-2)] border border-[var(--border)] rounded-xl">
          <input 
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Ask a question about notes..." 
            className="flex-1 bg-transparent border-none outline-none text-[13px] text-[var(--text-1)] placeholder-[var(--text-3)]"
          />
          <button 
            onClick={handleSend}
            className="p-1 rounded-lg bg-[var(--brand-500)] text-white hover:bg-[var(--brand-600)] shrink-0 transition-colors border-none cursor-pointer"
          >
            <Play size={10} className="fill-white ml-0.5" />
          </button>
        </div>
        <div className="mt-2 text-[10.5px] text-[var(--text-3)] text-center">
          Answers cite timestamps in the video.
        </div>
      </div>
    </aside>
  );
}

// ─── 3. SEARCH VIEW SCREEN (Text & Visual Dropzone) ──────────────────────────

function SearchView({
  onNav,
  query: incomingQuery,
  results,
  loading,
  onSearch,
  onClear,
  courses,
  scope,
  scopeCourseId,
}: {
  onNav: (v: string, params?: any) => void;
  query: string;
  results: SearchResult[] | null;
  loading: boolean;
  onSearch: (q: string, opts?: { scope?: 'all' | 'course'; courseId?: string }) => void;
  onClear: () => void;
  courses: Course[];
  scope: 'all' | 'course';
  scopeCourseId?: string | null;
}) {
  const [tab, setTab] = React.useState<'text' | 'snap'>('text');
  const [query, setQuery] = React.useState(incomingQuery);
  const [isDropped, setIsDropped] = React.useState(false);
  const [selectedCourseId, setSelectedCourseId] = React.useState<string>(
    scope === 'course' && scopeCourseId ? scopeCourseId : 'all',
  );

  React.useEffect(() => { setQuery(incomingQuery); }, [incomingQuery]);
  React.useEffect(() => {
    setSelectedCourseId(scope === 'course' && scopeCourseId ? scopeCourseId : 'all');
  }, [scope, scopeCourseId]);

  const runSearch = () => {
    const q = query.trim();
    if (!q) return;
    if (selectedCourseId === 'all') onSearch(q, { scope: 'all' });
    else onSearch(q, { scope: 'course', courseId: selectedCourseId });
  };

  // Group results by course for visual chunking.
  const groupedResults = React.useMemo(() => {
    if (!results) return null;
    const groups = new Map<string, { title: string | null; items: SearchResult[] }>();
    for (const r of results) {
      const key = r.course_id || '__solo__';
      if (!groups.has(key)) {
        groups.set(key, { title: r.course_title, items: [] });
      }
      groups.get(key)!.items.push(r);
    }
    return Array.from(groups.entries());
  }, [results]);

  return (
    <div className="max-w-[1000px] mx-auto px-10 py-10 pb-20 select-none animate-[pupil-fade_0.2s_ease]">
      {/* Header */}
      <div className="flex justify-between items-baseline mb-8 border-b border-[var(--border)] pb-4">
        <div>
          <div className="text-[11px] text-[var(--text-3)] font-semibold tracking-wider uppercase mb-1">
            Global Search
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text-1)]">Find anything in library</h1>
        </div>
        
        {/* Tab switcher */}
        <div className="flex p-0.5 bg-[var(--surface-2)] border border-[var(--border)] rounded-xl shrink-0 select-none">
          <button 
            onClick={() => setTab('text')}
            className={cn(
              "flex items-center gap-1 py-1.5 px-3 rounded-lg border-none text-[12.5px] font-medium cursor-pointer transition-all",
              tab === 'text' 
                ? "bg-[var(--surface-1)] text-[var(--text-1)] shadow-sm" 
                : "text-[var(--text-3)] hover:text-[var(--text-2)] bg-transparent"
            )}
          >
            <Search size={13} /> Text Search
          </button>
          <button 
            onClick={() => setTab('snap')}
            className={cn(
              "flex items-center gap-1 py-1.5 px-3 rounded-lg border-none text-[12.5px] font-medium cursor-pointer transition-all",
              tab === 'snap' 
                ? "bg-[var(--surface-1)] text-[var(--text-1)] shadow-sm" 
                : "text-[var(--text-3)] hover:text-[var(--text-2)] bg-transparent"
            )}
          >
            <Camera size={13} /> Snap & Find
          </button>
        </div>
      </div>

      {tab === 'text' ? (
        <div className="space-y-6">
          <div className="flex items-center gap-3 p-3.5 bg-[var(--surface)] border border-[var(--border-strong)] rounded-xl shadow-sm">
            <Search size={18} className="text-[var(--brand-500)] shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); runSearch(); } }}
              placeholder="Search across all your videos..."
              className="flex-1 bg-transparent border-none outline-none text-sm text-[var(--text-1)] placeholder-[var(--text-3)]"
            />
            <select
              value={selectedCourseId}
              onChange={(e) => setSelectedCourseId(e.target.value)}
              className="text-[12px] py-1 px-2 bg-[var(--surface-2)] border border-[var(--border)] rounded-md text-[var(--text-1)] outline-none cursor-pointer max-w-[180px]"
              title="Scope the search"
            >
              <option value="all">All videos</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>
            {query && (
              <button
                onClick={() => { setQuery(''); onClear(); }}
                className="p-1 hover:bg-[var(--hover)] rounded border-none text-[var(--text-3)] cursor-pointer bg-transparent"
                title="Clear search"
              >
                <X size={14} />
              </button>
            )}
            <button
              onClick={runSearch}
              className="py-1 px-3 bg-[var(--brand-500)] hover:bg-[var(--brand-600)] text-white text-[12px] font-semibold rounded-md border-none cursor-pointer"
            >
              Search
            </button>
          </div>

          {loading && (
            <div className="flex items-center justify-center py-16 text-[var(--text-3)] text-sm">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Searching your library…
            </div>
          )}

          {!loading && results && results.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center select-none">
              <Search size={30} className="text-[var(--text-3)] mb-4" />
              <p className="text-[14px] font-semibold text-[var(--text-1)]">No results found</p>
              <p className="text-[12.5px] text-[var(--text-3)] mt-1">Try a different query or process more videos first.</p>
              <button
                onClick={() => { setQuery(''); onClear(); }}
                className="mt-4 py-1.5 px-3.5 bg-[var(--surface-2)] hover:bg-[var(--hover)] border border-[var(--border)] rounded-lg text-[12.5px] font-semibold text-[var(--text-1)] cursor-pointer"
              >
                Clear search
              </button>
            </div>
          )}

          {!loading && results && results.length > 0 && groupedResults && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-[12px] text-[var(--text-3)] font-medium">
                  {results.length} result{results.length === 1 ? '' : 's'} for &ldquo;{incomingQuery}&rdquo;
                  {selectedCourseId !== 'all' && (
                    <span> · scoped to <span className="text-[var(--brand-500)] font-semibold">{
                      courses.find((c) => c.id === selectedCourseId)?.title || 'this course'
                    }</span></span>
                  )}
                </div>
                <button
                  onClick={() => { setQuery(''); onClear(); }}
                  className="text-[12px] text-[var(--text-2)] hover:text-[var(--text-1)] underline-offset-2 hover:underline border-none bg-transparent cursor-pointer"
                >
                  Clear search
                </button>
              </div>

              {groupedResults.map(([key, group]) => (
                <div key={key} className="space-y-2">
                  {key !== '__solo__' && group.title && (
                    <div className="flex items-center gap-2 text-[11.5px] text-[var(--text-3)] uppercase tracking-wider font-semibold pt-1">
                      <span>📘</span>
                      <span className="text-[var(--text-2)]">{group.title}</span>
                    </div>
                  )}
                  {group.items.map((r) => (
                    <div
                      key={r.id}
                      onClick={() => onNav('notes', { jobId: r.id })}
                      className="p-4 bg-[var(--surface-1)] border border-[var(--border)] rounded-xl flex gap-4 cursor-pointer hover:border-[var(--border-strong)] hover:-translate-y-0.5 hover:shadow-md transition-all"
                    >
                      <div className="w-24 aspect-[16/9] rounded bg-zinc-800 shrink-0 overflow-hidden">
                        {r.thumbnail_url ? (
                          <img src={r.thumbnail_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full" style={{ background: 'linear-gradient(135deg, #312e81 0%, #1e1b4b 100%)' }} />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                          {r.course_id && (
                            <button
                              onClick={(e) => { e.stopPropagation(); onNav('course', { courseId: r.course_id }); }}
                              className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--brand-500)]/12 text-[var(--brand-500)] border-none cursor-pointer inline-flex items-center gap-1"
                              title={r.course_title || 'Course'}
                            >
                              📘 <span className="truncate max-w-[120px]">{r.course_title}</span>
                            </button>
                          )}
                          {r.lecture_number != null && (
                            <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-[var(--surface-2)] text-[var(--text-2)]">
                              L{r.lecture_number}
                            </span>
                          )}
                        </div>
                        <div className="flex items-baseline justify-between gap-3">
                          <h3 className="text-[14px] font-bold text-[var(--text-1)] truncate">{r.title || 'Untitled'}</h3>
                          <span className="text-[10.5px] font-mono text-[var(--text-3)] shrink-0">{Math.round(r.similarity * 100)}%</span>
                        </div>
                        {r.channel && !r.course_id && (
                          <div className="text-[11px] text-[var(--text-3)] mt-0.5">{r.channel}</div>
                        )}
                        {r.snippet && (
                          <p className="text-[12.5px] text-[var(--text-2)] mt-1.5 leading-relaxed line-clamp-2">
                            {r.snippet}
                          </p>
                        )}
                        <div className="mt-2 h-1 w-full bg-[var(--surface-2)] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[var(--brand-500)] rounded-full"
                            style={{ width: `${Math.max(4, Math.round(r.similarity * 100))}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {!loading && results === null && (
            <div className="flex flex-col items-center justify-center py-16 text-center select-none">
              <Search size={30} className="text-[var(--text-3)] mb-4" />
              <p className="text-[13.5px] text-[var(--text-2)]">Type a query and press Enter to search semantically across your library.</p>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {!isDropped ? (
            <div 
              onClick={() => setIsDropped(true)}
              className="border-2 border-dashed border-[var(--border-strong)] rounded-2xl bg-[var(--surface)] hover:bg-[var(--hover)]/20 p-16 text-center transition-all cursor-pointer flex flex-col items-center"
            >
              <div className="w-14 h-14 bg-[var(--bg)] border border-[var(--border)] rounded-full flex items-center justify-center text-[var(--brand-500)] mb-4 shadow-sm">
                <Camera size={24} />
              </div>
              <h3 className="text-lg font-bold mb-1.5">Drop a screenshot to search visually</h3>
              <p className="text-sm text-[var(--text-2)] max-w-sm mx-auto leading-relaxed mb-6">
                Drag & drop any blackboard drawing, code snippet, or slide image. Pupil indexes the visual content of every frame.
              </p>
              <div className="flex gap-2">
                <button className="py-1.5 px-3.5 bg-[var(--brand-500)] text-white text-[12.5px] font-semibold rounded-lg shadow-sm border-none cursor-pointer">
                  Upload screenshot
                </button>
                <button className="py-1.5 px-3.5 bg-[var(--surface-2)] text-[var(--text-1)] border border-[var(--border)] text-[12.5px] font-semibold rounded-lg hover:bg-[var(--hover)] transition-colors cursor-pointer">
                  Paste from clipboard
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
              <div className="md:col-span-1 border border-[var(--border)] rounded-xl p-4 bg-[var(--surface)] space-y-4">
                <div className="text-[11px] font-semibold text-[var(--text-3)] uppercase tracking-wide">Screenshot target</div>
                <div className="aspect-[16/9] w-full rounded bg-zinc-800 relative select-none overflow-hidden">
                  <div className="w-full h-full flex items-center justify-center font-serif text-white italic text-lg" style={{ background: 'linear-gradient(135deg, #14532d 0%, #052e16 100%)' }}>
                    f(x) = Wx + b
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-semibold text-[var(--text-3)] uppercase tracking-wide mb-2">Detected structures</div>
                  <div className="flex flex-wrap gap-1.5">
                    <span className="text-[10px] bg-[var(--brand-500)]/10 text-[var(--brand-500)] px-2 py-0.5 rounded font-semibold">Linear activation</span>
                    <span className="text-[10px] bg-[var(--surface-2)] text-[var(--text-2)] px-2 py-0.5 rounded">Whiteboard text</span>
                    <span className="text-[10px] bg-[var(--surface-2)] text-[var(--text-2)] px-2 py-0.5 rounded">Formula</span>
                  </div>
                </div>
                <button 
                  onClick={() => setIsDropped(false)}
                  className="w-full py-1.5 bg-transparent border border-[var(--border)] hover:bg-[var(--hover)] rounded-lg text-xs font-semibold text-[var(--text-2)] transition-colors cursor-pointer"
                >
                  Reset visual search
                </button>
              </div>
              <div className="md:col-span-2 space-y-4">
                <div className="text-sm font-semibold text-[var(--text-1)]">Visual matches found in your library:</div>
                <div className="space-y-3">
                  <div 
                    onClick={() => onNav('library')}
                    className="p-3.5 bg-[var(--surface-1)] border border-[var(--border)] hover:border-[var(--border-strong)] rounded-xl flex gap-3.5 cursor-pointer transition-all"
                  >
                    <div className="w-20 aspect-[16/9] bg-zinc-800 rounded shrink-0 overflow-hidden relative">
                      <div className="w-full h-full" style={{ background: 'linear-gradient(135deg, #14532d 0%, #052e16 100%)' }} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex justify-between items-baseline mb-0.5">
                        <span className="text-[10.5px] text-[var(--text-3)]">Linear Algebra Foundations</span>
                        <span className="text-[11px] font-mono text-[var(--success-500)] font-semibold">95% similarity</span>
                      </div>
                      <h4 className="font-bold text-[13.5px] text-[var(--text-1)] truncate">f(x) = Wx + b</h4>
                      <p className="text-[11px] text-[var(--text-3)] mt-1.5">Matched at 08:34 · Chalkboard section</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── 4. CONCEPTS SCREEN (Dummy representation) ───────────────────────────────

function CourseView({
  courseId,
  onNav,
}: {
  courseId: string;
  onNav: (v: string, params?: any) => void;
}) {
  const [course, setCourse] = React.useState<CourseWithLectures | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const fetchCourseData = React.useCallback(async () => {
    if (!courseId) return;
    try {
      const data = await getCourse(courseId);
      setCourse(data);
      setError(null);     // clear any stale error from a prior failure
      setLoading(false);  // only flip out of skeleton state on success
    } catch (err) {
      // Only show the error panel if we have NOTHING to render yet.
      // Background polling failures shouldn't flash the error UI.
      setCourse((current) => {
        if (!current) {
          setError(err instanceof Error ? err.message : 'Failed to load course.');
          setLoading(false);
        }
        return current;
      });
    }
  }, [courseId]);

  React.useEffect(() => {
    fetchCourseData();
    const interval = setInterval(fetchCourseData, 8000);
    return () => clearInterval(interval);
  }, [fetchCourseData]);

  if (loading) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 space-y-3 select-none">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--brand-500)]" />
        <p className="text-[var(--text-3)] text-sm">Loading course…</p>
      </div>
    );
  }
  if (error || !course) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center max-w-md mx-auto space-y-4 select-none">
        <Info size={28} className="text-red-500" />
        <p className="text-[13px] text-[var(--text-2)]">{error || 'Course not found.'}</p>
        <button onClick={() => onNav('library')} className="py-2 px-3 bg-[var(--surface-2)] border border-[var(--border)] rounded-lg text-sm cursor-pointer">
          Back to library
        </button>
      </div>
    );
  }

  return <CourseOverview course={course} onBack={() => onNav('library')} />;
}

function ConceptsView() {
  return (
    <div className="max-w-[900px] mx-auto px-10 py-10 select-none animate-[pupil-fade_0.2s_ease]">
      <div className="border-b border-[var(--border)] pb-4 mb-6">
        <div className="text-[11px] text-[var(--text-3)] font-semibold tracking-wider uppercase mb-1">Concepts Index</div>
        <h1 className="text-2xl font-bold tracking-tight">Extracted Knowledge Base</h1>
      </div>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[
          { title: "Query vector", desc: "A linear projection of the token embedding representing the 'question' the token is looking to answer in the sequence.", type: "Definition" },
          { title: "Key vector", desc: "The projection of the token embedding representing the 'content' index keys that query vectors dot-product against.", type: "Definition" },
          { title: "Softmax Scaling Factor", desc: "Dividing dot products by sqrt(d_k) to prevent variance explosion and vanishing gradients during training.", type: "Theorem" },
          { title: "Attention Head", desc: "An independent projection subspace. Multi-head setups run multiple heads in parallel to capture distinct relationships.", type: "Definition" }
        ].map((c, i) => (
          <div key={i} className="p-4 bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-sm space-y-2">
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-[14px] text-[var(--text-1)]">{c.title}</h3>
              <span className="text-[9px] font-semibold bg-[var(--brand-500)]/10 text-[var(--brand-500)] px-2 py-0.5 rounded-full select-none">{c.type}</span>
            </div>
            <p className="text-[12.5px] text-[var(--text-2)] leading-relaxed select-text">{c.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── 5. RESURFACING SCREEN (Dummy representation) ────────────────────────────

function ResurfacingView() {
  return (
    <div className="max-w-[700px] mx-auto px-10 py-10 select-none animate-[pupil-fade_0.2s_ease]">
      <div className="border-b border-[var(--border)] pb-4 mb-8">
        <div className="text-[11px] text-[var(--text-3)] font-semibold tracking-wider uppercase mb-1">Daily Review</div>
        <h1 className="text-2xl font-bold tracking-tight">Resurfacing Quizzes</h1>
      </div>

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-sm space-y-6">
        <div>
          <span className="text-[10px] bg-amber-500/10 text-amber-600 dark:text-amber-400 px-2.5 py-0.5 rounded-full font-bold uppercase select-none">
            Question of the day
          </span>
          <h2 className="text-lg font-bold mt-3 select-text leading-snug">
            In scaled dot-product attention, what occurs mathematically if we omit the division by <span className="font-mono bg-[var(--surface-2)] px-1 rounded font-normal">\sqrt{"d_k"}</span>?
          </h2>
        </div>

        <div className="flex flex-col gap-2.5">
          {[
            "The values weights collapse to uniform probability.",
            "The dot products grow large in magnitude, pushing softmax into regions with vanishing gradients.",
            "The sequence length dimension grows quadratically in memory complexity.",
            "Positional encodings fail to compute properly during projections."
          ].map((opt, i) => (
            <button 
              key={i}
              onClick={() => alert(i === 1 ? "Correct!" : "Try again")}
              className="w-full text-left py-3 px-4 bg-[var(--bg)] border border-[var(--border)] hover:border-[var(--brand-500)] rounded-xl text-sm transition-all hover:bg-[var(--hover)] font-medium cursor-pointer"
            >
              {opt}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── 6. CHAT SCREEN (Dummy library-wide chat) ────────────────────────────────

function ChatView() {
  return (
    <div className="max-w-[800px] mx-auto px-10 py-10 flex flex-col h-full select-none animate-[pupil-fade_0.2s_ease]">
      <div className="border-b border-[var(--border)] pb-4 mb-6 shrink-0">
        <div className="text-[11px] text-[var(--text-3)] font-semibold tracking-wider uppercase mb-1">AI Assistant</div>
        <h1 className="text-2xl font-bold tracking-tight">Chat with Library</h1>
      </div>

      <div className="flex-1 border border-[var(--border)] rounded-2xl bg-[var(--surface)] p-6 flex flex-col justify-between shadow-sm min-h-[360px]">
        <div className="space-y-4 flex-1 overflow-y-auto">
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-[var(--brand-500)] flex items-center justify-center text-[10px] text-white shrink-0 shadow-sm select-none">
              <Sparkles size={11} className="fill-white" />
            </div>
            <div>
              <div className="text-[11px] text-[var(--text-3)] font-semibold mb-0.5">Pupil Library AI</div>
              <p className="text-[13px] text-[var(--text-2)] bg-[var(--surface-1)] border border-[var(--border)] rounded-xl py-2 px-3 leading-relaxed max-w-md select-text">
                Hello! I can search across all notes in your library to summarize concepts, compare lectures, or prepare flashcards. What are you looking to review?
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4 border-t border-[var(--border)] pt-4 flex gap-2 items-center">
          <input 
            type="text" 
            placeholder="Search and ask questions across all your processed courses..."
            className="flex-1 bg-[var(--bg)] border border-[var(--border)] rounded-xl py-2.5 px-4 text-[13px] outline-none text-[var(--text-1)] placeholder-[var(--text-3)] shadow-inner"
          />
          <button 
            onClick={() => alert('Submit message')}
            className="py-2.5 px-4 bg-[var(--brand-500)] hover:bg-[var(--brand-600)] text-white font-medium text-sm rounded-xl transition-colors border-none cursor-pointer"
          >
            Ask AI
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── 7. SETTINGS SCREEN ──────────────────────────────────────────────────────

function SettingsView({ 
  isPro, 
  setIsPro 
}: { 
  isPro: boolean; 
  setIsPro: (v: boolean) => void;
}) {
  return (
    <div className="max-w-[700px] mx-auto px-10 py-10 select-none animate-[pupil-fade_0.2s_ease]">
      <div className="border-b border-[var(--border)] pb-4 mb-6">
        <div className="text-[11px] text-[var(--text-3)] font-semibold tracking-wider uppercase mb-1">Configuration</div>
        <h1 className="text-2xl font-bold tracking-tight">Workspace settings</h1>
      </div>

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl divide-y divide-[var(--border)] shadow-sm overflow-hidden select-none">
        
        {/* Toggle Pro */}
        <div className="p-4 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-[var(--text-1)]">Subscription Plan</div>
            <div className="text-[12px] text-[var(--text-3)] mt-0.5">Toggle Pupil Pro workspace status mock.</div>
          </div>
          <button 
            onClick={() => setIsPro(!isPro)}
            className={cn(
              "py-1.5 px-3.5 text-xs font-semibold rounded-lg shadow-sm border transition-colors cursor-pointer",
              isPro 
                ? "bg-amber-500/10 text-amber-600 border-amber-300 dark:text-amber-400 dark:border-amber-500" 
                : "bg-[var(--surface-2)] text-[var(--text-2)] border-[var(--border)] hover:bg-[var(--hover)] hover:text-[var(--text-1)]"
            )}
          >
            {isPro ? 'Pro Status Active' : 'Upgrade to Pro'}
          </button>
        </div>

        {/* Local Storage Flush */}
        <div className="p-4 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-[var(--text-1)]">Clear Local folders</div>
            <div className="text-[12px] text-[var(--text-3)] mt-0.5">Wipe folder assignments for analyzed videos.</div>
          </div>
          <button 
            onClick={() => {
              if (confirm('Clear folder assignments?')) {
                localStorage.removeItem('pupil_folders');
                window.location.reload();
              }
            }}
            className="py-1.5 px-3.5 bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 hover:bg-red-500/25 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
          >
            Clear Assignments
          </button>
        </div>
      </div>
    </div>
  );
}

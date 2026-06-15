"use client";

import * as React from 'react';
import {
  Folder,
  FolderOpen,
  Plus,
  Search,
  Camera,
  ChevronRight,
  Settings,
  Clock,
  PanelLeft,
  MessageSquare,
  Layers,
  RefreshCw,
  File as FileIcon,
  Crown,
  LogOut,
  Sun,
  Moon,
  BookOpen,
  Check,
  Circle,
  LucideIcon
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Gradients for video frame representations (matching the prototype's PFrame)
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

function getFrameGradient(variant?: string): string {
  if (!variant) return frameGradients.slide;
  return frameGradients[variant] || frameGradients.slide;
}

// Pupil Logo Component (Screen-matching design)
export function PupilLogo({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <div className={cn("inline-flex items-center gap-2", className)}>
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className="block shrink-0">
        <ellipse cx="16" cy="16" rx="13.5" ry="9" fill="#D9730D"/>
        <circle cx="16" cy="16" r="6" fill="#1F1E1B"/>
        <circle cx="14.4" cy="14.4" r="1.6" fill="#fff"/>
      </svg>
      <span className="font-semibold tracking-tight text-[var(--text-1)] select-none" style={{ fontSize: size * 0.78 }}>
        Pupil
      </span>
    </div>
  );
}

// Avatar Component — renders an image when available, falls back to initials.
export function PAvatar({
  name = 'MJ',
  color = 'var(--brand-500)',
  size = 28,
  imageUrl,
}: { name?: string; color?: string; size?: number; imageUrl?: string | null }) {
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={name}
        className="shrink-0 rounded-full object-cover select-none"
        style={{ width: size, height: size }}
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <div
      className="shrink-0 rounded-full flex items-center justify-center font-semibold text-white select-none"
      style={{
        width: size,
        height: size,
        backgroundColor: color,
        fontSize: size * 0.42,
      }}
    >
      {name}
    </div>
  );
}

function getInitials(name?: string | null, email?: string | null): string {
  const source = (name || email || 'You').trim();
  const parts = source.split(/[\s@.]+/).filter(Boolean);
  if (parts.length === 0) return 'You';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// Side Bar Props Interface
export interface SidebarUser {
  id: string;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
  video_count?: number;
}

export interface SidebarFolder {
  id: string;
  name: string;
  video_count?: number;
}

export interface SidebarCourseLecture {
  job_id: string;
  lecture_number: number;
  title: string;
  status: string;
}

export interface SidebarCourse {
  id: string;
  title: string;
  status: 'processing' | 'partial' | 'complete' | 'failed';
  total_videos: number;
  processed_videos: number;
  /** Optional drilled-in lecture rows; if absent the row collapses to title + badge. */
  lectures?: SidebarCourseLecture[];
}

export interface SidebarProps {
  activeView: string;
  activeJobId: string | null;
  activeCourseId?: string | null;
  onNav: (view: string, params?: any) => void;
  onNewVideo: () => void;
  onNewCourse?: () => void;
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  jobs: any[];
  isPro?: boolean;
  currentUser?: SidebarUser | null;
  onSignOut?: () => void;
  onOpenProcessing?: (jobId: string) => void;
  folders?: SidebarFolder[];
  courses?: SidebarCourse[];
  onLoadCourseLectures?: (courseId: string) => void;
  onCreateFolder?: () => void;
  onSearch?: (query: string, opts?: { scope?: 'all' | 'course'; courseId?: string }) => void;
  /** When the parent is on a course page, default sidebar search to that course. */
  searchDefaultScope?: 'all' | 'course';
  searchDefaultCourseId?: string | null;
  searchDefaultCourseTitle?: string | null;
  /** Whether the parent has finished its first folders fetch. When false,
   * the sidebar skips the "No folders yet" empty-state to avoid flashing it
   * during the initial async load. */
  foldersLoaded?: boolean;
  onToggleTheme?: () => void;
}

// Sidebar Icon Button Component (Collapsed Mode)
interface SidebarIconBtnProps {
  icon: LucideIcon;
  onClick: () => void;
  active?: boolean;
  title: string;
  pulse?: boolean;
}

function SidebarIconBtn({ icon: IconComp, onClick, active, title, pulse }: SidebarIconBtnProps) {
  return (
    <button 
      onClick={onClick} 
      title={title} 
      className={cn(
        "flex items-center justify-center p-2 rounded-lg transition-all border-none cursor-pointer",
        active ? "bg-[var(--selected)] text-[var(--brand-500)]" : "text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--hover)]",
        pulse && "animate-[pupil-pulse_2.4s_ease-in-out_infinite]"
      )}
      style={{ width: 36, height: 36 }}
    >
      <IconComp size={17} />
    </button>
  );
}

// Sidebar Navigation Item (Expanded Mode)
interface NavItemProps {
  icon: LucideIcon;
  label: string;
  badge?: string | number;
  active?: boolean;
  pulse?: boolean;
  onClick: () => void;
}

function NavItem({ icon: IconComp, label, badge, active, pulse, onClick }: NavItemProps) {
  return (
    <button 
      onClick={onClick} 
      className={cn(
        "w-full flex items-center gap-2.5 py-1.5 px-2.5 rounded-md text-left text-[13.5px] transition-all border-none select-none cursor-pointer",
        active ? "bg-[var(--selected)] text-[var(--brand-500)] font-medium" : "text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--hover)]"
      )}
    >
      <IconComp size={15} className="shrink-0" />
      <span className="flex-1 truncate">{label}</span>
      {badge !== undefined && badge !== null && (
        <span 
          className={cn(
            "text-[10.5px] font-semibold px-1.5 py-0.5 rounded-full min-w-[18px] text-center",
            pulse 
              ? "bg-[var(--brand-500)] text-white animate-[pupil-pulse_2.4s_ease-in-out_infinite]" 
              : "bg-[var(--surface-2)] text-[var(--text-2)]"
          )}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

// Course Entry Component — collapsible course with lecture children
interface CourseEntryProps {
  course: SidebarCourse;
  expanded: boolean;
  onToggle: () => void;
  onOpenCourse: (id: string) => void;
  onOpenLecture: (jobId: string) => void;
  activeCourseId: string | null;
  activeJobId: string | null;
}

function CourseEntry({
  course,
  expanded,
  onToggle,
  onOpenCourse,
  onOpenLecture,
  activeCourseId,
  activeJobId,
}: CourseEntryProps) {
  const isCourseActive = activeCourseId === course.id;
  const pct = course.total_videos > 0
    ? Math.min(100, Math.round((course.processed_videos / course.total_videos) * 100))
    : 0;
  const showShortList = (course.lectures || []).slice(0, expanded ? 999 : 5);

  return (
    <div className="flex flex-col">
      <div
        className={cn(
          "w-full flex items-center gap-1.5 py-1 px-2.5 rounded-md text-left text-[13px] transition-all select-none cursor-pointer group",
          isCourseActive
            ? "bg-[var(--selected)] text-[var(--brand-500)] font-medium"
            : "text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--hover)]"
        )}
      >
        <button
          onClick={onToggle}
          title={expanded ? 'Collapse' : 'Expand'}
          className="p-0.5 rounded hover:bg-[var(--hover)] border-none bg-transparent cursor-pointer shrink-0 text-[var(--text-3)]"
        >
          <ChevronRight
            size={12}
            className={cn("transition-transform duration-150", expanded && "rotate-90")}
          />
        </button>
        <button
          onClick={() => onOpenCourse(course.id)}
          className="flex-1 min-w-0 flex items-center gap-1.5 text-left border-none bg-transparent cursor-pointer p-0"
        >
          <BookOpen size={14} className="shrink-0 text-[var(--brand-500)]" />
          <span className="flex-1 truncate font-medium">{course.title}</span>
          <span
            className={cn(
              "text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0",
              course.status === 'complete'
                ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400"
                : course.status === 'failed'
                  ? "bg-red-500/12 text-red-500"
                  : "bg-[var(--brand-500)]/10 text-[var(--brand-500)]"
            )}
          >
            {course.processed_videos}/{course.total_videos}
          </span>
        </button>
      </div>

      {/* Progress bar under the course row */}
      <div className="h-[2px] mx-2.5 mb-1 bg-[var(--surface-3)] rounded-full overflow-hidden">
        <div
          className="h-full bg-[var(--brand-500)] transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>

      {expanded && (
        <div className="pl-5 flex flex-col gap-0.5 mb-1.5">
          {(course.lectures || []).length === 0 && (
            <div className="px-2.5 py-1 text-[11px] text-[var(--text-3)] italic">
              Loading lectures…
            </div>
          )}
          {showShortList.map((lec) => {
            const isActive = activeJobId === lec.job_id;
            return (
              <button
                key={lec.job_id}
                onClick={() => onOpenLecture(lec.job_id)}
                className={cn(
                  "w-full flex items-center gap-1.5 py-1 px-2.5 rounded-md text-left text-[12.5px] transition-all border-none select-none cursor-pointer bg-transparent",
                  isActive
                    ? "bg-[var(--selected)] text-[var(--brand-500)] font-medium"
                    : "text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--hover)]"
                )}
                title={lec.title}
              >
                <LectureStatusIcon status={lec.status} />
                <span className="font-mono text-[10px] text-[var(--text-3)] shrink-0">
                  L{lec.lecture_number}
                </span>
                <span className="flex-1 truncate">{lec.title || 'Untitled lecture'}</span>
              </button>
            );
          })}
          {!expanded && (course.lectures || []).length > 5 && (
            <button
              onClick={() => onOpenCourse(course.id)}
              className="text-[11px] text-[var(--text-3)] hover:text-[var(--text-1)] px-2.5 py-1 text-left border-none bg-transparent cursor-pointer"
            >
              + {course.lectures!.length - 5} more lectures
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function LectureStatusIcon({ status }: { status: string }) {
  if (status === 'complete') {
    return <Check size={12} className="shrink-0 text-emerald-500" />;
  }
  if (status === 'error' || status === 'failed') {
    return <Circle size={11} className="shrink-0 text-red-500" />;
  }
  if (status && status !== 'queued') {
    return <RefreshCw size={11} className="shrink-0 text-[var(--brand-500)] animate-spin" />;
  }
  return <Circle size={11} className="shrink-0 text-[var(--text-4)]" />;
}

// Folder Entry Component
interface FolderEntryProps {
  name: string;
  items: any[];
  expanded: boolean;
  onToggle: () => void;
  onNav: (view: string, params?: any) => void;
  activeJobId: string | null;
  onOpenProcessing?: (jobId: string) => void;
}

function FolderEntry({ name, items, expanded, onToggle, onNav, activeJobId, onOpenProcessing }: FolderEntryProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <button 
        onClick={onToggle} 
        className="w-full flex items-center gap-1.5 py-1 px-2.5 rounded-md text-left text-[13px] text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--hover)] transition-all border-none select-none cursor-pointer"
      >
        <ChevronRight 
          size={12} 
          className={cn("shrink-0 transition-transform duration-150", expanded && "rotate-90")} 
        />
        {expanded ? (
          <FolderOpen size={14} className="shrink-0 text-[var(--brand-400)]" />
        ) : (
          <Folder size={14} className="shrink-0 text-[var(--brand-400)]" />
        )}
        <span className="flex-1 truncate font-medium">{name}</span>
        <span className="text-[10.5px] text-[var(--text-3)]">{items.length}</span>
      </button>
      {expanded && (
        <div className="pl-4.5 flex flex-col gap-0.5">
          {items.map(item => (
            <PageRow 
              key={item.id} 
              video={item} 
              onNav={onNav} 
              active={item.id === activeJobId} 
              onOpenProcessing={onOpenProcessing}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Individual Video Row Component
interface PageRowProps {
  video: any;
  active?: boolean;
  onNav: (view: string, params?: any) => void;
  onOpenProcessing?: (id: string) => void;
}

function PageRow({ video, active, onNav, onOpenProcessing }: PageRowProps) {
  const isProcessing = video.status !== 'complete' && video.status !== 'error';

  const handleClick = () => {
    if (isProcessing) {
      onOpenProcessing?.(video.id);
    } else {
      onNav('notes', { videoId: video.id });
    }
  };

  return (
    <button 
      onClick={handleClick} 
      className={cn(
        "w-full flex items-center gap-2 py-1 px-2.5 rounded-md text-left text-[12.5px] transition-all border-none select-none cursor-pointer",
        active ? "bg-[var(--selected)] text-[var(--brand-500)] font-medium" : "text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--hover)]"
      )}
    >
      <div className="w-6 h-[18px] rounded-[3px] overflow-hidden shrink-0 relative border border-[var(--border)] bg-zinc-800 flex items-center justify-center">
        {isProcessing ? (
          <RefreshCw size={10} className="text-[var(--brand-500)] animate-spin" />
        ) : video.thumbnail_url ? (
          <img 
            src={video.thumbnail_url} 
            alt="" 
            className="w-full h-full object-cover" 
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        ) : (
          <div className="w-full h-full" style={{ background: getFrameGradient(video.frame || 'slide') }} />
        )}
      </div>
      <span className={cn("flex-1 truncate", isProcessing && "text-[var(--text-3)] italic")}>
        {video.title || 'Analyzing video...'}
      </span>
      {isProcessing && (
        <span className="text-[9px] font-mono font-bold text-[var(--brand-500)] bg-[var(--brand-500)]/10 px-1 rounded select-none shrink-0">
          {Math.round(video.progress || 0)}%
        </span>
      )}
    </button>
  );
}

export function Sidebar({
  activeView,
  activeJobId,
  activeCourseId,
  onNav,
  onNewVideo,
  onNewCourse,
  collapsed,
  setCollapsed,
  jobs,
  isPro = false,
  currentUser,
  onSignOut,
  onOpenProcessing,
  folders = [],
  courses = [],
  onLoadCourseLectures,
  onCreateFolder,
  onSearch,
  searchDefaultScope = 'all',
  searchDefaultCourseId = null,
  searchDefaultCourseTitle = null,
  foldersLoaded = true,
  onToggleTheme,
}: SidebarProps) {
  // Folder expansion states (keyed by folder id)
  const [expandedFolders, setExpandedFolders] = React.useState<Record<string, boolean>>({});
  const [expandedCourses, setExpandedCourses] = React.useState<Record<string, boolean>>({});
  const [searchInput, setSearchInput] = React.useState('');

  const toggleCourse = (courseId: string) => {
    setExpandedCourses((prev) => {
      const next = !prev[courseId];
      if (next) onLoadCourseLectures?.(courseId);
      return { ...prev, [courseId]: next };
    });
  };

  // Jobs that belong to a course should NOT also appear in the unfiled list.
  const jobIdsInCourses = React.useMemo(() => {
    const s = new Set<string>();
    courses.forEach((c) => c.lectures?.forEach((l) => s.add(l.job_id)));
    return s;
  }, [courses]);

  const toggleFolder = (folderId: string) => {
    setExpandedFolders(prev => ({ ...prev, [folderId]: !prev[folderId] }));
  };

  // Group jobs by their server-side folder_id; everything else falls under
  // "unfiled". Errored jobs are hidden from the sidebar.
  const foldersMap = React.useMemo(() => {
    const map: Record<string, any[]> = {};
    const unfiled: any[] = [];
    const knownFolderIds = new Set(folders.map(f => f.id));

    const visibleJobs = jobs.filter(j => j.status !== 'error' && !jobIdsInCourses.has(j.id));
    visibleJobs.forEach(job => {
      const fid = job.folder_id;
      if (fid && knownFolderIds.has(fid)) {
        if (!map[fid]) map[fid] = [];
        map[fid].push(job);
      } else {
        unfiled.push(job);
      }
    });

    return { folders: map, unfiled };
  }, [jobs, folders, jobIdsInCourses]);

  // Last-7-day count for the "Recent" nav badge.
  const recentCount = React.useMemo(() => {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return jobs.filter(j => {
      const t = j.completed_at || j.created_at;
      return t && new Date(t).getTime() >= cutoff;
    }).length;
  }, [jobs]);

  const submitSearch = () => {
    const q = searchInput.trim();
    if (!q) return;
    if (searchDefaultScope === 'course' && searchDefaultCourseId) {
      onSearch?.(q, { scope: 'course', courseId: searchDefaultCourseId });
    } else {
      onSearch?.(q, { scope: 'all' });
    }
  };

  // Compute active/processing jobs
  const activeJobs = React.useMemo(() => {
    return jobs.filter(j => j.status !== 'complete' && j.status !== 'error');
  }, [jobs]);

  // Handlers for search/snap
  const handleSearch = () => {
    onNav('library'); // Or search if supported
    // Dispatch a search hotkey or open modal locally if needed
    const event = new KeyboardEvent('keydown', { key: 'k', metaKey: true });
    window.dispatchEvent(event);
  };

  const handleSnap = () => {
    onNav('snap');
  };

  // ──── COLLAPSED STATE ────
  if (collapsed) {
    return (
      <aside 
        className="w-[56px] bg-[var(--sidebar)] border-r border-[var(--border)] flex flex-col items-center py-3 gap-2 shrink-0 h-screen select-none"
      >
        <button 
          onClick={() => setCollapsed(false)} 
          className="p-1.5 rounded hover:bg-[var(--hover)] text-[var(--text-2)] hover:text-[var(--text-1)] cursor-pointer" 
          title="Expand sidebar"
        >
          <PanelLeft size={18}/>
        </button>
        <button 
          onClick={onNewVideo} 
          className="bg-[var(--brand-500)] text-white hover:bg-[var(--brand-600)] flex items-center justify-center rounded-lg shadow-sm cursor-pointer"
          style={{ width: 36, height: 36 }}
          title="New video"
        >
          <Plus size={16}/>
        </button>
        <SidebarIconBtn icon={Search} onClick={handleSearch} title="Search"/>
        <SidebarIconBtn icon={Camera} onClick={handleSnap} title="Snap & Find"/>
        <div className="w-6 h-[1px] bg-[var(--border)] my-1.5" />
        <SidebarIconBtn icon={FileIcon} onClick={() => onNav('library')} active={activeView === 'library'} title="All pages"/>
        <SidebarIconBtn icon={Layers} onClick={() => onNav('concepts')} active={activeView === 'concepts'} title="Concepts"/>
        <SidebarIconBtn icon={RefreshCw} onClick={() => onNav('resurfacing')} active={activeView === 'resurfacing'} title="Resurfacing" pulse />
        <SidebarIconBtn icon={MessageSquare} onClick={() => onNav('chat')} active={activeView === 'chat'} title="Chat with library"/>
        
        {/* Pulsing indicator for active background tasks */}
        {activeJobs.length > 0 && (
          <button
            onClick={() => onOpenProcessing?.(activeJobs[0].id)}
            className="flex items-center justify-center p-2 rounded-lg bg-[var(--brand-500)]/10 text-[var(--brand-500)] animate-pulse border-none cursor-pointer mt-2"
            title={`Processing ${activeJobs.length} video(s) (${Math.round(activeJobs[0].progress || 0)}%). Click to view.`}
            style={{ width: 36, height: 36 }}
          >
            <RefreshCw size={17} className="animate-spin" />
          </button>
        )}
      </aside>
    );
  }

  // ──── EXPANDED STATE ────
  return (
    <aside 
      className="w-[260px] shrink-0 bg-[var(--sidebar)] border-r border-[var(--border)] flex flex-col h-screen select-none"
    >
      {/* Header */}
      <div className="px-4 py-3.5 flex items-center justify-between shrink-0">
        <PupilLogo size={20}/>
        <button 
          onClick={() => setCollapsed(true)} 
          className="p-1 rounded hover:bg-[var(--hover)] text-[var(--text-3)] hover:text-[var(--text-1)] cursor-pointer" 
          title="Collapse"
        >
          <PanelLeft size={16}/>
        </button>
      </div>

      {/* Main Buttons & Quick Actions */}
      <div className="px-3 pb-2.5 flex flex-col gap-1.5 shrink-0">
        <div className="flex gap-1.5">
          <button
            onClick={onNewVideo}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 bg-[var(--brand-500)] text-white hover:bg-[var(--brand-600)] rounded-lg font-medium text-[13.5px] shadow-sm transition-colors border-none cursor-pointer"
            title="Process a video"
          >
            <Plus size={14}/> Video
          </button>
          {onNewCourse && (
            <button
              onClick={onNewCourse}
              className="flex items-center justify-center gap-1.5 py-2 px-3 bg-[var(--surface-2)] text-[var(--text-1)] hover:bg-[var(--hover)] border border-[var(--border)] rounded-lg font-medium text-[13.5px] transition-colors cursor-pointer"
              title="Process a playlist as a course"
            >
              <BookOpen size={14}/> Course
            </button>
          )}
        </div>
        <div className="w-full flex items-center gap-2 py-1.5 px-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--text-3)] text-[13px] focus-within:border-[var(--brand-500)] transition-colors">
          <Search size={14} className="shrink-0" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); submitSearch(); }
            }}
            placeholder={
              searchDefaultScope === 'course' && searchDefaultCourseTitle
                ? `Search in ${searchDefaultCourseTitle}…`
                : 'Search your videos...'
            }
            className="flex-1 bg-transparent border-none outline-none text-[13px] text-[var(--text-1)] placeholder-[var(--text-3)]"
          />
        </div>
        {searchDefaultScope === 'course' && searchDefaultCourseTitle && (
          <div className="text-[10.5px] text-[var(--text-3)] px-1 -mt-0.5 inline-flex items-center gap-1">
            <BookOpen size={10} className="text-[var(--brand-500)]" />
            <span className="truncate">Scoped to <span className="font-semibold text-[var(--text-2)]">{searchDefaultCourseTitle}</span></span>
          </div>
        )}
        <button 
          onClick={handleSnap} 
          className="w-full flex items-center gap-2 py-1.5 px-2.5 bg-[var(--surface-2)] text-[var(--text-1)] hover:bg-[var(--hover)] rounded-lg text-[13px] font-medium border-none transition-colors cursor-pointer"
        >
          <Camera size={14} className="shrink-0 text-[var(--text-2)]" />
          <span>Snap & Find</span>
        </button>
      </div>

      {/* Navigation Items */}
      <div className="px-2 flex flex-col gap-0.5 shrink-0">
        <NavItem
          icon={FileIcon}
          label="All Videos"
          badge={jobs.filter(j => j.status === 'complete').length}
          active={activeView === 'library'}
          onClick={() => onNav('library')}
        />
        <NavItem
          icon={Clock}
          label="Recent"
          badge={recentCount || undefined}
          active={activeView === 'recent'}
          onClick={() => onNav('recent')}
        />
        <NavItem
          icon={Layers}
          label="Concepts"
          badge="Soon"
          onClick={() => { /* coming soon — intentionally inert */ }}
        />
      </div>

      {/* Divider */}
      <div className="h-[1px] bg-[var(--border)] my-2 mx-4 shrink-0" />

      {/* Scrollable Document Tree (Courses + Folders + Unfiled) */}
      <div className="px-2 flex-1 overflow-y-auto flex flex-col gap-0.5 py-1">
        {/* Courses */}
        {courses.length > 0 && (
          <>
            <div className="flex items-center justify-between px-2.5 py-1 mb-0.5">
              <span className="text-[10px] text-[var(--text-3)] tracking-wider uppercase font-semibold">Courses</span>
              {onNewCourse && (
                <button
                  onClick={onNewCourse}
                  className="text-[var(--text-3)] hover:text-[var(--text-1)] p-0.5 rounded hover:bg-[var(--hover)] cursor-pointer border-none bg-transparent"
                  title="New course"
                >
                  <Plus size={12}/>
                </button>
              )}
            </div>
            {courses.map((c) => (
              <CourseEntry
                key={c.id}
                course={c}
                expanded={!!expandedCourses[c.id]}
                onToggle={() => toggleCourse(c.id)}
                onOpenCourse={(id) => onNav('course', { courseId: id })}
                onOpenLecture={(jobId) => onNav('notes', { jobId })}
                activeCourseId={activeCourseId || null}
                activeJobId={activeJobId}
              />
            ))}
            <div className="h-[1px] bg-[var(--border)] my-2 mx-1 shrink-0" />
          </>
        )}

        {/* Folders Header */}
        <div className="flex items-center justify-between px-2.5 py-1 mb-0.5">
          <span className="text-[10px] text-[var(--text-3)] tracking-wider uppercase font-semibold">Folders</span>
          <button
            onClick={onCreateFolder}
            className="text-[var(--text-3)] hover:text-[var(--text-1)] p-0.5 rounded hover:bg-[var(--hover)] cursor-pointer border-none bg-transparent"
            title="New folder"
          >
            <Plus size={12}/>
          </button>
        </div>

        {/* Skeleton folder rows while the first fetch is in flight. */}
        {!foldersLoaded && folders.length === 0 && (
          <div className="flex flex-col gap-1 px-2.5 py-1">
            {[0, 1].map((i) => (
              <div
                key={i}
                className="h-4 rounded bg-[var(--surface-2)] animate-pulse"
                style={{ width: i === 0 ? '70%' : '50%', animationDelay: `${i * 80}ms` }}
              />
            ))}
          </div>
        )}

        {/* Render Folder Entries — empty state hidden until first fetch resolves */}
        {foldersLoaded && folders.length === 0 && (
          <div className="px-2.5 py-2 text-[11.5px] text-[var(--text-3)] italic">
            No folders yet — click + to create one.
          </div>
        )}
        {folders.map((folder) => (
          <FolderEntry
            key={folder.id}
            name={folder.name}
            items={foldersMap.folders[folder.id] || []}
            expanded={!!expandedFolders[folder.id]}
            onToggle={() => toggleFolder(folder.id)}
            onNav={onNav}
            activeJobId={activeJobId}
            onOpenProcessing={onOpenProcessing}
          />
        ))}

        {/* Unfiled Header — collapse queued-but-not-started jobs into a single
            "+N queued" row so the sidebar doesn't fill with N blank "Untitled
            analysis" entries when a course-worth of work is waiting. */}
        {foldersMap.unfiled.length > 0 && (() => {
          const showable = foldersMap.unfiled.filter((j: any) => j.status !== 'queued' || j.title);
          const queuedCount = foldersMap.unfiled.length - showable.length;
          return (
            <>
              <div className="flex items-center px-2.5 py-1 mt-3 mb-0.5">
                <span className="text-[10px] text-[var(--text-3)] tracking-wider uppercase font-semibold">Unfiled</span>
              </div>
              {showable.map((job: any) => (
                <PageRow
                  key={job.id}
                  video={job}
                  onNav={onNav}
                  active={job.id === activeJobId}
                  onOpenProcessing={onOpenProcessing}
                />
              ))}
              {queuedCount > 0 && (
                <div
                  className="px-2.5 py-1 text-[11.5px] text-[var(--text-3)] italic flex items-center gap-1.5 select-none"
                  title={`${queuedCount} videos are queued and will start processing one by one`}
                >
                  <Clock size={11} />
                  <span>+{queuedCount} queued</span>
                </div>
              )}
            </>
          );
        })()}
      </div>

      {/* Background Tasks Card */}
      {activeJobs.length > 0 && (() => {
        const activeJob = activeJobs[0];
        return (
          <div 
            onClick={() => onOpenProcessing?.(activeJob.id)}
            className="mx-3.5 mb-3.5 p-3 bg-[var(--surface-1)] border border-[var(--border)] rounded-lg shadow-sm hover:border-[var(--brand-500)] hover:bg-[var(--hover)] transition-all cursor-pointer select-none"
          >
            <div className="flex items-center justify-between gap-1.5 mb-1.5">
              <span className="text-[11px] font-semibold text-[var(--brand-500)] flex items-center gap-1.5">
                <RefreshCw size={11} className="animate-spin shrink-0" />
                Analyzing video...
              </span>
              <span className="text-[11px] font-mono font-bold text-[var(--text-1)]">
                {Math.round(activeJob.progress || 0)}%
              </span>
            </div>
            
            <div className="text-[11.5px] font-medium text-[var(--text-1)] truncate mb-1.5" title={activeJob.title}>
              {activeJob.title || 'Untitled Video'}
            </div>

            <div className="h-1 bg-[var(--surface-3)] rounded-full overflow-hidden">
              <div 
                className="h-full bg-[var(--brand-500)] rounded-full transition-all duration-300"
                style={{ width: `${activeJob.progress || 0}%` }}
              />
            </div>
            
            <div className="text-[10px] text-[var(--text-3)] mt-1.5 flex justify-between">
              <span className="truncate max-w-[170px]" title={activeJob.stage_detail || undefined}>
                {activeJob.stage_detail
                 || (activeJob.status === 'downloading' ? 'Downloading video...'
                 : activeJob.status === 'transcribing' ? 'Extracting transcript...'
                 : activeJob.status === 'capturing' ? 'Capturing key frames...'
                 : activeJob.status === 'reading' ? 'Analyzing visual content...'
                 : activeJob.status === 'writing' ? 'Synthesising notes...'
                 : 'Queued...')}
              </span>
              {activeJobs.length > 1 && (
                <span className="font-semibold text-[var(--brand-500)] shrink-0">
                  +{activeJobs.length - 1} more
                </span>
              )}
            </div>
          </div>
        );
      })()}

      {/* Footer / User Profile */}
      <div className="px-3.5 py-3 border-t border-[var(--border)] flex items-center gap-2 shrink-0 bg-[var(--sidebar)]">
        <PAvatar
          name={getInitials(currentUser?.name, currentUser?.email)}
          color="var(--brand-500)"
          imageUrl={currentUser?.avatar_url}
        />
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold truncate text-[var(--text-1)]">
            {currentUser?.name || currentUser?.email || 'Signed in'}
          </div>
          <div className="text-[11px] text-[var(--text-3)] flex items-center gap-1">
            {isPro ? (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-[var(--brand-500)]">
                <Crown size={10}/> Pro
              </span>
            ) : (
              <span className="text-[10px] font-semibold">Free · {jobs.filter(j => j.status === 'complete').length}/5</span>
            )}
          </div>
        </div>
        {onToggleTheme && (
          <button
            onClick={onToggleTheme}
            className="text-[var(--text-3)] hover:text-[var(--text-1)] p-1 rounded hover:bg-[var(--hover)] transition-colors border-none cursor-pointer bg-transparent"
            title="Toggle theme"
          >
            <Sun size={15} className="dark:hidden block"/>
            <Moon size={15} className="hidden dark:block"/>
          </button>
        )}
        <button
          onClick={() => onNav('settings')}
          className="text-[var(--text-3)] hover:text-[var(--text-1)] p-1 rounded hover:bg-[var(--hover)] transition-colors border-none cursor-pointer bg-transparent"
          title="Settings"
        >
          <Settings size={15}/>
        </button>
        {onSignOut && (
          <button
            onClick={onSignOut}
            className="text-[var(--text-3)] hover:text-[var(--text-1)] p-1 rounded hover:bg-[var(--hover)] transition-colors border-none cursor-pointer bg-transparent"
            title="Sign out"
          >
            <LogOut size={15}/>
          </button>
        )}
      </div>
    </aside>
  );
}

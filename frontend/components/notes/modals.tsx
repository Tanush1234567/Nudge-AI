"use client";

import * as React from 'react';
import {
  X,
  Youtube,
  Sparkles,
  Check,
  Loader2,
  Bell,
  Crown,
  Download,
  FileText,
  Image,
  Layers,
  Edit3,
  Clock,
  Eye,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getJobStatus } from '@/lib/api';
import { JobStatus } from '@/lib/types';

// ─── Modal Shell ─────────────────────────────────────────────────────────────

interface ModalShellProps {
  onClose: () => void;
  width?: number;
  children: React.ReactNode;
}

export function ModalShell({ onClose, width = 480, children }: ModalShellProps) {
  React.useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-md flex items-center justify-center p-6 animate-fade-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full bg-[var(--surface-1)] border border-[var(--border)] rounded-2xl shadow-2xl relative animate-scale-up"
        style={{ maxWidth: width }}
      >
        {children}
      </div>
    </div>
  );
}

// ─── New Video Modal ─────────────────────────────────────────────────────────

interface NewVideoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStart: (url: string, folderId: string | null) => Promise<void>;
  initialUrl?: string;
  folders?: { id: string; name: string }[];
  /** Called when the user clicks "Process as Course" in the playlist banner. */
  onProcessAsCourse?: (url: string) => void;
}

// Extract a YouTube video id from any of the common URL shapes. Returns null
// if the input doesn't look like a YouTube link yet — used for inline preview.
function extractYouTubeId(raw: string): string | null {
  const url = raw.trim();
  if (!url) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/,
    /^([A-Za-z0-9_-]{11})$/,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return m[1];
  }
  return null;
}

export function NewVideoModal({
  isOpen,
  onClose,
  onStart,
  initialUrl = '',
  folders = [],
  onProcessAsCourse,
}: NewVideoModalProps) {
  const [url, setUrl] = React.useState('');
  const [folderId, setFolderId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (isOpen) {
      setUrl(initialUrl);
      setFolderId(null);
      setError(null);
      setLoading(false);
    }
  }, [isOpen, initialUrl]);

  const videoId = React.useMemo(() => extractYouTubeId(url), [url]);
  const isValid = !!videoId;
  const thumbnail = videoId ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` : null;
  const isPartOfPlaylist = React.useMemo(() => /[?&]list=/.test(url), [url]);

  if (!isOpen) return null;

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setUrl(text.trim());
    } catch {
      // Clipboard unavailable — ignore silently.
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || loading) return;
    if (!isValid) {
      setError("That doesn't look like a YouTube URL. Paste a link from youtube.com or youtu.be.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await onStart(url.trim(), folderId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start video analysis.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalShell onClose={onClose} width={520}>
      {/* Header */}
      <div className="px-6 pt-6 pb-4 flex items-start justify-between gap-3 border-b border-[var(--border)]">
        <div className="flex items-start gap-3 min-w-0">
          <div className="shrink-0 w-9 h-9 rounded-lg bg-[var(--brand-500)]/12 text-[var(--brand-500)] flex items-center justify-center">
            <Sparkles size={17} />
          </div>
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold tracking-tight text-[var(--text-1)] leading-tight">
              Add a video to your library
            </h2>
            <p className="text-[12px] text-[var(--text-3)] leading-relaxed mt-0.5">
              Paste a YouTube link — Pupil extracts the equations, code, and diagrams on screen.
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          disabled={loading}
          className="p-1 rounded hover:bg-[var(--hover)] text-[var(--text-3)] hover:text-[var(--text-1)] transition-colors border-none bg-transparent disabled:opacity-50 cursor-pointer shrink-0"
          title="Close"
        >
          <X size={16} />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="px-6 pt-5 pb-6">
        {/* URL input */}
        <label className="block">
          <span className="text-[11px] text-[var(--text-3)] uppercase tracking-wider font-semibold">YouTube URL</span>
          <div
            className={cn(
              "mt-1.5 flex items-center gap-2.5 p-3 bg-[var(--bg)] border rounded-xl shadow-inner transition-colors",
              isValid
                ? "border-[var(--brand-500)] focus-within:border-[var(--brand-500)]"
                : url
                  ? "border-amber-500/40"
                  : "border-[var(--border)] focus-within:border-[var(--border-strong)]"
            )}
          >
            <Youtube size={16} className="text-red-500 shrink-0" />
            <input
              autoFocus
              type="text"
              disabled={loading}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onPaste={(e) => {
                const text = e.clipboardData.getData('text');
                if (text) {
                  e.preventDefault();
                  setUrl(text.trim());
                }
              }}
              placeholder="https://youtube.com/watch?v=…"
              className="flex-1 border-none outline-none bg-transparent font-sans text-[13.5px] text-[var(--text-1)] placeholder-[var(--text-3)] disabled:opacity-60 min-w-0"
            />
            {url ? (
              !loading && (
                <button
                  type="button"
                  onClick={() => setUrl('')}
                  className="p-1 rounded hover:bg-[var(--hover)] text-[var(--text-3)] border-none bg-transparent cursor-pointer"
                  title="Clear"
                >
                  <X size={12} />
                </button>
              )
            ) : (
              <button
                type="button"
                onClick={handlePaste}
                className="text-[11px] font-semibold text-[var(--brand-500)] hover:text-[var(--brand-600)] border-none bg-transparent px-1.5 py-0.5 rounded cursor-pointer"
                title="Paste from clipboard"
              >
                Paste
              </button>
            )}
          </div>
          {url && !isValid && (
            <div className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-amber-600 dark:text-amber-400">
              <AlertCircle size={11} />
              <span>Doesn't look like a YouTube link.</span>
            </div>
          )}
        </label>

        {/* Playlist nudge — this URL has a `list=` param */}
        {isPartOfPlaylist && onProcessAsCourse && (
          <div className="mt-3 flex items-start gap-2.5 p-3 bg-[var(--brand-500)]/8 border border-[var(--brand-500)]/25 rounded-lg text-[12.5px] text-[var(--text-1)] leading-relaxed">
            <span className="text-[16px] leading-none mt-0.5">🎓</span>
            <div className="flex-1 min-w-0">
              <div>This video is part of a playlist. Process the entire playlist as a course?</div>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onProcessAsCourse(url)}
                  className="text-[12px] font-semibold py-1 px-2.5 rounded-md bg-[var(--brand-500)] hover:bg-[var(--brand-600)] text-white border-none cursor-pointer"
                >
                  Process as Course
                </button>
                <span className="text-[11.5px] text-[var(--text-3)]">or continue with just this video below ↓</span>
              </div>
            </div>
          </div>
        )}

        {/* Inline thumbnail preview */}
        {thumbnail && (
          <div className="mt-3 flex items-center gap-3 p-2.5 bg-[var(--surface-2)] border border-[var(--border)] rounded-lg animate-fade-in">
            <div className="w-20 aspect-[16/9] rounded overflow-hidden bg-zinc-800 shrink-0">
              <img src={thumbnail} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                <Check size={11} /> Valid YouTube video
              </div>
              <div className="text-[10.5px] text-[var(--text-3)] font-mono truncate mt-0.5">
                ID · {videoId}
              </div>
            </div>
          </div>
        )}

        {/* Folder picker */}
        <div className="mt-5">
          <span className="text-[11px] text-[var(--text-3)] uppercase tracking-wider font-semibold">Add to folder</span>
          <div className="mt-1.5 flex items-center gap-2">
            <select
              value={folderId ?? ''}
              disabled={loading}
              onChange={(e) => setFolderId(e.target.value || null)}
              className="flex-1 bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-1)] rounded-lg py-2 px-2.5 text-[13px] outline-none cursor-pointer disabled:opacity-50"
            >
              <option value="">Unfiled</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-[12px] rounded-lg flex items-start gap-2 leading-normal">
            <AlertCircle size={13} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={!isValid || loading}
          className="mt-5 w-full flex items-center justify-center gap-1.5 py-2.5 px-4 bg-[var(--brand-500)] hover:bg-[var(--brand-600)] disabled:opacity-50 disabled:hover:bg-[var(--brand-500)] disabled:cursor-not-allowed text-white rounded-lg font-semibold text-[13.5px] shadow-sm transition-colors border-none cursor-pointer"
        >
          {loading ? (
            <>
              <Loader2 size={14} className="animate-spin" /> Submitting…
            </>
          ) : (
            <>
              <Sparkles size={14} /> Process video
            </>
          )}
        </button>

        {/* Footer meta */}
        <div className="mt-3.5 flex items-center justify-center gap-1.5 text-[11px] text-[var(--text-3)] select-none">
          <Clock size={11} />
          <span>Processing takes 3–5 minutes. You can close this window — your notes will appear in the sidebar.</span>
        </div>
      </form>
    </ModalShell>
  );
}

// ─── Processing Modal ────────────────────────────────────────────────────────

interface ProcessingModalProps {
  isOpen: boolean;
  jobId: string;
  onClose: () => void;
  onDone: () => void;
}

export function ProcessingModal({ isOpen, jobId, onClose, onDone }: ProcessingModalProps) {
  const [job, setJob] = React.useState<JobStatus | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!isOpen || !jobId) return;

    let isMounted = true;
    let pollInterval: NodeJS.Timeout;

    const poll = async () => {
      try {
        const statusData = await getJobStatus(jobId);
        if (!isMounted) return;
        setJob(statusData);

        if (statusData.status === 'complete') {
          clearInterval(pollInterval);
          setTimeout(() => {
            if (isMounted) onDone();
          }, 1000);
        } else if (statusData.status === 'error') {
          clearInterval(pollInterval);
          setError(statusData.error_message || 'An error occurred during analysis.');
        }
      } catch (err) {
        console.error('Error polling status:', err);
        // Don't kill polling for transient network issues
      }
    };

    // Initial check
    poll();

    pollInterval = setInterval(poll, 2000);

    return () => {
      isMounted = false;
      clearInterval(pollInterval);
    };
  }, [isOpen, jobId, onDone]);

  if (!isOpen) return null;

  // Determine stage statuses based on backend pipeline status
  // Backend statuses: 'queued' | 'downloading' | 'capturing' | 'reading' | 'transcribing' | 'writing' | 'complete' | 'error'
  const getStageStatus = (stageKey: string): 'queued' | 'active' | 'done' => {
    if (!job) return 'queued';
    const status = job.status;
    if (status === 'complete') return 'done';
    if (status === 'error') return 'queued'; // Keep simple

    const order = ['queued', 'downloading', 'transcribing', 'capturing', 'reading', 'writing'];
    const currentIdx = order.indexOf(status);
    const stageIdx = order.indexOf(stageKey);

    if (currentIdx > stageIdx) return 'done';
    if (currentIdx === stageIdx) return 'active';
    return 'queued';
  };

  const stages = [
    { key: 'downloading', icon: Download, label: 'Downloading video', detail: job?.status === 'downloading' ? job.stage_detail : undefined },
    { key: 'transcribing', icon: FileText, label: 'Extracting transcript', detail: job?.status === 'transcribing' ? job.stage_detail : undefined },
    { key: 'capturing', icon: Image, label: 'Capturing key frames', detail: job?.status === 'capturing' ? `${job.frames_found || 0} frames found` : undefined },
    { key: 'reading', icon: Sparkles, label: 'Analyzing visual content', detail: job?.status === 'reading' ? (job.stage_detail || 'OCR & diagram parsing') : undefined },
    { key: 'writing', icon: Edit3, label: 'Synthesizing notes', detail: job?.status === 'writing' ? job.stage_detail : undefined },
  ];

  const progress = job?.progress ?? 0;

  return (
    <ModalShell onClose={onClose} width={520}>
      {/* Header */}
      <div className="px-6 pt-6 pb-2.5 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-[22px] rounded-md overflow-hidden shrink-0 relative bg-zinc-800 border border-[var(--border)]">
            <div 
              className="w-full h-full bg-gradient-to-tr from-indigo-900 to-slate-900" 
              style={{ background: 'linear-gradient(135deg, #312e81 0%, #1e1b4b 100%)' }}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-semibold text-[var(--text-1)] truncate">
              {job?.video_title || 'Analyzing video...'}
            </div>
            <div className="text-[11px] text-[var(--text-3)] truncate">
              {job?.video_channel ? `${job.video_channel} · ` : ''}
              {job?.video_duration ? `${Math.floor(job.video_duration / 60)} min` : ''}
            </div>
          </div>
        </div>
        <button 
          onClick={onClose} 
          className="p-1 rounded hover:bg-[var(--hover)] text-[var(--text-3)] hover:text-[var(--text-1)] border-none shrink-0"
        >
          <X size={16} />
        </button>
      </div>

      {/* Progress Bar */}
      <div className="px-6 py-4">
        <div className="flex justify-between mb-2 text-[12.5px]">
          <span className="text-[var(--text-2)] font-medium">
            {error ? 'Analysis Failed' : job?.status === 'complete' ? 'Completed' : 'Processing'}
          </span>
          <span className="font-mono text-[var(--text-1)] font-semibold">{Math.round(progress)}%</span>
        </div>
        <div className="h-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-full overflow-hidden">
          <div 
            className={cn(
              "h-full rounded-full transition-all duration-300",
              error ? "bg-red-500" : "bg-gradient-to-r from-[var(--brand-500)] to-[var(--brand-300)]"
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="mx-6 p-3 bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs rounded-lg select-none mb-4">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Stepper stages */}
      <div className="px-6 py-1.5 flex flex-col">
        {stages.map((s) => {
          const status = getStageStatus(s.key);
          return (
            <div 
              key={s.key} 
              className="flex items-center gap-3.5 py-2.5 border-b border-[var(--border)] last:border-none"
            >
              <div 
                className={cn(
                  "w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-colors duration-250",
                  status === 'done' && "bg-[var(--success-500)] text-white",
                  status === 'active' && "bg-[var(--brand-500)] text-white shadow-sm",
                  status === 'queued' && "bg-[var(--bg)] border border-dashed border-[var(--border-strong)] text-[var(--text-3)]"
                )}
              >
                {status === 'done' ? (
                  <Check size={14} strokeWidth={2.4} />
                ) : status === 'active' ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <s.icon size={13} />
                )}
              </div>
              
              <div className="flex-1 min-w-0">
                <div 
                  className={cn(
                    "text-[13px] transition-colors duration-150",
                    status === 'queued' ? "text-[var(--text-3)] font-normal" : "text-[var(--text-1)] font-semibold"
                  )}
                >
                  {s.label}
                </div>
                {status === 'active' && s.detail && (
                  <div className="text-[11px] text-[var(--text-3)] mt-0.5 animate-pulse">
                    {s.detail}
                  </div>
                )}
              </div>

              {status === 'active' && (
                <span className="text-[11px] text-[var(--brand-500)] font-mono select-none animate-pulse">working…</span>
              )}
              {status === 'done' && (
                <span className="text-[11px] text-[var(--success-500)] font-medium select-none">done</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer Info */}
      <div className="px-6 pb-6 pt-4 flex items-center justify-between border-t border-[var(--border)] mt-4">
        <div className="text-[11.5px] text-[var(--text-3)] select-none">
          {error ? 'Failed' : job?.status === 'complete' ? 'Finished' : `~${Math.max(1, Math.ceil((100 - progress) / 25))} min remaining`}
        </div>
        <button 
          className="flex items-center gap-1.5 bg-[var(--surface-2)] text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--hover)] py-1.5 px-3 rounded-lg text-[12.5px] font-medium border border-[var(--border)] transition-colors cursor-pointer"
        >
          <Bell size={13} /> Email me when ready
        </button>
      </div>
    </ModalShell>
  );
}

// ─── Upgrade Modal ───────────────────────────────────────────────────────────

interface UpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpgrade: () => void;
}

export function UpgradeModal({ isOpen, onClose, onUpgrade }: UpgradeModalProps) {
  const [period, setPeriod] = React.useState<'monthly' | 'annual'>('annual');

  if (!isOpen) return null;

  return (
    <ModalShell onClose={onClose} width={440}>
      <div className="px-6 pt-7 pb-2 text-center">
        <div className="flex justify-center gap-1 mb-4 select-none">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="w-2 h-2 rounded-full bg-[var(--brand-500)]" />
          ))}
        </div>
        <h2 className="text-xl font-bold tracking-tight text-[var(--text-1)] mb-1.5 select-none">You've used all 5 free videos</h2>
        <p className="text-[13px] text-[var(--text-2)] max-w-[340px] mx-auto leading-relaxed select-none">
          Unlock unlimited processing, library search, and daily resurfacing with Pupil Pro.
        </p>
      </div>

      <div className="px-6 py-3 select-none">
        <ul className="flex flex-col gap-2.5">
          {[
            'Unlimited video processing',
            'Semantic search across all videos',
            'Snap & Find — visual search',
            'Daily resurfacing emails',
            'Chat with your library',
            'Export to Obsidian, Notion, Anki',
          ].map((f) => (
            <li key={f} className="flex items-center gap-2.5 text-[13.5px] text-[var(--text-2)]">
              <Check size={14} className="text-[var(--success-500)] shrink-0" strokeWidth={2.4} />
              <span>{f}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="px-6 pb-6 pt-3 select-none">
        <div className="flex p-1 bg-[var(--bg)] border border-[var(--border)] rounded-xl mb-4.5">
          <button 
            type="button"
            onClick={() => setPeriod('monthly')} 
            className={cn(
              "flex-1 py-2 px-3 rounded-lg cursor-pointer text-[13px] transition-all border-none font-medium text-center",
              period === 'monthly' 
                ? "bg-[var(--surface)] text-[var(--text-1)] shadow-sm" 
                : "bg-transparent text-[var(--text-3)]"
            )}
          >
            Monthly · $12/mo
          </button>
          <button 
            type="button"
            onClick={() => setPeriod('annual')} 
            className={cn(
              "flex-1 py-2 px-3 rounded-lg cursor-pointer text-[13px] transition-all border-none font-medium text-center relative",
              period === 'annual' 
                ? "bg-[var(--surface)] text-[var(--text-1)] shadow-sm" 
                : "bg-transparent text-[var(--text-3)]"
            )}
          >
            Annual · $96/yr
            <span className="absolute -top-2 right-2.5 px-1.5 py-0.5 rounded-full bg-[var(--success-500)] text-white text-[8px] font-bold tracking-wide">
              SAVE 33%
            </span>
          </button>
        </div>

        <button 
          onClick={onUpgrade} 
          className="w-full flex items-center justify-center gap-1.5 py-2.5 px-4 bg-[var(--brand-500)] hover:bg-[var(--brand-600)] text-white rounded-lg font-medium text-[13.5px] shadow-sm transition-colors border-none cursor-pointer"
        >
          <Crown size={14} className="text-amber-300 fill-amber-300 shrink-0" /> Upgrade to Pro
        </button>

        <div className="mt-3 text-center">
          <button 
            onClick={onClose} 
            className="text-[12px] text-[var(--text-3)] hover:text-[var(--text-2)] py-1.5 px-3 hover:bg-[var(--hover)] rounded-md transition-colors border-none cursor-pointer bg-transparent"
          >
            Maybe later
          </button>
        </div>

        <div className="mt-2 text-[11px] text-[var(--text-3)] text-center">
          30-day money-back guarantee. Cancel anytime.
        </div>
      </div>
    </ModalShell>
  );
}

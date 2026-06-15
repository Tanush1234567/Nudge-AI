"use client";

import * as React from 'react';
import {
  X,
  BookOpen,
  Youtube,
  Loader2,
  AlertCircle,
  Check,
  Clock,
  Play,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ModalShell } from '@/components/notes/modals';
import { classifyUrl, createCourse } from '@/lib/api';
import type { PlaylistPreview } from '@/lib/types';

type Stage = 'input' | 'loading' | 'preview' | 'starting' | 'started';

interface PlaylistModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after a course is created so the parent can refresh course list. */
  onCreated?: (courseId: string) => void;
  initialUrl?: string;
}

function formatHours(totalSeconds: number): string {
  if (!totalSeconds) return '—';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.round((totalSeconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function PlaylistModal({
  isOpen,
  onClose,
  onCreated,
  initialUrl = '',
}: PlaylistModalProps) {
  const [stage, setStage] = React.useState<Stage>('input');
  const [url, setUrl] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<PlaylistPreview | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [hintFromVideoUrl, setHintFromVideoUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!isOpen) return;
    setStage('input');
    setUrl(initialUrl);
    setError(null);
    setPreview(null);
    setSelected(new Set());
    setHintFromVideoUrl(null);
  }, [isOpen, initialUrl]);

  // When the user pastes a `watch?v=…&list=…` URL, surface the playlist nudge.
  React.useEffect(() => {
    let cancelled = false;
    if (!url || stage !== 'input') return;
    const id = window.setTimeout(async () => {
      try {
        const cls = await classifyUrl(url);
        if (cancelled) return;
        if (cls.type === 'video_in_playlist' && cls.playlist_url) {
          setHintFromVideoUrl(cls.playlist_url);
        } else {
          setHintFromVideoUrl(null);
        }
      } catch {
        // Classification is best-effort UI sugar — silent on failure.
      }
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [url, stage]);

  if (!isOpen) return null;

  const handleFetchPreview = async (overrideUrl?: string) => {
    const target = (overrideUrl ?? url).trim();
    if (!target) return;
    setError(null);
    setStage('loading');
    try {
      // POST /api/courses both creates the course AND returns the playlist
      // metadata. We treat this response as the "preview" — the course is
      // already kicked off in the background. (Per-video deselect is a
      // future API extension; for now, "Process" just closes the modal.)
      const data = await createCourse(target);
      setPreview(data);
      setSelected(new Set(data.videos.map((v) => v.url)));
      setStage('preview');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load playlist');
      setStage('input');
    }
  };

  const handleConfirm = () => {
    setStage('starting');
    // Small UX delay so the state change feels intentional, then settle.
    window.setTimeout(() => {
      setStage('started');
      if (preview?.course_id) onCreated?.(preview.course_id);
    }, 400);
  };

  const toggleVideo = (videoUrl: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(videoUrl)) next.delete(videoUrl);
      else next.add(videoUrl);
      return next;
    });
  };

  const toggleAll = () => {
    if (!preview) return;
    if (selected.size === preview.videos.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(preview.videos.map((v) => v.url)));
    }
  };

  const estimatedMinutes = preview ? Math.max(2, preview.videos.length * 2) : 0;

  return (
    <ModalShell onClose={onClose} width={620}>
      {/* Header */}
      <div className="px-6 pt-6 pb-4 flex items-start justify-between gap-3 border-b border-[var(--border)]">
        <div className="flex items-start gap-3 min-w-0">
          <div className="shrink-0 w-9 h-9 rounded-lg bg-[var(--brand-500)]/12 text-[var(--brand-500)] flex items-center justify-center">
            <BookOpen size={17} />
          </div>
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold tracking-tight text-[var(--text-1)] leading-tight">
              Process a playlist as a course
            </h2>
            <p className="text-[12px] text-[var(--text-3)] leading-relaxed mt-0.5">
              Pupil downloads each video, builds lecture notes, and stitches them into a course-level syllabus.
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-[var(--hover)] text-[var(--text-3)] hover:text-[var(--text-1)] transition-colors border-none bg-transparent cursor-pointer shrink-0"
          title="Close"
        >
          <X size={16} />
        </button>
      </div>

      {/* Body — switch on stage */}
      <div className="px-6 pt-5 pb-6">
        {stage === 'input' && (
          <InputStage
            url={url}
            setUrl={setUrl}
            onSubmit={() => handleFetchPreview()}
            error={error}
            playlistFromVideo={hintFromVideoUrl}
            useFullPlaylist={() => hintFromVideoUrl && handleFetchPreview(hintFromVideoUrl)}
          />
        )}

        {stage === 'loading' && (
          <div className="flex flex-col items-center justify-center py-14 text-[var(--text-3)] text-sm gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-[var(--brand-500)]" />
            <span>Fetching playlist…</span>
          </div>
        )}

        {stage === 'preview' && preview && (
          <PreviewStage
            preview={preview}
            selected={selected}
            onToggle={toggleVideo}
            onToggleAll={toggleAll}
            estimatedMinutes={estimatedMinutes}
            onConfirm={handleConfirm}
            onBack={() => setStage('input')}
          />
        )}

        {stage === 'starting' && (
          <div className="flex flex-col items-center justify-center py-14 text-[var(--text-3)] text-sm gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-[var(--brand-500)]" />
            <span>Starting course…</span>
          </div>
        )}

        {stage === 'started' && preview && (
          <StartedStage
            videoCount={preview.videos.length}
            onClose={onClose}
          />
        )}
      </div>
    </ModalShell>
  );
}

// ─── Stage 1 — URL input ──────────────────────────────────────────────────

function InputStage({
  url,
  setUrl,
  onSubmit,
  error,
  playlistFromVideo,
  useFullPlaylist,
}: {
  url: string;
  setUrl: (v: string) => void;
  onSubmit: () => void;
  error: string | null;
  playlistFromVideo: string | null;
  useFullPlaylist: () => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <label className="block">
        <span className="text-[11px] text-[var(--text-3)] uppercase tracking-wider font-semibold">
          Playlist URL
        </span>
        <div className="mt-1.5 flex items-center gap-2.5 p-3 bg-[var(--bg)] border border-[var(--border)] focus-within:border-[var(--brand-500)] rounded-xl shadow-inner transition-colors">
          <Youtube size={16} className="text-red-500 shrink-0" />
          <input
            autoFocus
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://youtube.com/playlist?list=…"
            className="flex-1 border-none outline-none bg-transparent font-sans text-[13.5px] text-[var(--text-1)] placeholder-[var(--text-3)] min-w-0"
          />
          {url && (
            <button
              type="button"
              onClick={() => setUrl('')}
              className="p-1 rounded hover:bg-[var(--hover)] text-[var(--text-3)] border-none bg-transparent cursor-pointer"
              title="Clear"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </label>

      {playlistFromVideo && (
        <div className="mt-3 p-3 bg-[var(--brand-500)]/8 border border-[var(--brand-500)]/25 rounded-lg flex items-start gap-2 text-[12.5px] text-[var(--text-1)]">
          <BookOpen size={14} className="text-[var(--brand-500)] shrink-0 mt-0.5" />
          <div className="flex-1 leading-relaxed">
            This video is part of a playlist. Process the entire playlist instead?
            <button
              type="button"
              onClick={useFullPlaylist}
              className="ml-2 text-[var(--brand-500)] hover:underline font-semibold border-none bg-transparent cursor-pointer"
            >
              Use playlist
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-3 p-3 bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-[12px] rounded-lg flex items-start gap-2">
          <AlertCircle size={13} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={!url.trim()}
        className="mt-5 w-full flex items-center justify-center gap-1.5 py-2.5 px-4 bg-[var(--brand-500)] hover:bg-[var(--brand-600)] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-semibold text-[13.5px] shadow-sm transition-colors border-none cursor-pointer"
      >
        <BookOpen size={14} /> Preview playlist
      </button>
    </form>
  );
}

// ─── Stage 2 — preview ─────────────────────────────────────────────────────

function PreviewStage({
  preview,
  selected,
  onToggle,
  onToggleAll,
  estimatedMinutes,
  onConfirm,
  onBack,
}: {
  preview: PlaylistPreview;
  selected: Set<string>;
  onToggle: (url: string) => void;
  onToggleAll: () => void;
  estimatedMinutes: number;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const allSelected = selected.size === preview.videos.length;

  return (
    <div>
      {preview.thumbnail && (
        <div className="aspect-[16/9] w-full rounded-lg overflow-hidden bg-zinc-800 mb-3 border border-[var(--border)]">
          <img src={preview.thumbnail} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
        </div>
      )}

      <h3 className="text-[15px] font-semibold tracking-tight text-[var(--text-1)] leading-snug">
        {preview.title}
      </h3>
      <div className="mt-1 text-[12px] text-[var(--text-3)] flex items-center gap-2">
        <span>{preview.total_videos} videos</span>
        <span>·</span>
        <span>{formatHours(preview.total_duration_seconds)}</span>
        <span>·</span>
        <span className="inline-flex items-center gap-1"><Clock size={11} /> ~{estimatedMinutes} min processing</span>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider font-semibold text-[var(--text-3)]">
          Lectures ({selected.size}/{preview.videos.length} selected)
        </span>
        <button
          onClick={onToggleAll}
          className="text-[11.5px] font-semibold text-[var(--brand-500)] hover:text-[var(--brand-600)] border-none bg-transparent cursor-pointer"
        >
          {allSelected ? 'Deselect all' : 'Select all'}
        </button>
      </div>

      <div className="mt-2 max-h-[260px] overflow-y-auto border border-[var(--border)] rounded-lg divide-y divide-[var(--border)] bg-[var(--surface-2)]/40">
        {preview.videos.map((v, idx) => {
          const checked = selected.has(v.url);
          return (
            <label
              key={v.url}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-colors",
                checked ? "" : "opacity-55",
                "hover:bg-[var(--hover)]"
              )}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(v.url)}
                className="shrink-0 accent-[var(--brand-500)] cursor-pointer"
              />
              <div className="w-16 aspect-[16/9] rounded overflow-hidden shrink-0 bg-zinc-800">
                {v.thumbnail ? (
                  <img src={v.thumbnail} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-medium text-[var(--text-1)] truncate">
                  {String(idx + 1).padStart(2, '0')} · {v.title}
                </div>
                {v.duration ? (
                  <div className="text-[11px] text-[var(--text-3)] font-mono mt-0.5">
                    {formatDuration(v.duration)}
                  </div>
                ) : null}
              </div>
            </label>
          );
        })}
      </div>

      <div className="mt-3 text-[11.5px] text-[var(--text-3)] leading-relaxed">
        Note: deselection is visual only for v1 — the backend processes the full playlist. Per-video selection is coming.
      </div>

      <div className="mt-5 flex items-center justify-end gap-2">
        <button
          onClick={onBack}
          className="py-2 px-3.5 bg-[var(--surface-2)] hover:bg-[var(--hover)] border border-[var(--border)] text-[var(--text-1)] rounded-lg text-[13px] font-semibold transition-colors cursor-pointer"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className="py-2 px-4 bg-[var(--brand-500)] hover:bg-[var(--brand-600)] text-white rounded-lg text-[13px] font-semibold shadow-sm transition-colors border-none cursor-pointer"
        >
          Process as course
        </button>
      </div>
    </div>
  );
}

// ─── Stage 3 — started ─────────────────────────────────────────────────────

function StartedStage({
  videoCount,
  onClose,
}: { videoCount: number; onClose: () => void }) {
  return (
    <div className="text-center py-6">
      <div className="w-12 h-12 mx-auto rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center mb-4">
        <Check size={22} />
      </div>
      <h3 className="text-[16px] font-semibold tracking-tight">Course created</h3>
      <p className="text-[12.5px] text-[var(--text-2)] leading-relaxed mt-1.5 max-w-sm mx-auto">
        Processing {videoCount} videos in the background. Lectures will appear in your sidebar as they complete.
      </p>
      <div className="mt-5 h-1.5 w-full bg-[var(--surface-2)] rounded-full overflow-hidden max-w-xs mx-auto">
        <div className="h-full bg-[var(--brand-500)] animate-pulse" style={{ width: '8%' }} />
      </div>
      <button
        onClick={onClose}
        className="mt-6 py-2 px-4 bg-[var(--brand-500)] hover:bg-[var(--brand-600)] text-white rounded-lg text-[13px] font-semibold border-none cursor-pointer"
      >
        Close
      </button>
    </div>
  );
}

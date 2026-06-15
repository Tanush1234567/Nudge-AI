"use client";

/**
 * Classification badge — shows the format × domain Pupil detected for a
 * lecture (e.g. "📐 Math & Science · Lecture"). Renders nothing when no
 * classification is present, so it's safe to drop into headers unconditionally.
 */

import type { ContentClassification } from '@/lib/types';
import { cn } from '@/lib/utils';

const FORMAT_BADGES: Record<string, { emoji: string; label: string }> = {
  lecture: { emoji: "📐", label: "Lecture" },
  tutorial: { emoji: "💻", label: "Tutorial" },
  conference_talk: { emoji: "🎤", label: "Talk" },
  explainer: { emoji: "💡", label: "Explainer" },
  workshop: { emoji: "🛠️", label: "Workshop" },
  discussion: { emoji: "🎙️", label: "Discussion" },
  demo: { emoji: "📦", label: "Demo" },
  documentary: { emoji: "🎬", label: "Documentary" },
  general: { emoji: "📝", label: "Notes" },
};

const DOMAIN_BADGES: Record<string, { emoji: string; label: string }> = {
  math_science: { emoji: "📐", label: "Math & Science" },
  engineering_cs: { emoji: "⚙️", label: "Engineering" },
  business: { emoji: "📊", label: "Business" },
  humanities: { emoji: "📚", label: "Humanities" },
  creative: { emoji: "🎨", label: "Creative" },
  medical: { emoji: "🏥", label: "Medical" },
  legal: { emoji: "⚖️", label: "Legal" },
  general: { emoji: "📝", label: "General" },
};

interface ClassificationBadgeProps {
  classification?: ContentClassification | null;
  className?: string;
}

export function ClassificationBadge({
  classification,
  className,
}: ClassificationBadgeProps) {
  if (!classification) return null;
  const fmt = classification.format || 'general';
  const dom = classification.domain || 'general';
  if (fmt === 'general' && dom === 'general') return null;

  const fmtBadge = FORMAT_BADGES[fmt] || FORMAT_BADGES.general;
  const domBadge = DOMAIN_BADGES[dom] || DOMAIN_BADGES.general;

  // Compose "📐 Math & Science · Lecture". Use the domain emoji once at the
  // front and avoid repeating it when the format emoji is identical.
  const showFormatEmoji = fmtBadge.emoji && fmtBadge.emoji !== domBadge.emoji;

  return (
    <span
      title={classification.reasoning || `${domBadge.label} · ${fmtBadge.label}`}
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full",
        "bg-[var(--brand-500)]/10 text-[var(--brand-500)] border border-[var(--brand-500)]/20",
        "select-none whitespace-nowrap",
        className,
      )}
    >
      <span>{domBadge.emoji}</span>
      <span>{domBadge.label}</span>
      <span className="opacity-50">·</span>
      {showFormatEmoji && <span>{fmtBadge.emoji}</span>}
      <span>{fmtBadge.label}</span>
    </span>
  );
}

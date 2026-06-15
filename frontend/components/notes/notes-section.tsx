import * as React from 'react';
import { SectionMarker } from '@/components/shared/section-marker';
import { Play, Code, Copy, Check, Sparkles } from 'lucide-react';
import { NoteSection, Visual } from '@/lib/types';
import { CapturedFrame } from '@/components/ui/captured-frame';
import { Tag } from '@/components/ui/tag';
import { EquationBlock } from '@/components/notes/equation-block';
import { MermaidDiagram } from '@/components/notes/mermaid-diagram';
import { RichContent } from '@/components/notes/rich-content';

interface NotesSectionProps {
  section: NoteSection;
  videoId: string;
}

export function NotesSection({ section, videoId }: NotesSectionProps) {
  return (
    <section className="mt-11">
      <div className="flex items-start gap-3 mb-5">
        <SectionMarker number={section.number} />
        <div className="flex-1">
          <div className="flex items-center justify-between gap-4 mb-2">
            <h2 className="text-[22px] font-bold tracking-tight text-text-1">{section.title}</h2>
            <a 
              href={`https://youtube.com/watch?v=${videoId}&t=${section.timestamp_seconds}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[12px] text-text-3 flex items-center gap-1 bg-surface-2 px-2 py-1 rounded-md hover:text-brand-500 transition-colors shrink-0"
            >
              <Play className="w-2.5 h-2.5" />
              {formatTime(section.timestamp_seconds)}
            </a>
          </div>
          
          <RichContent
            className="text-[15px] leading-relaxed text-text-1 prose dark:prose-invert max-w-none"
            html={section.content_html}
          />

          {section.key_takeaway && (
            <div className="mt-4 p-4 bg-brand-500/5 dark:bg-brand-500/10 border border-brand-500/20 rounded-xl flex items-start gap-3 select-none">
              <span className="text-lg leading-none mt-0.5">💡</span>
              <div>
                <div className="text-[11px] font-bold text-brand-500 uppercase tracking-wider mb-1">Key Takeaway</div>
                <p className="text-[14px] leading-relaxed text-text-1 font-medium select-text">{section.key_takeaway}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="ml-9 space-y-6">
        {section.visuals.map((visual, i) => (
          <VisualDispatcher key={visualKey(visual, i)} visual={visual} />
        ))}
      </div>
    </section>
  );
}

function CodeBlockComponent({ visual }: { visual: Extract<Visual, { type: 'code_block' }> }) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(visual.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 select-none">
        <Tag kind="coral" icon={<Code className="w-2.5 h-2.5" />}>Code from screen</Tag>
        {(visual.explanation || visual.caption) && <span className="text-[11.5px] text-text-3 font-medium">{visual.explanation || visual.caption}</span>}
      </div>
      <div className="relative group">
        <div className="absolute top-3 right-4 text-[10px] font-mono text-text-4 uppercase tracking-widest select-none">{visual.language}</div>
        <button 
          onClick={handleCopy}
          className="absolute bottom-3 right-4 p-2 rounded bg-surface-1 border border-default opacity-0 group-hover:opacity-100 hover:bg-[var(--hover)] hover:border-[var(--border-strong)] transition-all cursor-pointer shadow-sm select-none"
          title="Copy code"
        >
          {copied ? (
            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
              <Check className="w-3.5 h-3.5" /> Copied
            </span>
          ) : (
            <Copy className="w-3.5 h-3.5 text-text-2" />
          )}
        </button>
        <pre className="bg-[#18181b] dark:bg-[#09090b] border border-zinc-850 border-l-4 border-l-brand-500 rounded-xl p-5 font-mono text-[13px] leading-relaxed overflow-x-auto text-zinc-100 shadow-sm">
          <code>{visual.code}</code>
        </pre>
      </div>
    </div>
  );
}

// Deterministic, content-derived key for a visual. Visual objects have no `id`
// field, so we build a stable signature from the visual's own discriminating
// content. The index prefix only guarantees uniqueness for two genuinely
// identical visuals in the same section; it never uses Math.random().
function visualKey(visual: Visual, i: number): string {
  let sig: string;
  switch (visual.type) {
    case 'captured_frame':
      sig = `frame:${visual.frame_index}:${visual.timestamp_str ?? visual.timestamp_seconds ?? ''}`;
      break;
    case 'ai_diagram':
      sig = `diagram:${visual.mermaid ?? visual.diagram_type ?? ''}`;
      break;
    case 'code_block':
      sig = `code:${visual.language}:${visual.code}`;
      break;
    case 'equation':
      sig = `equation:${visual.latex}`;
      break;
    default:
      sig = 'unknown';
  }
  return `${i}-${visual.type}-${hashString(sig)}`;
}

function hashString(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = (h * 33) ^ input.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

const VisualDispatcher = React.memo(function VisualDispatcher({ visual }: { visual: Visual }) {
  switch (visual.type) {
    case 'captured_frame':
      return (
        <div className="space-y-3">
          <CapturedFrame 
            variant="slide" 
            timestamp={visual.timestamp_str}
            label="Captured at"
            className="rounded-xl flex flex-col items-center justify-center border-dashed border-2 border-default hover:border-[var(--border-strong)] transition-all"
          >
            {visual.image_url ? (
              <img src={visual.image_url} alt={visual.caption} className="w-full h-full object-cover" />
            ) : (
              <div className="flex flex-col items-center justify-center p-6 text-text-2 dark:text-text-1 text-center select-none bg-surface-2/40 w-full h-full">
                <Play className="w-10 h-10 mb-2.5 text-text-3 opacity-60 fill-text-3/10" />
                <span className="text-[14px] font-bold">Video Captured Frame</span>
                <span className="text-[11px] text-text-3 mt-1">Ready to sync at {visual.timestamp_str || '00:00'}</span>
              </div>
            )}
          </CapturedFrame>
          {visual.caption && <p className="text-xs text-text-3 text-center italic">{visual.caption}</p>}
        </div>
      );
    case 'code_block':
      return <CodeBlockComponent visual={visual} />;
    case 'ai_diagram':
      return (
        <MermaidDiagram
          chart={visual.mermaid}
          description={visual.description || visual.caption}
          diagramType={visual.diagram_type}
        />
      );
    case 'equation':
      return (
        <EquationBlock
          latex={visual.latex}
          caption={visual.caption || visual.explanation}
        />
      );
    default:
      return null;
  }
});

function formatTime(seconds: number) {
  const totalSeconds = Math.round(seconds);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

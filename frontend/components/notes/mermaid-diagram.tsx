'use client';

import * as React from 'react';
import { Tag } from '@/components/ui/tag';
import { Sparkles } from 'lucide-react';

interface MermaidDiagramProps {
  chart?: string;
  description?: string;
  diagramType?: string;
}

let _idCounter = 0;

// Initialize mermaid exactly once per page load (module-level guard), instead
// of re-running mermaid.initialize on every component render/instance.
let _mermaidInitialized = false;
async function getMermaid() {
  const mermaid = (await import('mermaid')).default;
  if (!_mermaidInitialized) {
    mermaid.initialize({ startOnLoad: false, theme: 'neutral' });
    _mermaidInitialized = true;
  }
  return mermaid;
}

export function MermaidDiagram({ chart, description, diagramType }: MermaidDiagramProps) {
  const [svg, setSvg] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);
  const idRef = React.useRef(`mermaid-${_idCounter++}`);
  // Track the chart string we last kicked off a render for, so identical input
  // never triggers a redundant async mermaid.render call.
  const renderedChartRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!chart) return;
    if (renderedChartRef.current === chart) return;
    renderedChartRef.current = chart;
    let cancelled = false;

    (async () => {
      try {
        const mermaid = await getMermaid();
        const { svg } = await mermaid.render(idRef.current, chart);
        if (!cancelled) setSvg(svg);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chart]);

  return (
    <div className="border border-strong rounded-xl overflow-hidden bg-surface-1 shadow-sm">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-default bg-surface-2">
        <Tag kind="purple" icon={<Sparkles className="w-2.5 h-2.5" />}>
          {diagramType ? `AI Diagram: ${diagramType}` : 'AI-generated diagram'}
        </Tag>
      </div>
      <div className="p-6 flex items-center justify-center min-h-[160px] bg-white dark:bg-black/10">
        {svg && !failed ? (
          <div
            className="w-full flex justify-center [&_svg]:max-w-full [&_svg]:h-auto"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : failed || !chart ? (
          <div className="flex flex-col items-center justify-center py-6 text-center max-w-lg select-none">
            <div className="w-12 h-12 rounded-full bg-brand-500/10 flex items-center justify-center mb-3">
              <Sparkles className="w-5 h-5 text-brand-500" />
            </div>
            <h4 className="text-sm font-semibold text-text-1 mb-1">{diagramType || 'Conceptual Distribution Map'}</h4>
            <p className="text-xs text-text-3 max-w-[340px] leading-relaxed">
              {description || 'This diagram maps out the relationships and transitions discussed in this section.'}
            </p>
          </div>
        ) : (
          <p className="text-sm text-text-4 animate-pulse">Rendering diagram…</p>
        )}
      </div>
      {chart && description && (
        <div className="px-4 py-2 border-t border-default text-[11.5px] text-text-3 text-center">
          {description}
        </div>
      )}
    </div>
  );
}

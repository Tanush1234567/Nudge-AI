'use client';

import * as React from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

interface EquationBlockProps {
  latex: string;
  caption?: string;
}

export function EquationBlock({ latex, caption }: EquationBlockProps) {
  const html = React.useMemo(() => {
    try {
      return katex.renderToString(latex, {
        displayMode: true,
        throwOnError: false,
        errorColor: 'var(--c-500)',
      });
    } catch {
      return null;
    }
  }, [latex]);

  return (
    <div className="bg-surface-2 border border-default rounded-xl p-6 text-center space-y-3">
      {html ? (
        <div
          className="text-text-1 overflow-x-auto py-2"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="font-mono text-sm text-text-2">{latex}</pre>
      )}
      {caption && <p className="text-xs text-text-3">{caption}</p>}
    </div>
  );
}

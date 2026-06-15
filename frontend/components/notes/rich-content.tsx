'use client';

import * as React from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

/**
 * Renders an HTML string that may contain inline LaTeX math.
 *
 * WHY: section.content_html mixes prose with equations. Wrapping math in
 * delimiters and rendering it with KaTeX turns "d/dt (dL/dx_dot) - dL/dx = 0"
 * into a properly typeset equation instead of ugly monospace text.
 *
 * Supported delimiters:
 *   $$...$$  or  \[...\]   → display (block) math
 *   $...$    or  \(...\)   → inline math
 */

function renderTex(tex: string, display: boolean): string {
  try {
    return katex.renderToString(tex.trim(), {
      displayMode: display,
      throwOnError: false,
      errorColor: 'var(--c-500)',
    });
  } catch {
    return tex; // fall back to the raw text rather than breaking the page
  }
}

function renderMathInHtml(html: string): string {
  let out = html;
  // Display math first so its $$ are consumed before the inline $ pass.
  out = out.replace(/\$\$([\s\S]+?)\$\$/g, (_, t) => renderTex(t, true));
  out = out.replace(/\\\[([\s\S]+?)\\\]/g, (_, t) => renderTex(t, true));
  // Inline math.
  out = out.replace(/\$([^$\n]+?)\$/g, (_, t) => renderTex(t, false));
  out = out.replace(/\\\(([\s\S]+?)\\\)/g, (_, t) => renderTex(t, false));
  return out;
}

interface RichContentProps {
  html: string;
  className?: string;
}

export function RichContent({ html, className }: RichContentProps) {
  const rendered = React.useMemo(() => renderMathInHtml(html ?? ''), [html]);
  return (
    <div
      className={className}
      dangerouslySetInnerHTML={{ __html: rendered }}
    />
  );
}

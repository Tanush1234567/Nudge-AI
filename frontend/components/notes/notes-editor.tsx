'use client';

import * as React from 'react';
import "@mantine/core/styles.css";
import { MantineProvider } from "@mantine/core";
import { BlockNoteSchema, defaultInlineContentSpecs } from "@blocknote/core";
import { useCreateBlockNote, createReactInlineContentSpec } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import { VideoNotes } from "@/lib/types";
import katex from 'katex';
import 'katex/dist/katex.min.css';

// ─── Custom Inline Math ───────────────────────────────────────────────────────
const MathInline = createReactInlineContentSpec(
  {
    type: "math",
    propSchema: {
      latex: { default: "" },
      display: { default: "false" },
    },
    content: "none",
  },
  {
    render: ({ inlineContent }) => {
      const latex = inlineContent.props.latex;
      const display = inlineContent.props.display === "true";
      try {
        const html = katex.renderToString(latex, { displayMode: display, throwOnError: false });
        return (
          <span
            className={display ? "pupil-math-display" : "pupil-math-inline"}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      } catch {
        return <span className="font-mono text-red-500 text-sm">{latex}</span>;
      }
    },
  }
);

// ─── Schema (math inline only — no custom blocks to avoid ProseMirror init issues) ──
const schema = BlockNoteSchema.create({
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    math: MathInline,
  },
});

// ─── Dark-mode detector ───────────────────────────────────────────────────────
function useDarkTheme() {
  const [isDark, setIsDark] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const check = () => setIsDark(document.documentElement.classList.contains('dark'));
    check();
    const obs = new MutationObserver(check);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return isDark;
}

// ─── Inline LaTeX / text parser ───────────────────────────────────────────────
function parseTextToInlineContent(text: string, styles: any = {}): any[] {
  const result: any[] = [];
  let idx = 0;

  while (idx < text.length) {
    const patterns = [
      { re: /\\\[([\s\S]*?)\\\]/g,  display: true  },
      { re: /\\\(([\s\S]*?)\\\)/g,  display: false },
      { re: /\$\$([\s\S]*?)\$\$/g,  display: true  },
      { re: /\$([^$\n]+?)\$/g,      display: false },
    ];

    let best: { index: number; len: number; latex: string; display: boolean } | null = null;
    for (const { re, display } of patterns) {
      re.lastIndex = idx;
      const m = re.exec(text);
      if (m && m.index >= idx) {
        if (!best || m.index < best.index) {
          best = { index: m.index, len: m[0].length, latex: m[1], display };
        }
      }
    }

    if (best) {
      if (best.index > idx) result.push({ type: 'text', text: text.slice(idx, best.index), styles });
      // Skip empty/whitespace-only math captures — `$$ $$` would otherwise
      // render as an empty bordered box.
      if (best.latex.trim()) {
        result.push({ type: 'math', props: { latex: best.latex, display: best.display ? 'true' : 'false' } });
      }
      idx = best.index + best.len;
    } else {
      result.push({ type: 'text', text: text.slice(idx), styles });
      break;
    }
  }

  if (result.length === 0) result.push({ type: 'text', text: '', styles });
  return result;
}

// ─── DOM helpers ──────────────────────────────────────────────────────────────

/** True if element contains ONLY <strong>/<b> children and no plain text */
function isBoldOnly(el: HTMLElement): boolean {
  let hasBold = false;
  for (const c of Array.from(el.childNodes)) {
    if (c.nodeType === Node.TEXT_NODE) {
      if (c.nodeValue?.trim()) return false;
    } else if (c.nodeType === Node.ELEMENT_NODE) {
      const t = (c as HTMLElement).tagName.toLowerCase();
      if (t === 'strong' || t === 'b') hasBold = true;
      else return false;
    }
  }
  return hasBold;
}

/** Extract BlockNote inline content from a DOM node, handling bold/italic/code/links/LaTeX */
function getInlineContent(el: Node, parentStyles: any = {}): any[] {
  const result: any[] = [];
  for (const child of Array.from(el.childNodes)) {
    const styles = { ...parentStyles };
    if (child.nodeType === Node.TEXT_NODE) {
      const txt = child.nodeValue || '';
      if (txt) result.push(...parseTextToInlineContent(txt, styles));
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const c = child as HTMLElement;
      const t = c.tagName.toLowerCase();
      if      (t === 'strong' || t === 'b')              styles.bold = true;
      else if (t === 'em'     || t === 'i')              styles.italic = true;
      else if (t === 'u')                                styles.underline = true;
      else if (t === 's' || t === 'del' || t === 'strike') styles.strike = true;
      else if (t === 'code')                             styles.code = true;
      else if (t === 'br') { result.push({ type: 'text', text: '\n', styles }); continue; }
      else if (t === 'a') {
        const href = c.getAttribute('href') || '';
        result.push({ type: 'link', href, content: getInlineContent(c, styles) });
        continue;
      }
      result.push(...getInlineContent(c, styles));
    }
  }
  if (result.length === 0) result.push({ type: 'text', text: '', styles: {} });
  return result;
}

function hasRealContent(content: any[]): boolean {
  return content.some(c =>
    (c.type === 'text' && c.text.trim().length > 0) ||
     c.type === 'math' || c.type === 'link'
  );
}

// ─── List processor ───────────────────────────────────────────────────────────
function processListEl(ul: HTMLElement, isOrdered: boolean): any[] {
  const blocks: any[] = [];

  for (const child of Array.from(ul.childNodes)) {
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const li = child as HTMLElement;
    if (li.tagName.toLowerCase() !== 'li') continue;

    // Split direct content from nested lists
    const nestedLists: HTMLElement[] = [];
    const directNodes: Node[] = [];
    for (const n of Array.from(li.childNodes)) {
      if (n.nodeType === Node.ELEMENT_NODE) {
        const t = (n as HTMLElement).tagName.toLowerCase();
        if (t === 'ul' || t === 'ol') { nestedLists.push(n as HTMLElement); continue; }
      }
      directNodes.push(n);
    }

    const tmp = document.createElement('div');
    directNodes.forEach(n => tmp.appendChild(n.cloneNode(true)));
    const directText = tmp.textContent?.trim() || '';

    if (directText) {
      if (isBoldOnly(tmp)) {
        // Bold-only list item → H3 sub-heading
        blocks.push({ type: 'heading', props: { level: 3 }, content: getInlineContent(tmp) });
      } else {
        const content = getInlineContent(tmp);
        if (hasRealContent(content)) {
          blocks.push({ type: isOrdered ? 'numberedListItem' : 'bulletListItem', content });
        }
      }
    }

    // Recurse nested lists
    for (const nested of nestedLists) {
      blocks.push(...processListEl(nested, nested.tagName.toLowerCase() === 'ol'));
    }
  }

  return blocks;
}

// ─── Table processor ─────────────────────────────────────────────────────────
function processTableEl(tableEl: HTMLElement): any {
  const rows: any[] = [];
  
  // Count header columns
  const thEls = tableEl.querySelectorAll('thead th, tr:first-child th');
  const headerColCount = thEls.length || tableEl.querySelectorAll('tr:first-child td').length;
  let maxCols = headerColCount || 0;

  const trEls = Array.from(tableEl.querySelectorAll('tr'));

  for (const tr of trEls) {
    const cellEls = Array.from(tr.querySelectorAll('td, th'));
    if (cellEls.length === 0) continue;

    let cells: any[] = [];
    for (const cellEl of cellEls) {
      const text = cellEl.textContent || '';
      if (text.includes('|')) {
        const parts = text.split('|');
        for (const part of parts) {
          cells.push({
            type: 'tableCell',
            props: {
              backgroundColor: 'default',
              textColor: 'default',
              textAlignment: 'left',
            },
            content: [{ type: 'text', text: part.trim(), styles: {} }],
          });
        }
      } else {
        const content = getInlineContent(cellEl);
        cells.push({
          type: 'tableCell',
          props: {
            backgroundColor: 'default',
            textColor: 'default',
            textAlignment: 'left',
          },
          content,
        });
      }
    }

    // Align cells to header count if we have too many split/empty cells
    if (maxCols > 0 && cells.length > maxCols) {
      cells = cells.filter((cell) => {
        const text = cell.content.map((c: any) => c.text || '').join('').trim();
        return text !== '';
      });
      // Pad it back if we filtered too many
      while (cells.length < maxCols) {
        cells.push({
          type: 'tableCell',
          props: {
            backgroundColor: 'default',
            textColor: 'default',
            textAlignment: 'left',
          },
          content: [{ type: 'text', text: '', styles: {} }],
        });
      }
    }

    maxCols = Math.max(maxCols, cells.length);
    rows.push({ cells });
  }

  if (rows.length === 0) return null;

  return {
    type: 'table',
    content: {
      type: 'tableContent',
      columnWidths: Array(maxCols).fill(undefined),
      rows,
    },
  };
}

// ─── HTML → BlockNote blocks ─────────────────────────────────────────────────
function parseHtmlToBlocks(html: string): any[] {
  if (typeof window === 'undefined') return [];
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return processChildren(doc.body);
}

function processChildren(parent: HTMLElement): any[] {
  const blocks: any[] = [];

  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const t = child.nodeValue?.trim() || '';
      if (t) blocks.push({ type: 'paragraph', content: parseTextToInlineContent(t) });
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;

    const el = child as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (!el.textContent?.trim()) continue; // skip empty

    if (/^h[1-6]$/.test(tag)) {
      const level = parseInt(tag[1]) <= 2 ? 2 : 3;
      blocks.push({ type: 'heading', props: { level }, content: getInlineContent(el) });

    } else if (tag === 'pre') {
      // Code: text in content[], language in props
      const codeEl = el.querySelector('code');
      const codeText = (codeEl || el).textContent || '';
      const lang = (codeEl?.className || '').replace(/^language-/, '') || 'text';
      blocks.push({
        type: 'codeBlock',
        props: { language: lang },
        content: [{ type: 'text', text: codeText, styles: {} }],
      });

    } else if (tag === 'ul' || tag === 'ol') {
      blocks.push(...processListEl(el, tag === 'ol'));

    } else if (tag === 'table') {
      const tableBlock = processTableEl(el);
      if (tableBlock) blocks.push(tableBlock);

    } else if (tag === 'p') {
      if (isBoldOnly(el)) {
        blocks.push({ type: 'heading', props: { level: 3 }, content: getInlineContent(el) });
      } else {
        const content = getInlineContent(el);
        if (hasRealContent(content)) blocks.push({ type: 'paragraph', content });
      }

    } else if (tag === 'div' || tag === 'section' || tag === 'article') {
      blocks.push(...processChildren(el));

    } else {
      const content = getInlineContent(el);
      if (hasRealContent(content)) blocks.push({ type: 'paragraph', content });
    }
  }

  return blocks;
}

function getPlaceholderFrameUrl(variant: string, timestamp: string): string {
  const gradients = {
    slide: { from: '#1e293b', to: '#0f172a' },
    chalkboard: { from: '#14532d', to: '#052e16' },
    code: { from: '#1e1b4b', to: '#0f0f23' },
    person: { from: '#4c1d95', to: '#1e1b4b' },
    plot: { from: '#f8fafc', to: '#e2e8f0' },
  };
  const colors = (gradients as any)[variant] || gradients.slide;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450" width="800" height="450">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${colors.from}"/>
        <stop offset="100%" stop-color="${colors.to}"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <rect x="25" y="25" width="750" height="400" fill="none" stroke="white" stroke-width="2" stroke-dasharray="6,6" opacity="0.2" rx="8"/>
    <text x="50%" y="45%" fill="white" font-family="system-ui, -apple-system, sans-serif" font-weight="bold" font-size="28" text-anchor="middle" opacity="0.8">Video Captured Frame</text>
    <text x="50%" y="55%" fill="white" font-family="system-ui, -apple-system, sans-serif" font-size="16" text-anchor="middle" opacity="0.6">Ready to sync at ${timestamp}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// ─── NotesEditor ─────────────────────────────────────────────────────────────
interface NotesEditorProps { notes: VideoNotes }

export function NotesEditor({ notes }: NotesEditorProps) {
  const [blocks, setBlocks] = React.useState<any[] | null>(null);

  React.useEffect(() => {
    let active = true;

    const buildBlocks = async () => {
      const all: any[] = [];

      // ── AI Summary ──────────────────────────────────────────────────────────
      if (notes.summary) {
        all.push({
          type: 'heading',
          props: { level: 2 },
          content: parseTextToInlineContent('📋  AI Summary'),
        });
        const summaryBlocks = notes.summary.trim().startsWith('<')
          ? parseHtmlToBlocks(notes.summary)
          : [{ type: 'paragraph', content: parseTextToInlineContent(notes.summary) }];
        all.push(...summaryBlocks);
      }

      // ── Sections ────────────────────────────────────────────────────────────
      for (const section of notes.sections) {
        const cleanTitle = section.title.replace(/^\d+\.\s*/, '');

        // Section H2 heading
        all.push({
          type: 'heading',
          props: { level: 2 },
          content: parseTextToInlineContent(`${section.number}.  ${cleanTitle}`),
        });

        // Timestamp (if available)
        if (section.timestamp_seconds != null && section.timestamp_seconds > 0) {
          const totalSeconds = Math.round(section.timestamp_seconds);
          const m = Math.floor(totalSeconds / 60);
          const s = totalSeconds % 60;
          all.push({
            type: 'paragraph',
            content: [{ type: 'text', text: `⏱  ${m}:${String(s).padStart(2, '0')}`, styles: { italic: true } }],
          });
        }

        // Section content HTML
        if (section.content_html) {
          all.push(...parseHtmlToBlocks(section.content_html));
        }

        // Visuals
        for (const visual of section.visuals) {
          if (visual.type === 'captured_frame') {
            all.push({
              type: 'image',
              props: {
                url: visual.image_url || getPlaceholderFrameUrl('slide', visual.timestamp_str || '00:00'),
                caption: visual.caption || `Frame at ${visual.timestamp_str || ''}`,
              },
            });
          } else if (visual.type === 'code_block') {
            all.push({
              type: 'codeBlock',
              props: { language: visual.language || 'python' },
              content: [{ type: 'text', text: visual.code, styles: {} }],
            });
            if (visual.explanation) {
              all.push({
                type: 'paragraph',
                content: parseTextToInlineContent(visual.explanation, { italic: true }),
              });
            }
          } else if (visual.type === 'equation') {
            if (visual.latex && visual.latex.trim()) {
              all.push({
                type: 'paragraph',
                content: [{ type: 'math', props: { latex: visual.latex, display: 'true' } }],
              });
            }
            if (visual.explanation) {
              all.push({
                type: 'paragraph',
                content: parseTextToInlineContent(visual.explanation, { italic: true }),
              });
            }
          } else if (visual.type === 'ai_diagram') {
            if (visual.mermaid) {
              all.push({
                type: 'heading',
                props: { level: 3 },
                content: parseTextToInlineContent(`📊  AI Diagram: ${visual.diagram_type || 'Flowchart'}`),
              });
              all.push({
                type: 'codeBlock',
                props: { language: 'mermaid' },
                content: [{ type: 'text', text: visual.mermaid, styles: {} }],
              });
              if (visual.description || visual.caption) {
                all.push({
                  type: 'paragraph',
                  content: parseTextToInlineContent(visual.description || visual.caption || '', { italic: true }),
                });
              }
            } else {
              all.push({
                type: 'callout',
                props: { icon: '📊', backgroundColor: 'default' },
                content: parseTextToInlineContent(`Diagram: ${visual.diagram_type || 'Conceptual Model'}\n\n${visual.caption || visual.description || ''}`),
              });
            }
          }
        }

        // Key takeaway — native BlockNote callout block
        if (section.key_takeaway) {
          all.push({
            type: 'callout',
            props: { icon: '💡', backgroundColor: 'default' },
            content: parseTextToInlineContent(section.key_takeaway),
          });
        }

        // (no spacer paragraph — heading margins handle the breathing room)
      }

      if (active) setBlocks(all);
    };

    if (notes) buildBlocks();
    return () => { active = false; };
  }, [notes]);

  if (!blocks) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-[var(--text-3)] text-sm animate-pulse">Building notes...</p>
      </div>
    );
  }

  return <BlockNoteInnerEditor key={notes.job_id} blocks={blocks} />;
}

// ─── Block sanitisation ────────────────────────────────────────────────────
// BlockNote refuses the whole document if a single block is malformed, so we
// validate each one and drop anything it can't render before mount.
// Note: `callout` is NOT in defaultBlockSpecs in BlockNote v0.51 — we coerce
// callouts to paragraphs (with the icon prefixed) so their content still
// renders without losing information.
const _ALLOWED_BLOCK_TYPES = new Set([
  'paragraph', 'heading', 'bulletListItem', 'numberedListItem',
  'codeBlock', 'image', 'table', 'quote',
]);

function _isValidInlineRun(run: any): boolean {
  if (!run || typeof run !== 'object') return false;
  if (run.type === 'text') return typeof run.text === 'string';
  if (run.type === 'link') return typeof run.href === 'string' && Array.isArray(run.content);
  if (run.type === 'math') {
    const p = run.props || {};
    // Empty math renders as a faint bordered box; drop it.
    return typeof p.latex === 'string' && p.latex.trim().length > 0 && typeof p.display === 'string';
  }
  return false;
}

// Heading blocks: only `level` ∈ {1,2,3}. Strip everything else.
function _sanitizeHeadingProps(props: any): any {
  const lvl = Number(props?.level);
  return { level: lvl >= 1 && lvl <= 3 ? lvl : 2 };
}

function sanitizeBlock(b: any, idx: number): any | null {
  if (!b || typeof b !== 'object' || !b.type) return null;

  // Coerce callouts → paragraph with icon prefixed so no content is lost when
  // the lean lecture schema lacks a callout block spec.
  if (b.type === 'callout') {
    const icon = typeof b.props?.icon === 'string' ? b.props.icon + ' ' : '💡 ';
    const inner: any[] = Array.isArray(b.content) ? b.content.filter(_isValidInlineRun) : [];
    return {
      type: 'paragraph',
      content: [
        { type: 'text', text: icon, styles: { bold: true } },
        ...(inner.length > 0 ? inner : [{ type: 'text', text: '', styles: {} }]),
      ],
    };
  }

  if (!_ALLOWED_BLOCK_TYPES.has(b.type)) {
    console.warn(`[notes-editor] dropping block #${idx}: unknown type "${b.type}"`, b);
    return null;
  }
  // Tables are validated by BlockNote internals; passthrough.
  if (b.type === 'table') return b;
  // Code blocks: strip everything except the text content + language.
  if (b.type === 'codeBlock') {
    const text = b.content?.[0]?.text ?? '';
    return {
      type: 'codeBlock',
      props: { language: String(b.props?.language || 'text') },
      content: [{ type: 'text', text: String(text), styles: {} }],
    };
  }
  // Image: only `url` + `caption` are guaranteed across BlockNote versions.
  if (b.type === 'image') {
    if (typeof b.props?.url !== 'string') {
      console.warn(`[notes-editor] dropping image block #${idx}: missing url`);
      return null;
    }
    return {
      type: 'image',
      props: {
        url: b.props.url,
        caption: typeof b.props.caption === 'string' ? b.props.caption : '',
      },
    };
  }
  // For inline-content blocks, drop unknown props entirely and scrub runs.
  let runs: any[] = Array.isArray(b.content) ? b.content.filter(_isValidInlineRun) : [];

  // Drop whitespace-only paragraphs/quotes — they render as faint empty boxes
  // around real content (e.g. above/below math blocks). Headings + list items
  // are still kept even when empty so editing affordances survive.
  if (b.type === 'paragraph' || b.type === 'quote') {
    const isWhitespaceOnly =
      runs.length === 0 ||
      runs.every((r) => r.type === 'text' && (!r.text || !r.text.trim()));
    if (isWhitespaceOnly) return null;
  }

  if (runs.length === 0) runs = [{ type: 'text', text: '', styles: {} }];

  if (b.type === 'heading') {
    return { type: 'heading', props: _sanitizeHeadingProps(b.props), content: runs };
  }
  // paragraph / bulletListItem / numberedListItem / quote
  return { type: b.type, content: runs };
}

function sanitizeBlocks(blocks: any[]): any[] {
  const out: any[] = [];
  blocks.forEach((b, i) => {
    const s = sanitizeBlock(b, i);
    if (s) out.push(s);
  });
  return out;
}

// ─── BlockNote inner editor ───────────────────────────────────────────────────
// Strategy: mount BlockNote with NO initialContent so the hook can never throw.
// Then, after mount, walk the sanitised blocks and replace the document. If the
// whole-document replace fails, fall back to inserting one block at a time and
// skip any block that still trips BlockNote — so a single bad block can't keep
// the rest of the notes from rendering.
function BlockNoteInnerEditor({ blocks }: { blocks: any[] }) {
  const isDark = useDarkTheme();
  const safeBlocks = React.useMemo(() => sanitizeBlocks(blocks), [blocks]);
  return <BlockNoteMount blocks={safeBlocks} isDark={isDark} />;
}

function BlockNoteMount({ blocks, isDark }: { blocks: any[]; isDark: boolean }) {
  const editor = useCreateBlockNote({ schema });

  React.useEffect(() => {
    if (!editor || !blocks.length) return;

    // Fast path — replace the doc in one shot.
    try {
      editor.replaceBlocks(editor.document, blocks);
      return;
    } catch (err) {
      console.warn(
        '[notes-editor] full replaceBlocks failed; will insert blocks incrementally.',
        err,
      );
    }

    // Slow path — accumulate the longest prefix of blocks the editor accepts.
    const accepted: any[] = [];
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      try {
        editor.replaceBlocks(editor.document, [...accepted, b]);
        accepted.push(b);
      } catch (err) {
        console.warn(`[notes-editor] dropping block #${i}: BlockNote rejected it`, b, err);
      }
    }
    if (accepted.length === 0) {
      console.error(
        '[notes-editor] every block was rejected. Original blocks:', blocks,
      );
    }
  }, [editor, blocks]);

  return (
    <MantineProvider forceColorScheme={isDark ? 'dark' : 'light'}>
      <div className="prose dark:prose-invert max-w-none">
        <BlockNoteView editor={editor} theme={isDark ? 'dark' : 'light'} />
      </div>
    </MantineProvider>
  );
}

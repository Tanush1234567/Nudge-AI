'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { PupilNavbar } from '@/components/layout/pupil-navbar';
import { PupilFooter } from '@/components/layout/pupil-footer';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { ArrowRight, Check, Sigma, Code2, Clock, Tag } from 'lucide-react';

/* ── Scroll-reveal hook ───────────────────────────────────────────── */
function useReveal() {
  React.useEffect(() => {
    const els = document.querySelectorAll('[data-reveal]');
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const el = entry.target as HTMLElement;
            const delay = parseInt(el.dataset.delay || '0', 10);
            setTimeout(() => el.classList.add('reveal-visible'), delay);
            io.unobserve(el);
          }
        });
      },
      { threshold: 0.1 }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

/* ── Custom SVG icons ─────────────────────────────────────────────── */
function IconPaste({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="8" y="2" width="8" height="4" rx="1"/>
      <path d="M8 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2h-2"/>
      <path d="M12 11h4M12 16h4M8 11h.01M8 16h.01"/>
    </svg>
  );
}
function IconVision({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12C3.5 6 7.5 3 12 3s8.5 3 11 9c-2.5 6-6.5 9-11 9S3.5 18 1 12z"/>
      <circle cx="12" cy="12" r="3"/>
      <path d="M12 9v0M12 15v0" strokeWidth="2.5"/>
    </svg>
  );
}
function IconDoc({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <path d="M14 2v6h6M9 13h6M9 17h4"/>
    </svg>
  );
}
function IconBrain({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/>
      <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/>
      <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/>
      <path d="M17.599 6.5a3 3 0 0 0 .399-1.375M6.003 5.125A3 3 0 0 0 6.401 6.5"/>
    </svg>
  );
}
function IconFrame({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="2"/>
      <path d="M7 2v20M17 2v20M2 7h5M2 17h5M17 7h5M17 17h5"/>
    </svg>
  );
}

/* ── Pupil URL input mockup ───────────────────────────────────────── */
function PupilMockup() {
  const [progress, setProgress] = React.useState(0);
  const [phase, setPhase] = React.useState<'idle'|'loading'|'done'>('idle');

  React.useEffect(() => {
    const t1 = setTimeout(() => setPhase('loading'), 1200);
    return () => clearTimeout(t1);
  }, []);

  React.useEffect(() => {
    if (phase !== 'loading') return;
    const interval = setInterval(() => {
      setProgress((p) => {
        if (p >= 100) { clearInterval(interval); setPhase('done'); return 100; }
        return p + 2;
      });
    }, 40);
    return () => clearInterval(interval);
  }, [phase]);

  return (
    <div className="hero-mockup inline-block w-full max-w-[520px]">
      <div
        className="rounded-2xl border border-[rgba(55,53,47,0.12)] bg-white overflow-hidden"
        style={{ boxShadow: '0 8px 40px rgba(0,0,0,0.07), 0 2px 8px rgba(0,0,0,0.04)' }}
      >
        {/* Window chrome */}
        <div className="flex items-center gap-1.5 px-4 py-3 border-b border-[rgba(55,53,47,0.07)] bg-[#fafaf9]">
          <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
          <div className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
          <div className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
          <span className="ml-3 text-[11px] text-[#8a8a86] font-mono">pupil.nudge.live</span>
        </div>

        <div className="p-6">
          {/* URL input */}
          <div className="flex items-center gap-2 p-3 bg-[#f7f7f5] rounded-xl border border-[rgba(55,53,47,0.09)] mb-4">
            <svg className="w-4 h-4 text-red-500 shrink-0" viewBox="0 0 24 24" fill="currentColor">
              <path d="M23 7s-.27-1.8-1.09-2.59c-1.05-1.1-2.22-1.1-2.76-1.17C16.36 3 12 3 12 3s-4.36 0-7.15.24c-.54.07-1.71.07-2.76 1.17C1.27 5.2 1 7 1 7S.73 9.05.73 11.1v1.86C.73 15 1 17 1 17s.27 1.8 1.09 2.59c1.05 1.1 2.22 1.1 2.76 1.17C7.64 21 12 21 12 21s4.36 0 7.15-.24c.54-.07 1.71-.07 2.76-1.17C22.73 18.8 23 17 23 17s.27-2.05.27-4.05V11.1C23.27 9.05 23 7 23 7zM9.73 15.5v-7l6.55 3.5-6.55 3.5z"/>
            </svg>
            <span className="text-[12px] font-mono text-[#4b4b49] flex-1 truncate">
              youtube.com/watch?v=xWQ0_6WFqGY
            </span>
          </div>

          {/* Progress / result */}
          {phase === 'idle' && (
            <div className="h-10 flex items-center justify-center">
              <span className="text-xs text-[#8a8a86]">Paste any YouTube lecture URL…</span>
            </div>
          )}

          {phase === 'loading' && (
            <div className="space-y-2">
              <div className="flex justify-between text-[11px] text-[#8a8a86] mb-1">
                <span>
                  {progress < 30 ? 'Downloading video…'
                    : progress < 60 ? 'Extracting frames with DINOv2…'
                    : progress < 85 ? 'Reading transcript…'
                    : 'Generating notes with Gemini…'}
                </span>
                <span>{progress}%</span>
              </div>
              <div className="h-1.5 bg-[#f7f7f5] rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all duration-100"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {phase === 'done' && (
            <div className="space-y-3">
              <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-xl">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] font-semibold text-emerald-800">Introduction to Neural Networks</p>
                  <span className="text-[10px] text-emerald-600 font-mono">47 min · 13 sections</span>
                </div>
                <p className="text-[11px] text-emerald-700 leading-[1.5]">
                  Covers feedforward networks, backpropagation, and gradient descent. Includes derivation of the chain rule applied to multi-layer networks.
                </p>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {['Backprop','Chain Rule','Gradient Descent','Neural Nets'].map(t => (
                  <span key={t} className="text-[10px] px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 font-medium border border-emerald-100">{t}</span>
                ))}
              </div>
              <div className="flex items-center gap-2 text-[11px] text-[#8a8a86]">
                <Check className="w-3.5 h-3.5 text-emerald-500" />
                <span>8 equations · 4 diagrams · 2 code blocks captured</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Main page ────────────────────────────────────────────────────── */
export default function PupilLandingPage() {
  const router = useRouter();
  useReveal();

  const steps = [
    {
      num: '01',
      icon: IconPaste,
      title: 'Paste a URL',
      desc: 'Drop any YouTube link. Lectures, tutorials, conference talks, playlists — it handles all of them.',
    },
    {
      num: '02',
      icon: IconVision,
      title: 'Frames get extracted',
      desc: 'DINOv2 vision embeddings identify the visually distinct frames — diagrams, slides, whiteboard moments — and skip the duplicates.',
    },
    {
      num: '03',
      icon: IconDoc,
      title: 'Transcript gets read',
      desc: 'The full audio transcript is pulled and sent to Gemini alongside the frames, so it captures both what\'s said and what\'s on screen.',
    },
    {
      num: '04',
      icon: IconBrain,
      title: 'Notes come back',
      desc: 'Structured, timestamped notes with equations in LaTeX, code blocks formatted, diagrams captured. Not a summary — the actual content.',
    },
  ];

  const features = [
    {
      icon: IconFrame,
      title: 'Keyframe extraction',
      desc: 'DINOv2 picks out visually distinct moments — diagrams, slides, whiteboard sketches — and captures them as images in your notes.',
    },
    {
      icon: Sigma,
      title: 'Equation capture',
      desc: 'Mathematical notation is pulled from the screen and converted to LaTeX. No more squinting at blurry whiteboards.',
    },
    {
      icon: Code2,
      title: 'Code block extraction',
      desc: 'Code shown on screen is captured and formatted with syntax highlighting. Exactly as it appeared.',
    },
    {
      icon: Clock,
      title: 'Timestamped sections',
      desc: 'Every section links back to the exact moment in the video. Click to jump straight to the part you need.',
    },
    {
      icon: Tag,
      title: 'Topic tags',
      desc: 'Each section is tagged so you can scan a 2-hour lecture and find the one concept you\'re looking for.',
    },
    {
      icon: IconVision,
      title: 'TL;DW summary',
      desc: 'A plain-English summary at the top so you know what the video actually covers before diving into the notes.',
    },
  ];

  const techItems = [
    {
      icon: IconBrain,
      title: 'Gemini 2.5 Flash',
      desc: 'Multimodal model that reads both the transcript and the visual frames together — so notes capture what\'s on screen, not just what\'s said.',
    },
    {
      icon: IconVision,
      title: 'DINOv2 frame selection',
      desc: 'Self-supervised vision embeddings identify genuinely distinct frames and skip the duplicates. No blurry mid-transition shots in your notes.',
    },
    {
      icon: IconDoc,
      title: 'Full transcript analysis',
      desc: 'The complete audio transcript is processed alongside the frames so nothing that\'s spoken gets missed.',
    },
    {
      icon: Code2,
      title: 'Structured output',
      desc: 'Notes come back as structured data: sections, timestamps, topic tags, LaTeX equations, code blocks, and frame images.',
    },
  ];

  return (
    <div className="min-h-screen bg-[#edf7f0] flex flex-col font-sans landing-body">
      <PupilNavbar />

      {/* ── Hero ──────────────────────────────────────────────────── */}
      <section className="pt-28 pb-16 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <div className="hero-badge inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-xs text-emerald-700 mb-8">
            <span className="live-dot w-1.5 h-1.5 rounded-full bg-emerald-500 block" />
            Live at pupil.nudge.live — try it free
          </div>

          <h1 className="hero-title text-4xl md:text-5xl lg:text-[56px] font-bold tracking-tight leading-[1.1] mb-6 text-[#1a1a19]">
            Paste a lecture.
            <br />Get notes worth keeping.
          </h1>

          <p className="hero-sub text-lg md:text-xl text-[#4b4b49] leading-[1.6] max-w-[560px] mx-auto mb-10">
            Pupil watches the video for you. It reads the transcript, scans every
            frame with vision AI, and gives you structured notes with the actual
            equations, code, and diagrams from the screen. Not a summary — the
            real content.
          </p>

          <div className="hero-cta flex flex-col sm:flex-row items-center justify-center gap-3 mb-5">
            <Button
              size="lg"
              className="shadow-none px-8"
              onClick={() => router.push('/login?mode=signup')}
            >
              Try Pupil free
              <ArrowRight className="w-4 h-4" />
            </Button>
            <Button
              variant="secondary"
              size="lg"
              onClick={() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })}
            >
              See how it works
            </Button>
          </div>

          <p className="hero-note text-sm text-[#8a8a86]">
            2 free full analyses. No card required.
          </p>

          {/* Animated mockup */}
          <div className="mt-14 flex justify-center">
            <PupilMockup />
          </div>
        </div>
      </section>

      {/* ── Social Proof ──────────────────────────────────────────── */}
      <section className="pb-24 px-6">
        <div className="max-w-lg mx-auto flex flex-col items-center gap-3">
          <div className="flex items-center">
            {['RS','TG','AK','JM','LP'].map((n, i) => (
              <div
                key={n}
                className={cn('w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold text-white border-2 border-white', i > 0 && '-ml-2')}
                style={{ backgroundColor: ['#059669','#0d9488','#0891b2','#475569','#64748b'][i] }}
              >
                {n}
              </div>
            ))}
          </div>
          <p className="text-sm text-[#8a8a86]">Tested by students at TU Delft and SPIT Mumbai</p>
        </div>
      </section>

      {/* ── The Problem ───────────────────────────────────────────── */}
      <section className="py-24 px-6 bg-[#f7f7f5] border-y border-[rgba(55,53,47,0.09)]">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-14" data-reveal data-delay="0">
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-600 mb-3">The problem</p>
            <h2 className="text-3xl md:text-[40px] font-bold tracking-tight leading-[1.15] mb-4 text-[#1a1a19]">
              Lectures move fast. Your notes don't.
            </h2>
            <p className="text-[#4b4b49] text-lg leading-[1.6] max-w-[500px] mx-auto">
              You're trying to write, listen, and understand all at once. The diagrams blur past. The equations vanish before you can copy them.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            <Card
              className="card-hover bg-white/60 min-h-[360px] flex flex-col opacity-70"
              data-reveal="left"
              data-delay="100"
            >
              <div className="flex items-center justify-between mb-8">
                <span className="text-[10px] text-[#b5b5b1] font-bold tracking-widest uppercase">Manual notes</span>
                <span className="text-[11px] px-2 py-0.5 rounded-md bg-[#ededeb] text-[#8a8a86]">incomplete</span>
              </div>
              <div className="space-y-4 text-sm text-[#8a8a86] leading-[1.6]">
                <p>You pause every 30 seconds to type. You miss the diagram the professor just drew. The equation on the board is half-cropped when you screenshot it.</p>
                <p>You rewatch a 50-minute lecture for the third time just to find one formula from 23 minutes in.</p>
                <div className="p-3 bg-[#f7f7f5] rounded-lg text-xs text-[#b5b5b1]">Code on screen? Gone before you could read it.</div>
                <div className="p-3 bg-[#f7f7f5] rounded-lg text-xs text-[#b5b5b1]">Diagrams? Screenshot, annotate, lose track of context.</div>
              </div>
            </Card>

            <Card
              className="card-hover border-emerald-500 border-2 min-h-[360px] flex flex-col relative"
              data-reveal="right"
              data-delay="200"
              style={{ boxShadow: '0 4px 24px rgba(5,150,105,0.08)' }}
            >
              <div className="absolute top-4 right-4">
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[10.5px] font-medium rounded-md bg-emerald-50 text-emerald-700">
                  <Check className="w-2.5 h-2.5" />automated
                </span>
              </div>
              <p className="text-xs font-semibold text-emerald-600 mb-3">Pupil</p>
              <h3 className="text-lg font-bold mb-2 text-[#1a1a19]">It watched the lecture for you.</h3>
              <p className="text-xs text-[#8a8a86] mb-5 leading-[1.6]">Every frame, every word — processed before you open the notes.</p>
              <div className="space-y-4 text-sm text-[#1a1a19] leading-[1.6]">
                <p>Pupil extracted 13 sections from the Group Theory lecture. It captured the octagon permutation diagram, the homomorphism mapping, and Cayley's theorem proof — all from the screen.</p>
                <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-lg">
                  <p className="text-xs font-medium text-emerald-800 mb-1">From 23:14 — Cayley's Theorem</p>
                  <p className="text-xs text-emerald-700 leading-[1.6]">Every group G is isomorphic to a subgroup of the symmetric group acting on G. Proof constructs φ: G → Sₘ by left multiplication.</p>
                </div>
                <div className="flex items-start gap-3 p-3 bg-[#f7f7f5] border border-[rgba(55,53,47,0.09)] rounded-lg">
                  <span className="text-emerald-600 text-base font-bold shrink-0 mt-0.5">Σ</span>
                  <div>
                    <p className="text-[11px] font-mono text-[#4b4b49] mb-1">φ(a) = πₐ where πₐ(g) = ag</p>
                    <p className="text-[10px] text-[#8a8a86]">Equation captured from screen · 23:14</p>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </section>

      {/* ── How It Works ──────────────────────────────────────────── */}
      <section id="how-it-works" className="py-24 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-14" data-reveal data-delay="0">
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-600 mb-3">How it works</p>
            <h2 className="text-3xl md:text-[38px] font-bold tracking-tight leading-[1.15] text-[#1a1a19]">
              Four steps. Five minutes. Real notes.
            </h2>
          </div>

          <div className="grid md:grid-cols-4 gap-5">
            {steps.map((step, i) => (
              <Card
                key={step.title}
                className="card-hover bg-white p-6"
                data-reveal
                data-delay={String(i * 100)}
              >
                <div className="flex items-start justify-between mb-5">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center"
                    style={{ backgroundColor: 'rgba(5,150,105,0.08)', color: '#059669' }}
                  >
                    <step.icon className="w-5 h-5" />
                  </div>
                  <span className="text-2xl font-bold text-[rgba(55,53,47,0.07)] leading-none select-none">{step.num}</span>
                </div>
                <h3 className="text-base font-bold mb-2 text-[#1a1a19]">{step.title}</h3>
                <p className="text-sm text-[#4b4b49] leading-[1.6]">{step.desc}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ──────────────────────────────────────────────── */}
      <section className="py-24 px-6 bg-[#f7f7f5] border-y border-[rgba(55,53,47,0.09)]">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-14" data-reveal data-delay="0">
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-600 mb-3">What you get</p>
            <h2 className="text-3xl md:text-[38px] font-bold tracking-tight leading-[1.15] text-[#1a1a19]">
              More than a transcript. Actual notes.
            </h2>
          </div>
          <div className="grid md:grid-cols-2 gap-5">
            {features.map((f, i) => (
              <Card
                key={f.title}
                className="card-hover bg-white p-6 flex gap-4"
                data-reveal
                data-delay={String((i % 2) * 100)}
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                  style={{ backgroundColor: 'rgba(5,150,105,0.08)', color: '#059669' }}
                >
                  <f.icon className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold mb-1 text-[#1a1a19]">{f.title}</h3>
                  <p className="text-sm text-[#4b4b49] leading-[1.6]">{f.desc}</p>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ── Sample Output ─────────────────────────────────────────── */}
      <section className="py-24 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="grid md:grid-cols-2 gap-14 items-center">
            <div data-reveal="left" data-delay="0">
              <p className="text-xs font-semibold uppercase tracking-widest text-emerald-600 mb-3">Real output</p>
              <h2 className="text-3xl md:text-[36px] font-bold tracking-tight leading-[1.15] mb-5 text-[#1a1a19]">
                See what Pupil actually produces.
              </h2>
              <p className="text-[#4b4b49] text-base leading-[1.6] mb-6">
                This is from a real Group Theory lecture. 13 timestamped sections,
                permutation diagrams captured from the screen, handwritten equations
                converted to LaTeX, and every section tagged with its topic.
              </p>
              <ul className="space-y-3 mb-8">
                {[
                  '13 timestamped sections from a 52-minute lecture',
                  'Permutation diagrams and Cayley table images captured',
                  'Homomorphism equations converted to LaTeX',
                  'Tags: Groups, Permutations, Homomorphisms, Cayley\'s Theorem',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm text-[#4b4b49] leading-[1.6]">
                    <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <Button variant="secondary" onClick={() => router.push('/login?mode=signup')}>
                Try it on your lecture
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </div>

            <Card className="card-hover bg-white p-6" data-reveal="right" data-delay="150">
              <div className="flex items-center gap-2 mb-4 p-2 bg-[#f7f7f5] rounded-md border border-[rgba(55,53,47,0.09)] text-[11px] font-mono text-[#8a8a86]">
                <svg className="w-3.5 h-3.5 text-red-500 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M23 7s-.27-1.8-1.09-2.59C20.86 3.31 19.69 3.31 19.15 3.24 16.36 3 12 3 12 3s-4.36 0-7.15.24c-.54.07-1.71.07-2.76 1.17C1.27 5.2 1 7 1 7S.73 9.05.73 11.1v1.86C.73 15 1 17 1 17s.27 1.8 1.09 2.59c1.05 1.1 2.22 1.1 2.76 1.17C7.64 21 12 21 12 21s4.36 0 7.15-.24c.54-.07 1.71-.07 2.76-1.17C22.73 18.8 23 17 23 17s.27-2.05.27-4.05V11.1C23.27 9.05 23 7 23 7zM9.73 15.5v-7l6.55 3.5-6.55 3.5z"/>
                </svg>
                <span>youtube.com/watch?v=GroupTheory_L7</span>
              </div>
              <div className="space-y-3">
                <div>
                  <p className="text-xs font-semibold text-[#1a1a19] mb-1">Introduction to Group Homomorphisms</p>
                  <p className="text-[11px] text-[#8a8a86]">MATH 301 · Lecture 7 · 52 min</p>
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {['Groups','Homomorphisms','Cayley\'s Theorem'].map((t) => (
                    <span key={t} className="text-[10px] px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-100 font-medium">{t}</span>
                  ))}
                </div>
                <div className="p-3 bg-[#f7f7f5] border border-[rgba(55,53,47,0.09)] border-l-[3px] border-l-emerald-500 rounded-lg text-xs text-[#4b4b49] leading-[1.6]">
                  <span className="text-emerald-600 font-mono text-[10px]">12:34 </span>
                  A homomorphism is a structure-preserving map between groups. If φ: G → H, then φ(ab) = φ(a)φ(b) for all a, b ∈ G.
                </div>
                <div className="p-3 bg-[#f7f7f5] border border-[rgba(55,53,47,0.09)] rounded-lg">
                  <p className="text-[11px] font-mono text-[#4b4b49]"><span className="text-emerald-600">φ(ab)</span> = φ(a) · φ(b)</p>
                  <p className="text-[10px] text-[#8a8a86] mt-1">Equation captured from screen · 12:34</p>
                </div>
                <div className="p-3 bg-[#f7f7f5] border border-[rgba(55,53,47,0.09)] border-l-[3px] border-l-emerald-500 rounded-lg text-xs text-[#4b4b49] leading-[1.6]">
                  <span className="text-emerald-600 font-mono text-[10px]">23:14 </span>
                  Cayley's theorem: every group is isomorphic to a subgroup of a symmetric group. Proof via permutation representation φ(a) = πₐ.
                </div>
              </div>
            </Card>
          </div>
        </div>
      </section>

      {/* ── Pricing ───────────────────────────────────────────────── */}
      <section id="pricing" className="py-24 px-6 bg-[#f7f7f5] border-y border-[rgba(55,53,47,0.09)]">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-14" data-reveal data-delay="0">
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-600 mb-3">Pricing</p>
            <h2 className="text-3xl md:text-[38px] font-bold tracking-tight leading-[1.15] mb-3 text-[#1a1a19]">
              Start for free. Pay when you want more.
            </h2>
            <p className="text-[#4b4b49] text-lg leading-[1.6]">No subscriptions. No surprises.</p>
          </div>

          <div className="grid sm:grid-cols-3 gap-6">
            {[
              {
                name: 'Free',
                price: '€0',
                sub: '',
                detail: '2 full analyses or 5 transcript-only',
                cta: 'Start free',
                feats: ['Vision-based frame capture','Code and equation extraction','Timestamped sections','No account needed'],
              },
              {
                name: 'Pupil',
                price: '€2',
                sub: 'one-time',
                detail: '5 videos per day',
                cta: 'Get Pupil',
                highlighted: true,
                feats: ['Everything in Free','Higher daily limit','Saved notes','Works on playlists'],
              },
              {
                name: 'Feedback',
                price: 'Free',
                sub: 'for life',
                detail: 'Submit actionable feedback',
                cta: 'Give feedback',
                feats: ['Everything in Pupil','Unlimited access forever','Genuine offer — no tricks','Help shape what gets built next'],
              },
            ].map((plan, i) => (
              <Card
                key={plan.name}
                className={cn(
                  'card-hover relative p-6 flex flex-col',
                  plan.highlighted ? 'border-emerald-500 border-2' : 'bg-white'
                )}
                style={plan.highlighted ? { boxShadow: '0 4px 24px rgba(5,150,105,0.10)' } : {}}
                data-reveal
                data-delay={String(i * 100)}
              >
                {plan.highlighted && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-emerald-600 text-white text-[10px] font-bold tracking-wider whitespace-nowrap">
                    MOST POPULAR
                  </div>
                )}
                <p className="text-xs font-bold text-[#8a8a86] mb-4 uppercase tracking-wide">{plan.name}</p>
                <div className="flex items-baseline gap-1 mb-1">
                  <span className="text-4xl font-bold text-[#1a1a19]">{plan.price}</span>
                  {plan.sub && <span className="text-xs text-[#b5b5b1]">{plan.sub}</span>}
                </div>
                <p className="text-[11px] text-[#b5b5b1] mb-8 leading-[1.5]">{plan.detail}</p>
                <ul className="space-y-3 mb-8 flex-1">
                  {plan.feats.map((feat) => (
                    <li key={feat} className="flex items-start gap-2 text-xs text-[#4b4b49] leading-[1.6]">
                      <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  variant={plan.highlighted ? 'primary' : 'secondary'}
                  className="w-full shadow-none"
                  onClick={() => { window.location.href = '/login?mode=signup'; }}
                >
                  {plan.cta}
                </Button>
              </Card>
            ))}
          </div>

          <p className="text-center text-sm text-[#8a8a86] mt-8 leading-[1.6]">
            Submit actionable feedback and get a free subscription for life.
            That's a genuine offer — we want to hear what's broken.
          </p>
        </div>
      </section>

      {/* ── Tech Stack ────────────────────────────────────────────── */}
      <section className="py-24 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-14" data-reveal data-delay="0">
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-600 mb-3">Under the hood</p>
            <h2 className="text-3xl md:text-[38px] font-bold tracking-tight leading-[1.15] text-[#1a1a19]">
              Built with real AI, not wrappers.
            </h2>
          </div>
          <div className="grid md:grid-cols-2 gap-5">
            {techItems.map((item, i) => (
              <Card
                key={item.title}
                className="card-hover bg-[#f7f7f5] p-6 flex gap-4"
                data-reveal
                data-delay={String((i % 2) * 120)}
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                  style={{ backgroundColor: 'rgba(5,150,105,0.08)', color: '#059669' }}
                >
                  <item.icon className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold mb-1 text-[#1a1a19]">{item.title}</h3>
                  <p className="text-sm text-[#4b4b49] leading-[1.6]">{item.desc}</p>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ─────────────────────────────────────────────── */}
      <section className="py-24 px-6 bg-[#f7f7f5] border-t border-[rgba(55,53,47,0.09)]">
        <div className="max-w-xl mx-auto text-center" data-reveal data-delay="0">
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight leading-[1.1] mb-5 text-[#1a1a19]">
            Stop rewatching lectures.
          </h2>
          <p className="text-lg text-[#4b4b49] leading-[1.6] mb-10">
            Paste any YouTube lecture and get structured notes in minutes.
            Equations, diagrams, code — captured from the screen. Two free analyses,
            no account needed.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-4">
            <Button
              size="lg"
              className="shadow-none px-8"
              onClick={() => router.push('/login?mode=signup')}
            >
              Try Pupil free
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
          <p className="text-xs text-[#8a8a86]">No card. No signup for the free tier. Just paste a video link.</p>
        </div>
      </section>

      <PupilFooter />
    </div>
  );
}

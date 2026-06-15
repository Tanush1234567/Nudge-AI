'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Navbar } from '@/components/layout/navbar';
import { Footer } from '@/components/layout/footer';
import { Button } from '@/components/ui/button';
import { Tag } from '@/components/ui/tag';
import { Card } from '@/components/ui/card';
import { PasteInput } from '@/components/ui/paste-input';
import { AuroraBg } from '@/components/shared/aurora-bg';
import { CapturedFrame } from '@/components/ui/captured-frame';
import { Logo } from '@/components/shared/logo';
import { 
  ArrowRight, 
  Check, 
  Code, 
  Sparkles, 
  Link as LinkIcon, 
  Eye, 
  FileText, 
  Search, 
  Zap, 
  Target, 
  PlayCircle 
} from 'lucide-react';
import { cn } from '@/lib/utils';

export default function LandingPage() {
  const router = useRouter();
  const [url, setUrl] = React.useState('');

  const handleStartAnalysis = (submittedUrl: string) => {
    if (!submittedUrl) return;
    router.push(`/dashboard?page=library&newVideoUrl=${encodeURIComponent(submittedUrl)}`);
  };

  return (
    <div className="min-h-screen bg-bg flex flex-col">
      <Navbar />
      
      {/* Hero Section */}
      <section className="relative pt-24 pb-20 px-4 overflow-hidden">
        <AuroraBg intensity={0.6} />
        <div className="relative max-w-[920px] mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-1 border border-default text-xs text-text-2 mb-6 transition-transform hover:scale-105 cursor-default">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>New: paste a playlist for a whole course</span>
            <ArrowRight className="w-3 h-3" />
          </div>
          
          <h1 className="text-4xl md:text-6xl lg:text-[64px] font-bold tracking-[-0.035em] leading-[1.02] mb-6 font-sans">
            Never watch a<br />lecture again.
          </h1>
          
          <p className="text-lg md:text-xl text-text-2 leading-relaxed max-w-[620px] mx-auto mb-10">
            AI that watches your videos and takes the notes — including the code, 
            equations, and diagrams on screen.
          </p>
          
          <div className="max-w-[640px] mx-auto mb-4">
            <PasteInput 
              value={url} 
              onChange={setUrl} 
              onSubmit={() => handleStartAnalysis(url)} 
            />
          </div>
          
          <div className="text-sm text-text-3">
            3 free videos. No signup required.
          </div>

          {/* Social Proof */}
          <div className="mt-16 flex flex-wrap items-center justify-center gap-6 text-sm text-text-3">
            <div className="flex items-center">
              {['MJ','AT','RK','SS','LP'].map((n, i) => (
                <div 
                  key={n} 
                  className={cn(
                    "w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white border-2 border-bg shrink-0",
                    i > 0 && "-ml-2"
                  )}
                  style={{ backgroundColor: ['var(--brand-500)','var(--g-500)','var(--a-500)','var(--c-500)','var(--p-700)'][i] }}
                >
                  {n}
                </div>
              ))}
            </div>
            <span>14,200 students learning faster this semester</span>
            <div className="flex items-center gap-1">
              {[1,2,3,4,5].map(i => <Sparkles key={i} className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />)}
              <span className="ml-2 text-text-2">4.9 from 2,300 reviews</span>
            </div>
          </div>
        </div>
      </section>

      {/* Comparison Section */}
      <section className="py-24 px-4 bg-surface-1/50">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <Tag kind="purple">The difference</Tag>
            <h2 className="text-3xl md:text-[40px] font-bold tracking-tight leading-tight mt-4 mb-4">
              Every other tool reads<br />the subtitles.
            </h2>
            <p className="text-text-2 text-lg max-w-[560px] mx-auto">
              We actually watch the video. Here's what that looks like on the same lecture.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            {/* Other Tools */}
            <Card className="bg-surface-2/50 saturate-[0.4] min-h-[500px] flex flex-col grayscale-[0.2]">
              <div className="flex items-center justify-between mb-8">
                <span className="text-[10px] text-text-4 font-bold tracking-widest uppercase">Other tools</span>
                <span className="text-[11px] px-2 py-0.5 rounded-md bg-surface-3 text-text-3">transcript-only</span>
              </div>
              <div className="space-y-6 text-sm text-text-3 leading-relaxed">
                <p>
                  In this lecture, the professor talked about Bayes theorem. He discussed 
                  prior probability and likelihood. He gave an example about a disease test.
                </p>
                <p>
                  He then talked about the beta distribution and showed some Python code on the screen. 
                  He mentioned that conjugate priors are useful and explained how to update beliefs.
                </p>
                <div className="p-3 bg-surface-3 rounded-lg text-xs font-mono text-text-4">
                  [code in video — not captured]
                </div>
                <div className="p-3 bg-surface-3 rounded-lg text-xs font-mono text-text-4">
                  [equation on board — not captured]
                </div>
              </div>
            </Card>

            {/* Pupil */}
            <Card className="border-brand-500 border-2 shadow-3 min-h-[500px] flex flex-col relative overflow-hidden">
              <div className="absolute top-0 right-0 p-3">
                <Tag kind="green" icon={<Check className="w-2.5 h-2.5" />}>Visual analysis</Tag>
              </div>
              <div className="flex items-center gap-2 mb-6">
                <Logo size={18} />
              </div>
              
              <h3 className="text-lg font-bold mb-1">Bayesian inference</h3>
              <p className="text-xs text-text-3 mb-6">Stat 110 · Lecture 17 · 47 min</p>
              
              <div className="space-y-6 text-sm text-text-1 leading-relaxed">
                <p>
                  Bayes' theorem is a recipe for updating belief: 
                  <span className="italic"> posterior ∝ prior × likelihood</span>. Blitzstein motivates it with 
                  a rare-disease test...
                </p>
                
                <CapturedFrame variant="chalkboard" timestamp="04:15">
                  <div className="absolute inset-0 flex items-center justify-center font-serif italic text-2xl text-emerald-200">
                    P(A|B) = P(B|A)·P(A) / P(B)
                  </div>
                </CapturedFrame>

                <div className="space-y-3">
                  <Tag kind="coral" icon={<Code className="w-2.5 h-2.5" />}>Code from screen</Tag>
                  <div className="p-3 bg-surface-2 border border-default border-l-3 border-l-brand-500 rounded-lg font-mono text-[11.5px] leading-relaxed">
                    <div><span className="text-purple-500">post</span> = beta(α + k, β + n − k)</div>
                    <div className="text-text-3"># E[θ|data] = 0.788</div>
                  </div>
                </div>

                <div className="space-y-3">
                  <Tag kind="purple" icon={<Sparkles className="w-2.5 h-2.5" />}>AI-generated diagram</Tag>
                  <div className="p-3 border border-default rounded-lg flex items-center justify-between gap-1 text-[11px] font-medium">
                    <div className="flex-1 text-center py-1.5 rounded bg-amber-500/10 text-amber-600">Prior</div>
                    <span className="text-text-3 text-xs">×</span>
                    <div className="flex-1 text-center py-1.5 rounded bg-emerald-500/10 text-emerald-600">Likelihood</div>
                    <span className="text-text-3 text-xs">=</span>
                    <div className="flex-1 text-center py-1.5 rounded bg-brand-500/10 text-brand-600">Posterior</div>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </section>

      {/* How it Works */}
      <section className="py-24 px-4 border-y border-default">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <Tag>How it works</Tag>
            <h2 className="text-3xl md:text-[38px] font-bold tracking-tight leading-tight mt-4">
              Three steps. About four minutes.
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              { n: 1, icon: LinkIcon, title: 'Paste', desc: 'Drop a YouTube link or a whole playlist. We support 4K, captions, anything.', color: 'var(--brand-500)' },
              { n: 2, icon: Eye, title: 'Watch', desc: 'Vision AI scans every frame for code, equations, slides, and diagrams.', color: 'var(--g-500)' },
              { n: 3, icon: FileText, title: 'Learn', desc: 'Get rich notes with captures, code blocks, generated diagrams, and quotes.', color: 'var(--a-500)' },
            ].map((step) => (
              <Card key={step.n} className="bg-bg relative p-8">
                <div 
                  className="w-11 h-11 rounded-xl flex items-center justify-center mb-6"
                  style={{ backgroundColor: `color-mix(in oklab, ${step.color} 12%, transparent)`, color: step.color }}
                >
                  <step.icon className="w-5 h-5" />
                </div>
                <div className="text-[10px] font-mono text-text-3 mb-2 uppercase tracking-widest">Step {step.n}</div>
                <h3 className="text-xl font-bold mb-2">{step.title}</h3>
                <p className="text-sm text-text-2 leading-relaxed">{step.desc}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Bento Grid Features */}
      <section className="py-24 px-4 bg-surface-1">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <Tag kind="green">Course pack</Tag>
            <h2 className="text-3xl md:text-[40px] font-bold tracking-tight leading-tight mt-4 mb-4">
              Paste a playlist.<br />Get a whole course.
            </h2>
            <p className="text-text-2 text-lg max-w-[540px] mx-auto">
              One URL. Interconnected notes. Search across every lecture. Cross-referenced.
            </p>
          </div>
          
          <div className="grid md:grid-cols-4 gap-4 auto-rows-[240px]">
            {/* Main Feature */}
            <Card className="md:col-span-2 md:row-span-2 p-8 flex flex-col">
              <h3 className="text-2xl font-bold mb-3 tracking-tight">One playlist → 80 connected lectures.</h3>
              <p className="text-sm text-text-2 mb-8 max-w-sm">
                Drop a YouTube playlist URL once. Watch Pupil transform it into a navigable, searchable, cross-referenced course.
              </p>
              <div className="flex-1 relative bg-surface-2 rounded-xl p-4 border border-default overflow-hidden">
                <div className="flex items-center gap-2 mb-4 p-2 bg-surface-1 rounded-md border border-default text-[10px] font-mono text-text-3">
                  <PlayCircle className="w-3.5 h-3.5 text-coral-500" />
                  <span>youtube.com/playlist?list=PLstat110</span>
                </div>
                <div className="grid grid-cols-6 gap-3">
                  {Array.from({ length: 18 }).map((_, i) => (
                    <div 
                      key={i} 
                      className={cn(
                        "h-6 rounded flex items-center justify-center text-[9px] font-mono",
                        i < 12 ? "bg-brand-500 text-white" : "bg-surface-3 text-text-3 border border-default"
                      )}
                    >
                      L{i+1}
                    </div>
                  ))}
                </div>
              </div>
            </Card>

            {/* Search */}
            <Card className="md:col-span-2 p-6 flex flex-col">
              <h3 className="text-lg font-bold mb-1">Search every lecture.</h3>
              <p className="text-xs text-text-3 mb-4">One query across the whole course.</p>
              <div className="space-y-2">
                <div className="flex items-center gap-2 p-2 bg-surface-2 rounded-lg border border-default">
                  <Search className="w-3.5 h-3.5 text-text-4" />
                  <span className="text-xs text-text-1">conjugate prior</span>
                </div>
                {['L17: Beta-binomial conjugacy', 'L18: Dirichlet distribution', 'L23: Why conjugates matter'].map((r) => (
                  <div key={r} className="text-[11px] py-1 border-t border-default text-text-2 flex justify-between">
                    <span>{r}</span>
                    <span className="text-brand-500">→</span>
                  </div>
                ))}
              </div>
            </Card>

            {/* Exam Prep */}
            <Card className="p-6 flex flex-col justify-between">
              <div>
                <Tag kind="amber" icon={<Zap className="w-2.5 h-2.5" />}>Exam mode</Tag>
                <h3 className="text-base font-bold mt-3">Quiz me on what I missed.</h3>
              </div>
              <div className="h-20 bg-surface-2 rounded-lg border border-default p-2 text-[10px] text-text-3">
                "Based on your notes from L17, what is the impact of..."
              </div>
            </Card>

            {/* Gap Analysis */}
            <Card className="p-6 flex flex-col justify-between">
              <div>
                <Tag kind="coral" icon={<Target className="w-2.5 h-2.5" />}>Gap analysis</Tag>
                <h3 className="text-base font-bold mt-3">85% syllabus coverage.</h3>
              </div>
              <div className="space-y-2">
                <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 w-[85%]" />
                </div>
                <p className="text-[10px] text-text-4 text-center">3 topics need review</p>
              </div>
            </Card>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section className="py-24 px-4 bg-bg border-y border-default">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <Tag kind="amber">Pricing</Tag>
            <h2 className="text-3xl md:text-[38px] font-bold tracking-tight leading-tight mt-4 mb-2">
              Pay once. Keep forever.
            </h2>
            <p className="text-text-2 text-lg">Not another monthly subscription.</p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { name: 'Free', price: '$0', sub: 'try it', detail: '3 videos to try', feats: ['Visual capture', 'Code extraction', 'Diagrams'] },
              { name: 'Exam Cram', price: '$9', sub: 'one-time', detail: '10 videos', feats: ['Everything in Free', 'Quiz generation', 'Permanent saves'] },
              { name: 'Course Pack', price: '$19', sub: 'one-time', detail: '1 full course · 30 hrs', feats: ['Connected notes', 'Search across all', 'Master summary', 'Gap analysis'], highlighted: true },
              { name: 'Semester', price: '$39', sub: 'one-time', detail: 'up to 5 courses', feats: ['Everything in Course Pack', 'Cross-course search', 'Priority processing'] },
            ].map((plan) => (
              <Card 
                key={plan.name} 
                className={cn(
                  "relative p-6 flex flex-col",
                  plan.highlighted ? "border-brand-500 border-2 shadow-lg" : "bg-surface-1"
                )}
              >
                {plan.highlighted && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-brand-500 text-white text-[10px] font-bold tracking-wider">
                    MOST POPULAR
                  </div>
                )}
                <div className="text-xs font-bold text-text-3 mb-4">{plan.name}</div>
                <div className="flex items-baseline gap-1 mb-1">
                  <span className="text-4xl font-bold">{plan.price}</span>
                  <span className="text-xs text-text-4">{plan.sub}</span>
                </div>
                <div className="text-[11px] text-text-4 mb-8">{plan.detail}</div>
                
                <ul className="space-y-3 mb-8 flex-1">
                  {plan.feats.map(feat => (
                    <li key={feat} className="flex items-center gap-2 text-xs text-text-2">
                      <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      {feat}
                    </li>
                  ))}
                </ul>

                <Button
                  variant={plan.highlighted ? 'primary' : 'secondary'}
                  className="w-full"
                  onClick={() => { window.location.href = '/login?mode=signup'; }}
                >
                  {plan.name === 'Free' ? 'Start free' : `Get ${plan.name}`}
                </Button>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative py-32 px-4 overflow-hidden">
        <AuroraBg intensity={0.8} />
        <div className="relative max-w-[780px] mx-auto text-center">
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight leading-[1.05] mb-6">
            Try it on the lecture you'd otherwise skip.
          </h2>
          <p className="text-lg text-text-2 max-w-[520px] mx-auto mb-10">
            Paste any video. Two minutes from now, you'll have notes worth screenshotting.
          </p>
          <div className="max-w-[600px] mx-auto">
            <PasteInput 
              value={url} 
              onChange={setUrl} 
              onSubmit={() => handleStartAnalysis(url)} 
            />
          </div>
          <div className="mt-4 text-xs text-text-3">
            No card. No signup. Just paste.
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}

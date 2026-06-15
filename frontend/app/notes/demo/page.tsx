'use client';

import * as React from 'react';
import { Navbar } from '@/components/layout/navbar';
import { NotesHeader } from '@/components/notes/notes-header';
import { NotesSummary } from '@/components/notes/notes-summary';
import { NotesSection } from '@/components/notes/notes-section';
import { NotesActionBar } from '@/components/notes/action-bar';
import { VideoNotes } from '@/lib/types';

const MOCK_NOTES: VideoNotes = {
  job_id: 'demo',
  video: {
    title: "Bayesian inference: priors, likelihoods, and the math that updates your beliefs",
    channel: "Joe Blitzstein · Harvard Stat 110",
    duration_seconds: 2833,
    thumbnail_url: "",
    youtube_id: "dQw4w9WgXcQ"
  },
  stats: {
    frames_captured: 42,
    diagrams_generated: 7,
    code_blocks_extracted: 4,
    equations_extracted: 3
  },
  summary: "Bayes' theorem is a recipe for updating belief: posterior ∝ prior × likelihood. Blitzstein motivates it with a rare-disease test, then formalises the beta-binomial conjugate pair — the cleanest example of how data reshapes a prior.",
  topics: ['Bayes theorem', 'Conjugate priors', 'Beta distribution', 'Posterior updates', 'Base rate fallacy'],
  sections: [
    {
      number: 1,
      title: "The intuition: updating beliefs with evidence",
      timestamp_seconds: 222,
      content_html: "<p>Probability is a language for uncertainty. <em>Bayesian</em> probability treats it as a degree of belief that can be revised when new evidence arrives. The mechanics live in <strong>Bayes' theorem</strong>: a precise rule for combining what you knew before (the <em>prior</em>) with what the data tells you (the <em>likelihood</em>).</p>",
      key_takeaway: "The prior dominates when evidence is sparse.",
      visuals: [
        {
          type: 'captured_frame',
          frame_index: 1,
          timestamp_seconds: 255,
          timestamp_str: "04:15",
          image_url: "",
          caption: "The headline equation, written on the board at 04:15."
        }
      ]
    },
    {
      number: 2,
      title: "The beta-binomial: a worked example",
      timestamp_seconds: 1491,
      content_html: "<p>You flip a coin n times and observe k heads. What's your belief about θ, the probability of heads? With a Beta(α, β) prior on θ, the posterior is also Beta — a property called <em>conjugacy</em>.</p>",
      key_takeaway: "Conjugacy makes Bayesian updating a closed-form arithmetic step.",
      visuals: [
        {
          type: 'code_block',
          language: "python",
          code: "import numpy as np\nfrom scipy.stats import beta\n\n# Prior: weakly fair\nalpha, beta_0 = 2, 2\n\n# Data: 80 heads in 100 flips\nk, n = 80, 100\n\npost = beta(alpha + k, beta_0 + n - k)\nprint(f\"E[θ|data] = {post.mean():.3f}\")\n# → E[θ|data] = 0.788",
          caption: "Screen capture at 28:14",
          explanation: "Simple posterior update using scipy"
        },
        {
          type: 'ai_diagram',
          diagram_type: "Distribution Shift",
          caption: "Posterior distribution (purple) shifting toward the data (green) from the prior (amber)."
        }
      ]
    }
  ]
};

export default function NotesDemoPage() {
  return (
    <div className="min-h-screen bg-bg flex flex-col pb-32">
      <Navbar />
      
      <NotesHeader notes={MOCK_NOTES} />
      
      <article className="max-w-[720px] mx-auto px-8 w-full">
        <NotesSummary summary={MOCK_NOTES.summary} topics={MOCK_NOTES.topics} />
        
        <div className="mt-4 space-y-0">
          {MOCK_NOTES.sections.map((section) => (
            <NotesSection 
              key={section.number} 
              section={section} 
              videoId="dQw4w9WgXcQ"
            />
          ))}
        </div>

        <div className="mt-14 pt-8 border-t border-default space-y-4">
          <div className="text-[11px] tracking-widest uppercase text-text-3 font-bold mb-4">What's next in this course</div>
          <div className="space-y-2">
            {[18, 19, 20].map((num) => (
              <div key={num} className="p-4 rounded-xl border border-default bg-surface-1 flex items-center justify-between group cursor-pointer hover:border-brand-500/50 transition-colors">
                <div className="flex items-center gap-4">
                  <span className="text-xs font-mono text-text-3 w-6">{num}</span>
                  <span className="text-sm font-bold text-text-1">Next Lecture Preview</span>
                </div>
                <div className="text-xs text-text-3 group-hover:text-brand-500 transition-colors">Open →</div>
              </div>
            ))}
          </div>
        </div>
      </article>

      <NotesActionBar />
    </div>
  );
}

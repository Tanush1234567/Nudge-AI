'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Tag } from '@/components/ui/tag';
import { Callout } from '@/components/ui/callout';
import { Card } from '@/components/ui/card';
import { PasteInput } from '@/components/ui/paste-input';
import { Logo } from '@/components/shared/logo';
import { SectionMarker } from '@/components/shared/section-marker';
import { Navbar } from '@/components/layout/navbar';
import { Footer } from '@/components/layout/footer';
import { Sparkles, Brain, Code, Zap } from 'lucide-react';

export default function ComponentsDemo() {
  const [url, setUrl] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  const handleSubmit = () => {
    setLoading(true);
    setTimeout(() => setLoading(false), 2000);
  };

  return (
    <div className="min-h-screen bg-bg flex flex-col">
      <Navbar />
      
      <main className="flex-1 container max-w-4xl mx-auto px-4 py-12 space-y-16">
        {/* Buttons */}
        <section className="space-y-4">
          <h2 className="text-xl font-bold text-text-1">Buttons</h2>
          <div className="flex flex-wrap gap-4 items-center">
            <Button variant="primary">Primary Button</Button>
            <Button variant="secondary">Secondary Button</Button>
            <Button variant="ghost">Ghost Button</Button>
            <Button variant="primary" size="sm">Small</Button>
            <Button variant="primary" size="lg">Large</Button>
          </div>
        </section>

        {/* Tags */}
        <section className="space-y-4">
          <h2 className="text-xl font-bold text-text-1">Tags</h2>
          <div className="flex flex-wrap gap-4 items-center">
            <Tag kind="purple">Purple Tag</Tag>
            <Tag kind="green">Green Tag</Tag>
            <Tag kind="coral">Coral Tag</Tag>
            <Tag kind="amber">Amber Tag</Tag>
            <Tag kind="neutral">Neutral Tag</Tag>
            <Tag kind="purple" icon={<Sparkles className="w-3 h-3" />}>With Icon</Tag>
          </div>
        </section>

        {/* Callouts */}
        <section className="space-y-4">
          <h2 className="text-xl font-bold text-text-1">Callouts</h2>
          <div className="grid gap-4">
            <Callout variant="purple" title="Insight">
              This is a purple callout for general insights and observations.
            </Callout>
            <Callout variant="green" title="Tip">
              Use this for helpful tips and best practices.
            </Callout>
            <Callout variant="amber" title="Warning">
              Be careful with this setting; it might change the output significantly.
            </Callout>
          </div>
        </section>

        {/* Card & Marker */}
        <section className="space-y-4">
          <h2 className="text-xl font-bold text-text-1">Card & Marker</h2>
          <Card className="flex items-start gap-4">
            <SectionMarker number={1} />
            <div className="space-y-2">
              <h3 className="font-semibold text-text-1">Step One</h3>
              <p className="text-sm text-text-2">
                This is a card component with a section marker inside. It uses the design system's spacing and radii.
              </p>
            </div>
          </Card>
        </section>

        {/* Hero Input */}
        <section className="space-y-4">
          <h2 className="text-xl font-bold text-text-1">Hero Input</h2>
          <div className="max-w-2xl">
            <PasteInput 
              value={url}
              onChange={setUrl}
              onSubmit={handleSubmit}
              loading={loading}
            />
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}

'use client';

import * as React from 'react';
import { useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

export default function ProcessingRedirectPage() {
  return (
    <React.Suspense fallback={<Loader />}>
      <ProcessingRedirectContent />
    </React.Suspense>
  );
}

function Loader() {
  return (
    <div className="min-h-screen bg-[#FAFAF9] dark:bg-[#0F0F10] flex flex-col items-center justify-center space-y-4 select-none">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="28"
        height="28"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="animate-spin text-zinc-500 dark:text-zinc-400"
      >
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
      <p className="text-zinc-500 text-sm animate-pulse">Redirecting to Pupil workspace...</p>
    </div>
  );
}

function ProcessingRedirectContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const url = searchParams.get('url');

  useEffect(() => {
    if (url) {
      router.replace(`/dashboard?page=library&newVideoUrl=${encodeURIComponent(url)}`);
    } else {
      router.replace('/dashboard');
    }
  }, [url, router]);

  return <Loader />;
}

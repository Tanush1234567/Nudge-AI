import type { Metadata } from "next";
import { DM_Sans, JetBrains_Mono, Source_Serif_4 } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-dm-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

// Reader-mode body font for notes — a humanist serif designed for long-form
// screen reading. Loaded with optical-size weights for crisp paragraphs.
const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-source-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Pupil — The AI that actually watched the lecture",
  description: "Save any video. Get structured notes with extracted equations, code, and diagrams. Search across everything you've ever watched.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${jetbrainsMono.variable} ${sourceSerif.variable}`}
      // The inline theme-restore script adds `class="dark"` before React hydrates,
      // so the server vs client className will always differ. Suppress the warning.
      suppressHydrationWarning
    >
      <body>
        {/* Blocking theme-restoration script — runs before React hydrates */}
        <Script id="theme-restore" strategy="beforeInteractive">
          {`
            (function() {
              try {
                var stored = localStorage.getItem('pupil_theme');
                var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                var isDark = stored === 'dark' || (!stored && prefersDark);
                if (isDark) {
                  document.documentElement.classList.add('dark');
                }
              } catch(e) {}
            })();
          `}
        </Script>
        {children}
      </body>
    </html>
  );
}

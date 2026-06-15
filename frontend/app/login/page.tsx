"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";

type Mode = "signin" | "signup";

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const [mode, setMode] = React.useState<Mode>("signin");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [info, setInfo] = React.useState<string | null>(null);

  const redirectTo = search.get("redirectTo") || "/dashboard";

  React.useEffect(() => {
    const m = search.get("mode");
    if (m === "signup" || m === "signin") {
      setMode(m as Mode);
    }
  }, [search]);

  React.useEffect(() => {
    const supabase = getSupabaseClient();
    supabase.auth.getSession().then((res: { data: { session: unknown } }) => {
      if (res.data.session) router.replace(redirectTo);
    });
  }, [router, redirectTo]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (!email || !password) {
      setError("Email and password are required");
      return;
    }
    if (mode === "signup" && password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    setLoading(true);
    try {
      const supabase = getSupabaseClient();
      if (mode === "signin") {
        const { error: authError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (authError) {
          setError(authError.message);
        } else {
          router.replace(redirectTo);
          return;
        }
      } else {
        const { data, error: authError } = await supabase.auth.signUp({
          email,
          password,
        });
        if (authError) {
          setError(authError.message);
        } else if (data.session) {
          // Email confirmation disabled — straight to the app.
          router.replace(redirectTo);
          return;
        } else {
          // Confirmation required — Supabase sent a verification email.
          setInfo("Check your email for a confirmation link, then sign in.");
          setMode("signin");
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Auth failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#0F0F13] text-white px-4 font-sans">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#16161D] p-8 shadow-2xl">
        <div className="flex items-center justify-center gap-2 mb-7">
          <Eye size={26} strokeWidth={2.25} style={{ color: "#6C5CE7" }} />
          <span className="text-xl font-semibold tracking-tight">Pupil</span>
        </div>

        <h1 className="text-[22px] font-semibold text-center tracking-tight mb-1.5">
          {mode === "signin" ? "Welcome back" : "Create your account"}
        </h1>
        <p className="text-sm text-white/60 text-center mb-6">
          The AI that actually watched the lecture.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] text-white/50 uppercase tracking-wider font-semibold">Email</span>
            <input
              type="email"
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-[#0F0F13] border border-white/10 focus:border-[#6C5CE7] outline-none rounded-lg px-3 py-2 text-[14px] text-white placeholder-white/30 transition-colors"
              placeholder="you@example.com"
              required
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] text-white/50 uppercase tracking-wider font-semibold">Password</span>
            <input
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-[#0F0F13] border border-white/10 focus:border-[#6C5CE7] outline-none rounded-lg px-3 py-2 text-[14px] text-white placeholder-white/30 transition-colors"
              placeholder={mode === "signup" ? "At least 6 characters" : "••••••••"}
              required
            />
          </label>

          <button
            type="submit"
            disabled={loading}
            className="mt-2 w-full py-2.5 px-4 rounded-lg bg-[#6C5CE7] hover:bg-[#5A4BD1] text-white font-semibold text-[14px] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Working…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        {error && (
          <p className="mt-4 text-xs text-red-400 text-center">{error}</p>
        )}
        {info && (
          <p className="mt-4 text-xs text-emerald-400 text-center">{info}</p>
        )}

        <div className="mt-6 text-center text-[12.5px] text-white/60">
          {mode === "signin" ? (
            <>
              No account?{" "}
              <button
                type="button"
                onClick={() => { setMode("signup"); setError(null); setInfo(null); }}
                className="text-[#A29BFE] hover:underline underline-offset-2 bg-transparent border-none cursor-pointer p-0"
              >
                Create one
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => { setMode("signin"); setError(null); setInfo(null); }}
                className="text-[#A29BFE] hover:underline underline-offset-2 bg-transparent border-none cursor-pointer p-0"
              >
                Sign in
              </button>
            </>
          )}
        </div>

        <div className="mt-7 pt-5 border-t border-white/10">
          <p className="text-[11px] text-white/40 text-center leading-relaxed">
            By continuing you agree to Pupil's Terms and Privacy Policy.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <React.Suspense fallback={
      <div className="min-h-screen w-full flex items-center justify-center bg-[#0F0F13] text-white px-4 font-sans">
        <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#16161D] p-8 shadow-2xl flex flex-col items-center justify-center">
          <p className="text-sm text-white/60 animate-pulse">Loading login...</p>
        </div>
      </div>
    }>
      <LoginForm />
    </React.Suspense>
  );
}

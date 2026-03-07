"use client";

import * as React from "react";
import { cn } from "@schoolbridge/ui/lib/utils";

/* ─────────────────────────────────────────────────────────────── */
/*  Login Page                                                    */
/*  Clean login with magic link + social login options.           */
/*  Warm branding, school/parent friendly.                        */
/* ─────────────────────────────────────────────────────────────── */

export default function LoginPage() {
  const [email, setEmail] = React.useState("");
  const [submitted, setSubmitted] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 1200));
    setLoading(false);
    setSubmitted(true);
  };

  return (
    <div className="relative flex min-h-screen">
      {/* ── Left Panel: Decorative / Branding ─────────────────── */}
      <div className="relative hidden w-1/2 overflow-hidden bg-gradient-to-br from-[hsl(var(--primary))] via-[hsl(32,90%,48%)] to-[hsl(var(--accent))] lg:block">
        {/* Decorative shapes */}
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <div className="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/10" />
          <div className="absolute bottom-20 left-10 h-48 w-48 rounded-full bg-white/5" />
          <div className="absolute right-1/4 top-1/3 h-32 w-32 rounded-full bg-white/8" />
          <div className="absolute bottom-1/3 right-10 h-20 w-20 rounded-full bg-white/10" />

          {/* Warm dot pattern */}
          <div
            className="absolute inset-0 opacity-10"
            style={{
              backgroundImage: "radial-gradient(white 1px, transparent 1px)",
              backgroundSize: "32px 32px",
            }}
          />
        </div>

        {/* Branding content */}
        <div className="relative flex h-full flex-col justify-between p-12">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 shadow-sm backdrop-blur-sm">
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 10a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v0" />
                <path d="M6 14v6" />
                <path d="M18 14v6" />
                <path d="M2 10h20" />
                <path d="M12 10v4" />
              </svg>
            </div>
            <span className="text-lg font-bold text-white">SchoolBridge</span>
          </div>

          {/* Center: illustration + message */}
          <div className="max-w-md">
            <div className="mb-6 text-7xl">
              <span role="img" aria-label="backpack">
                &#x1F392;
              </span>
            </div>
            <h2 className="mb-4 text-3xl font-extrabold leading-tight text-white">
              Every school moment,{" "}
              <span className="text-white/80">organized & on time.</span>
            </h2>
            <p className="text-base leading-relaxed text-white/70">
              Join parents who never miss picture day, forget about field trips,
              or scramble for the bake sale. SchoolBridge keeps your family in
              sync.
            </p>

            {/* Quick stats */}
            <div className="mt-8 flex gap-8">
              <div>
                <div className="text-2xl font-bold text-white">2,400+</div>
                <div className="text-xs text-white/60">Families syncing</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-white">50k+</div>
                <div className="text-xs text-white/60">Events organized</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-white">200k+</div>
                <div className="text-xs text-white/60">Photos saved</div>
              </div>
            </div>
          </div>

          {/* Bottom: testimonial */}
          <div className="max-w-md rounded-xl bg-white/10 p-5 backdrop-blur-sm">
            <p className="mb-3 text-sm italic leading-relaxed text-white/90">
              &ldquo;The magic link login is so easy — I signed up on my phone
              during pickup. By bedtime, all our school events were on the family
              calendar.&rdquo;
            </p>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-sm">
                <span role="img" aria-label="woman">
                  &#x1F469;
                </span>
              </div>
              <div>
                <div className="text-xs font-semibold text-white">
                  Jessica R.
                </div>
                <div className="text-[10px] text-white/60">
                  Parent at Maple Valley Elementary
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Right Panel: Login Form ───────────────────────────── */}
      <div className="flex w-full items-center justify-center bg-[hsl(var(--background))] px-4 py-12 lg:w-1/2">
        <div className="w-full max-w-md">
          {/* Mobile logo (shown on small screens) */}
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[hsl(var(--primary))] to-[hsl(var(--accent))] shadow-sm">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 10a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v0" />
                <path d="M6 14v6" />
                <path d="M18 14v6" />
                <path d="M2 10h20" />
                <path d="M12 10v4" />
              </svg>
            </div>
            <span className="text-base font-bold text-[hsl(var(--foreground))]">
              SchoolBridge
            </span>
          </div>

          {/* ── Success state: email sent ─── */}
          {submitted ? (
            <div className="text-center">
              <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-[hsl(var(--primary-soft))]">
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="hsl(var(--primary))"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect width="20" height="16" x="2" y="4" rx="2" />
                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                </svg>
              </div>
              <h1 className="mb-2 text-2xl font-bold text-[hsl(var(--foreground))]">
                Check your email
              </h1>
              <p className="mb-6 text-sm text-[hsl(var(--muted-foreground))]">
                We sent a sign-in link to{" "}
                <span className="font-medium text-[hsl(var(--foreground))]">
                  {email}
                </span>
                . Click the link in the email to sign in. It expires in 10
                minutes.
              </p>
              <button
                onClick={() => setSubmitted(false)}
                className="text-sm font-medium text-[hsl(var(--primary))] hover:text-[hsl(var(--primary-hover))] transition-colors"
              >
                Use a different email
              </button>
            </div>
          ) : (
            <>
              {/* ── Default state: login form ─── */}
              <div className="mb-8">
                <h1 className="mb-2 text-2xl font-bold text-[hsl(var(--foreground))]">
                  Welcome back
                </h1>
                <p className="text-sm text-[hsl(var(--muted-foreground))]">
                  Sign in to your SchoolBridge account to manage your school
                  syncs.
                </p>
              </div>

              {/* Social login buttons */}
              <div className="mb-6 grid gap-3">
                <button
                  className={cn(
                    "flex h-11 w-full items-center justify-center gap-3 rounded-xl",
                    "border border-[hsl(var(--border))] bg-[hsl(var(--card))]",
                    "text-sm font-medium text-[hsl(var(--foreground))]",
                    "transition-all duration-200",
                    "hover:bg-[hsl(var(--muted))] hover:border-[hsl(var(--border-strong))]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]",
                  )}
                >
                  {/* Google icon */}
                  <svg width="18" height="18" viewBox="0 0 24 24">
                    <path
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                      fill="#4285F4"
                    />
                    <path
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      fill="#34A853"
                    />
                    <path
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      fill="#FBBC05"
                    />
                    <path
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      fill="#EA4335"
                    />
                  </svg>
                  Continue with Google
                </button>

                <button
                  className={cn(
                    "flex h-11 w-full items-center justify-center gap-3 rounded-xl",
                    "border border-[hsl(var(--border))] bg-[hsl(var(--card))]",
                    "text-sm font-medium text-[hsl(var(--foreground))]",
                    "transition-all duration-200",
                    "hover:bg-[hsl(var(--muted))] hover:border-[hsl(var(--border-strong))]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]",
                  )}
                >
                  {/* Apple icon */}
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
                  </svg>
                  Continue with Apple
                </button>
              </div>

              {/* Divider */}
              <div className="relative mb-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-[hsl(var(--border))]" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-[hsl(var(--background))] px-3 text-[hsl(var(--muted-foreground))]">
                    or sign in with email
                  </span>
                </div>
              </div>

              {/* Magic link form */}
              <form onSubmit={handleMagicLink} className="space-y-4">
                <div className="space-y-2">
                  <label
                    htmlFor="email"
                    className="text-sm font-medium text-[hsl(var(--foreground))]"
                  >
                    Email address
                  </label>
                  <div className="relative">
                    {/* Email icon */}
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-[hsl(var(--muted-foreground))]">
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect width="20" height="16" x="2" y="4" rx="2" />
                        <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                      </svg>
                    </div>
                    <input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="parent@example.com"
                      required
                      className={cn(
                        "flex h-11 w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--card))]",
                        "pl-10 pr-4 text-sm text-[hsl(var(--foreground))]",
                        "placeholder:text-[hsl(var(--muted-foreground)/0.5)]",
                        "transition-all duration-200 ease-out",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring)/0.20)] focus-visible:border-[hsl(var(--primary))]",
                        "hover:border-[hsl(var(--border-strong))]",
                      )}
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading || !email}
                  className={cn(
                    "flex h-11 w-full items-center justify-center gap-2 rounded-xl",
                    "bg-[hsl(var(--primary))] text-sm font-semibold text-white",
                    "shadow-[0_2px_8px_-2px_rgba(245,145,21,0.4)]",
                    "transition-all duration-200",
                    "hover:bg-[hsl(var(--primary-hover))] hover:-translate-y-px",
                    "hover:shadow-[0_6px_20px_-4px_rgba(245,145,21,0.35)]",
                    "active:translate-y-0",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2",
                    "disabled:opacity-50 disabled:pointer-events-none",
                  )}
                >
                  {loading ? (
                    <>
                      <svg
                        className="animate-spin"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                      </svg>
                      Sending link...
                    </>
                  ) : (
                    <>
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="m5 12 5 5L20 7" />
                      </svg>
                      Send me a sign-in link
                    </>
                  )}
                </button>
              </form>

              {/* Footer text */}
              <div className="mt-6 text-center">
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  Don&apos;t have an account?{" "}
                  <a
                    href="/signup"
                    className="font-medium text-[hsl(var(--primary))] hover:text-[hsl(var(--primary-hover))] transition-colors"
                  >
                    Create one for free
                  </a>
                </p>
              </div>

              <div className="mt-8 text-center">
                <p className="text-[10px] leading-relaxed text-[hsl(var(--muted-foreground)/0.6)]">
                  By continuing, you agree to SchoolBridge&apos;s{" "}
                  <a href="/terms" className="underline hover:text-[hsl(var(--muted-foreground))]">
                    Terms of Service
                  </a>{" "}
                  and{" "}
                  <a href="/privacy" className="underline hover:text-[hsl(var(--muted-foreground))]">
                    Privacy Policy
                  </a>
                  .
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

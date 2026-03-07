import { cn } from "@schoolbridge/ui/lib/utils";

/* ─────────────────────────────────────────────────────────────── */
/*  SchoolBridge Landing Page                                     */
/*  Hero + Features + How It Works + Testimonials + CTA           */
/*                                                                */
/*  Design: warm, school-parent friendly, NOT generic startup.    */
/*  Uses emoji illustrations, friendly copy, amber/coral palette. */
/* ─────────────────────────────────────────────────────────────── */

export const metadata = {
  title: "SchoolBridge — Never Miss a School Moment",
  description:
    "Automatically sync ClassDojo posts to your calendar and photo library. Approve events through Discord. Keep every school moment organized.",
};

/* ── Reusable Warm Button (inline, no import needed for marketing) ── */

function WarmButton({
  children,
  variant = "primary",
  size = "lg",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "outline";
  size?: "default" | "lg" | "xl";
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 font-semibold transition-all duration-200 ease-out",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2",
        variant === "primary" && [
          "bg-[hsl(var(--primary))] text-white",
          "shadow-[0_2px_8px_-2px_rgba(245,145,21,0.4)]",
          "hover:bg-[hsl(var(--primary-hover))] hover:-translate-y-0.5",
          "hover:shadow-[0_8px_25px_-5px_rgba(245,145,21,0.35)]",
          "active:translate-y-0",
        ],
        variant === "outline" && [
          "bg-transparent text-[hsl(var(--foreground))]",
          "border-2 border-[hsl(var(--border-strong))]",
          "hover:bg-[hsl(var(--muted))] hover:border-[hsl(var(--primary)/0.3)]",
        ],
        size === "default" && "h-10 px-5 text-sm rounded-xl",
        size === "lg" && "h-12 px-7 text-base rounded-xl",
        size === "xl" && "h-14 px-9 text-lg rounded-2xl",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/* ── Section Wrapper ──────────────────────────────────────────── */

function Section({
  children,
  className,
  id,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("relative px-4 py-20 md:py-28", className)}>
      <div className="mx-auto max-w-6xl">{children}</div>
    </section>
  );
}

/* ── Feature Card ─────────────────────────────────────────────── */

function FeatureCard({
  emoji,
  title,
  description,
  accent = "primary",
}: {
  emoji: string;
  title: string;
  description: string;
  accent?: "primary" | "accent" | "success" | "info";
}) {
  const accentMap = {
    primary: "from-[hsl(var(--primary)/0.10)] to-[hsl(var(--primary)/0.03)]",
    accent: "from-[hsl(var(--accent)/0.10)] to-[hsl(var(--accent)/0.03)]",
    success: "from-emerald-50 to-emerald-50/30 dark:from-emerald-950/30 dark:to-emerald-950/10",
    info: "from-blue-50 to-blue-50/30 dark:from-blue-950/30 dark:to-blue-950/10",
  };

  return (
    <div
      className={cn(
        "group relative rounded-2xl border border-[hsl(var(--border))]",
        "bg-gradient-to-br",
        accentMap[accent],
        "p-6 md:p-8",
        "transition-all duration-300 ease-out",
        "hover:-translate-y-1 hover:shadow-[0_12px_30px_-8px_rgba(60,45,30,0.10)]",
        "hover:border-[hsl(var(--border-strong))]",
      )}
    >
      <div className="mb-4 text-4xl">{emoji}</div>
      <h3 className="mb-2 text-lg font-bold text-[hsl(var(--foreground))]">
        {title}
      </h3>
      <p className="text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">
        {description}
      </p>
    </div>
  );
}

/* ── Step Card (How It Works) ─────────────────────────────────── */

function StepCard({
  number,
  emoji,
  title,
  description,
}: {
  number: number;
  emoji: string;
  title: string;
  description: string;
}) {
  return (
    <div className="relative flex flex-col items-center text-center">
      {/* Step number floating above */}
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-[hsl(var(--primary))] text-sm font-bold text-white shadow-[0_2px_8px_-2px_rgba(245,145,21,0.4)]">
        {number}
      </div>
      {/* Emoji illustration */}
      <div className="mb-3 text-5xl">{emoji}</div>
      <h3 className="mb-2 text-base font-bold text-[hsl(var(--foreground))]">
        {title}
      </h3>
      <p className="text-sm leading-relaxed text-[hsl(var(--muted-foreground))] max-w-xs">
        {description}
      </p>
    </div>
  );
}

/* ── Testimonial Card ─────────────────────────────────────────── */

function TestimonialCard({
  quote,
  name,
  role,
  emoji,
}: {
  quote: string;
  name: string;
  role: string;
  emoji: string;
}) {
  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-[0_1px_3px_0_rgba(60,45,30,0.06)]">
      <div className="mb-4 text-3xl">{emoji}</div>
      <p className="mb-4 text-sm italic leading-relaxed text-[hsl(var(--foreground))]">
        &ldquo;{quote}&rdquo;
      </p>
      <div>
        <div className="text-sm font-semibold text-[hsl(var(--foreground))]">
          {name}
        </div>
        <div className="text-xs text-[hsl(var(--muted-foreground))]">
          {role}
        </div>
      </div>
    </div>
  );
}

/* ── Floating Decoration Shapes ───────────────────────────────── */

function FloatingShapes() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {/* Top-left warm blob */}
      <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-[hsl(var(--primary)/0.06)] blur-3xl" />
      {/* Top-right coral blob */}
      <div className="absolute -right-20 top-20 h-72 w-72 rounded-full bg-[hsl(var(--accent)/0.05)] blur-3xl" />
      {/* Bottom-center cream blob */}
      <div className="absolute bottom-0 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-[hsl(var(--secondary)/0.40)] blur-3xl" />
    </div>
  );
}

/* ── Navbar ────────────────────────────────────────────────────── */

function Navbar() {
  return (
    <nav className="sticky top-0 z-50 border-b border-[hsl(var(--border)/0.5)] bg-[hsl(var(--background)/0.85)] backdrop-blur-lg">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[hsl(var(--primary))] to-[hsl(var(--accent))] shadow-sm">
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
          <span className="text-base font-bold tracking-tight text-[hsl(var(--foreground))]">
            SchoolBridge
          </span>
        </div>

        {/* Nav links */}
        <div className="hidden items-center gap-8 md:flex">
          <a
            href="#features"
            className="text-sm font-medium text-[hsl(var(--muted-foreground))] transition-colors hover:text-[hsl(var(--foreground))]"
          >
            Features
          </a>
          <a
            href="#how-it-works"
            className="text-sm font-medium text-[hsl(var(--muted-foreground))] transition-colors hover:text-[hsl(var(--foreground))]"
          >
            How It Works
          </a>
          <a
            href="#testimonials"
            className="text-sm font-medium text-[hsl(var(--muted-foreground))] transition-colors hover:text-[hsl(var(--foreground))]"
          >
            Parents Love It
          </a>
        </div>

        {/* CTA */}
        <div className="flex items-center gap-3">
          <a
            href="/login"
            className="text-sm font-medium text-[hsl(var(--muted-foreground))] transition-colors hover:text-[hsl(var(--foreground))]"
          >
            Sign In
          </a>
          <WarmButton size="default">
            Get Started Free
          </WarmButton>
        </div>
      </div>
    </nav>
  );
}

/* ── Hero Section ─────────────────────────────────────────────── */

function HeroSection() {
  return (
    <Section className="overflow-hidden pb-10 pt-12 md:pb-16 md:pt-20">
      <FloatingShapes />

      <div className="relative flex flex-col items-center text-center">
        {/* Badge pill */}
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[hsl(var(--primary)/0.2)] bg-[hsl(var(--primary-soft))] px-4 py-1.5">
          <span className="text-xs font-semibold text-[hsl(var(--primary))]">
            New
          </span>
          <span className="text-xs text-[hsl(var(--muted-foreground))]">
            Discord approval flow is live
          </span>
        </div>

        {/* Heading */}
        <h1 className="mb-6 max-w-4xl text-4xl font-extrabold tracking-tight text-[hsl(var(--foreground))] sm:text-5xl md:text-6xl lg:text-7xl">
          Never Miss a{" "}
          <span className="bg-gradient-to-r from-[hsl(var(--primary))] to-[hsl(var(--accent))] bg-clip-text text-transparent">
            School Moment
          </span>{" "}
          Again
        </h1>

        {/* Subheading */}
        <p className="mb-8 max-w-2xl text-lg leading-relaxed text-[hsl(var(--muted-foreground))] md:text-xl">
          SchoolBridge automatically syncs your ClassDojo school posts to your
          calendar and photo library. Every field trip, picture day, and class
          party — organized and ready, so you can show up prepared (and with the
          right outfit).
        </p>

        {/* CTA buttons */}
        <div className="mb-12 flex flex-col items-center gap-3 sm:flex-row">
          <WarmButton size="xl">
            Start Syncing — It&apos;s Free
          </WarmButton>
          <WarmButton variant="outline" size="xl">
            See How It Works
          </WarmButton>
        </div>

        {/* Hero illustration: mock browser window */}
        <div className="relative w-full max-w-4xl">
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2 shadow-[0_20px_60px_-15px_rgba(60,45,30,0.12)]">
            {/* Browser chrome bar */}
            <div className="flex items-center gap-2 rounded-t-xl bg-[hsl(var(--muted))] px-4 py-2.5">
              <div className="flex gap-1.5">
                <div className="h-3 w-3 rounded-full bg-red-400/60" />
                <div className="h-3 w-3 rounded-full bg-amber-400/60" />
                <div className="h-3 w-3 rounded-full bg-green-400/60" />
              </div>
              <div className="ml-2 flex-1 rounded-md bg-[hsl(var(--card))] px-3 py-1 text-xs text-[hsl(var(--muted-foreground))]">
                app.schoolbridge.io/dashboard
              </div>
            </div>

            {/* Mock dashboard content */}
            <div className="rounded-b-xl bg-[hsl(var(--background-secondary))] p-6 md:p-8">
              <div className="grid gap-4 md:grid-cols-3">
                {/* Stat card 1 */}
                <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
                  <div className="mb-1 text-2xl">
                    <span role="img" aria-label="calendar">
                      &#x1F4C5;
                    </span>
                  </div>
                  <div className="text-2xl font-bold text-[hsl(var(--foreground))]">
                    23
                  </div>
                  <div className="text-xs text-[hsl(var(--muted-foreground))]">
                    Events synced this month
                  </div>
                </div>
                {/* Stat card 2 */}
                <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
                  <div className="mb-1 text-2xl">
                    <span role="img" aria-label="camera">
                      &#x1F4F8;
                    </span>
                  </div>
                  <div className="text-2xl font-bold text-[hsl(var(--foreground))]">
                    147
                  </div>
                  <div className="text-xs text-[hsl(var(--muted-foreground))]">
                    Photos saved to library
                  </div>
                </div>
                {/* Stat card 3 */}
                <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
                  <div className="mb-1 text-2xl">
                    <span role="img" aria-label="check">
                      &#x2705;
                    </span>
                  </div>
                  <div className="text-2xl font-bold text-[hsl(var(--foreground))]">
                    100%
                  </div>
                  <div className="text-xs text-[hsl(var(--muted-foreground))]">
                    Approval rate via Discord
                  </div>
                </div>
              </div>

              {/* Mock event list */}
              <div className="mt-4 space-y-2">
                {[
                  {
                    icon: "\uD83C\uDFD5\uFE0F",
                    title: "Field Trip: Nature Center",
                    date: "Mar 15",
                    status: "Synced",
                    statusColor: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
                  },
                  {
                    icon: "\uD83D\uDCF7",
                    title: "Spring Picture Day",
                    date: "Mar 22",
                    status: "Pending",
                    statusColor: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
                  },
                  {
                    icon: "\uD83C\uDF89",
                    title: "Class Party: Spring Celebration",
                    date: "Mar 28",
                    status: "Approved",
                    statusColor: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
                  },
                ].map((event) => (
                  <div
                    key={event.title}
                    className="flex items-center justify-between rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xl">{event.icon}</span>
                      <div>
                        <div className="text-sm font-medium text-[hsl(var(--foreground))]">
                          {event.title}
                        </div>
                        <div className="text-xs text-[hsl(var(--muted-foreground))]">
                          {event.date}
                        </div>
                      </div>
                    </div>
                    <span
                      className={cn(
                        "rounded-md px-2.5 py-0.5 text-xs font-semibold",
                        event.statusColor,
                      )}
                    >
                      {event.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}

/* ── Features Section ─────────────────────────────────────────── */

function FeaturesSection() {
  return (
    <Section id="features" className="bg-[hsl(var(--background-secondary))]">
      <div className="mb-12 text-center">
        <span className="mb-3 inline-block text-sm font-semibold uppercase tracking-wider text-[hsl(var(--primary))]">
          Features
        </span>
        <h2 className="mb-4 text-3xl font-extrabold tracking-tight text-[hsl(var(--foreground))] md:text-4xl">
          Everything Parents Actually Need
        </h2>
        <p className="mx-auto max-w-2xl text-base text-[hsl(var(--muted-foreground))]">
          No more screenshots of ClassDojo posts. No more forgetting pajama day.
          SchoolBridge keeps your family organized automatically.
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <FeatureCard
          emoji={"\uD83D\uDCC5"}
          title="Calendar Auto-Sync"
          description="School events from ClassDojo land directly in Google Calendar or Apple Calendar. Color-coded by type, so you know at a glance what to prepare for."
          accent="primary"
        />
        <FeatureCard
          emoji={"\uD83D\uDCF8"}
          title="Photo Library Backup"
          description="Every class photo, art project shot, and field trip snapshot is automatically saved to your photo library. Organized by date and child. Never lose a memory."
          accent="accent"
        />
        <FeatureCard
          emoji={"\uD83D\uDCAC"}
          title="Discord Approval Flow"
          description="Get a ping in your family Discord when a new event is detected. React to approve, skip, or snooze. Both parents can stay in sync without an app download."
          accent="info"
        />
        <FeatureCard
          emoji={"\uD83C\uDFEB"}
          title="Multi-School Support"
          description="Have kids at different schools? Connect multiple ClassDojo accounts and see everything in one place. Each child gets their own color-coded feed."
          accent="success"
        />
        <FeatureCard
          emoji={"\uD83D\uDD14"}
          title="Smart Reminders"
          description="SchoolBridge doesn't just sync — it reminds. Get a heads-up the morning of picture day, the night before a bake sale, or an hour before early pickup."
          accent="primary"
        />
        <FeatureCard
          emoji={"\uD83D\uDD12"}
          title="Private & Secure"
          description="Your family data never leaves your accounts. We use read-only access to ClassDojo and write-only to your calendar. No ads, no data selling, ever."
          accent="accent"
        />
      </div>
    </Section>
  );
}

/* ── How It Works Section ─────────────────────────────────────── */

function HowItWorksSection() {
  return (
    <Section id="how-it-works">
      <div className="mb-16 text-center">
        <span className="mb-3 inline-block text-sm font-semibold uppercase tracking-wider text-[hsl(var(--primary))]">
          How It Works
        </span>
        <h2 className="mb-4 text-3xl font-extrabold tracking-tight text-[hsl(var(--foreground))] md:text-4xl">
          Three Steps to Never Forgetting Again
        </h2>
      </div>

      <div className="relative">
        {/* Connecting line (desktop only) */}
        <div className="absolute left-0 right-0 top-[52px] hidden h-0.5 bg-gradient-to-r from-transparent via-[hsl(var(--border))] to-transparent md:block" />

        <div className="grid gap-12 md:grid-cols-3 md:gap-8">
          <StepCard
            number={1}
            emoji={"\uD83D\uDD17"}
            title="Connect ClassDojo"
            description="Link your ClassDojo account in two clicks. We'll start watching for new posts from your child's school."
          />
          <StepCard
            number={2}
            emoji={"\u2699\uFE0F"}
            title="Choose Your Flow"
            description="Pick where events go — Google Calendar, Apple Calendar, or both. Add Discord for the approval flow. Set up photo backup."
          />
          <StepCard
            number={3}
            emoji={"\u2728"}
            title="Relax, You're Synced"
            description="New ClassDojo posts automatically become calendar events and saved photos. You'll never scramble to find that one post again."
          />
        </div>
      </div>
    </Section>
  );
}

/* ── Testimonials Section ─────────────────────────────────────── */

function TestimonialsSection() {
  return (
    <Section
      id="testimonials"
      className="bg-[hsl(var(--background-secondary))]"
    >
      <div className="mb-12 text-center">
        <span className="mb-3 inline-block text-sm font-semibold uppercase tracking-wider text-[hsl(var(--primary))]">
          Parents Love It
        </span>
        <h2 className="mb-4 text-3xl font-extrabold tracking-tight text-[hsl(var(--foreground))] md:text-4xl">
          Trusted by Busy Families
        </h2>
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        <TestimonialCard
          emoji={"\uD83D\uDC69\u200D\uD83D\uDC67\u200D\uD83D\uDC66"}
          quote="I used to screenshot every ClassDojo post and manually add events to my calendar. SchoolBridge does it all in seconds. Last week my husband actually showed up to the school concert — because Discord pinged him."
          name="Sarah M."
          role="Mom of 2, Lincoln Elementary"
        />
        <TestimonialCard
          emoji={"\uD83D\uDC68\u200D\uD83D\uDC67"}
          quote="The photo backup alone is worth it. I have every class photo organized by month without lifting a finger. My daughter loves scrolling through them on movie night."
          name="James K."
          role="Dad of 1, Riverside Academy"
        />
        <TestimonialCard
          emoji={"\uD83D\uDC69\u200D\uD83D\uDC67\u200D\uD83D\uDC67"}
          quote="Three kids, two schools, one SchoolBridge account. Color-coded calendars mean I know exactly which kid has what event. The approval flow through Discord is genius."
          name="Maria L."
          role="Mom of 3, Oak Grove & Pinecrest"
        />
      </div>
    </Section>
  );
}

/* ── Bottom CTA Section ───────────────────────────────────────── */

function BottomCTASection() {
  return (
    <Section>
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[hsl(var(--primary))] via-[hsl(32,90%,48%)] to-[hsl(var(--accent))] p-8 text-center text-white shadow-[0_20px_60px_-15px_rgba(245,145,21,0.30)] md:p-16">
        {/* Decorative circles */}
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-8 -left-8 h-32 w-32 rounded-full bg-white/10" aria-hidden="true" />
        <div className="pointer-events-none absolute right-1/4 top-1/3 h-20 w-20 rounded-full bg-white/5" aria-hidden="true" />

        <div className="relative">
          <div className="mb-4 text-5xl">
            <span role="img" aria-label="bridge">
              &#x1F309;
            </span>
          </div>
          <h2 className="mb-4 text-3xl font-extrabold tracking-tight md:text-4xl">
            Bridge the Gap Between School and Home
          </h2>
          <p className="mx-auto mb-8 max-w-xl text-base leading-relaxed text-white/85">
            Join thousands of families who never miss a school moment. Free to
            start, no credit card required, set up in under 2 minutes.
          </p>
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <button className="inline-flex h-14 items-center justify-center gap-2 rounded-2xl bg-white px-9 text-base font-bold text-[hsl(var(--primary))] shadow-[0_4px_15px_-3px_rgba(0,0,0,0.15)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_25px_-5px_rgba(0,0,0,0.20)] active:translate-y-0">
              Get Started Free
            </button>
            <button className="inline-flex h-14 items-center justify-center gap-2 rounded-2xl border-2 border-white/30 bg-white/10 px-9 text-base font-semibold text-white backdrop-blur-sm transition-all duration-200 hover:bg-white/20 hover:border-white/50">
              Watch Demo
            </button>
          </div>
        </div>
      </div>
    </Section>
  );
}

/* ── Footer ───────────────────────────────────────────────────── */

function Footer() {
  return (
    <footer className="border-t border-[hsl(var(--border))] bg-[hsl(var(--background))]">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 md:flex-row">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-[hsl(var(--primary))] to-[hsl(var(--accent))]">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 10a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v0" />
              <path d="M2 10h20" />
            </svg>
          </div>
          <span className="text-sm font-semibold text-[hsl(var(--foreground))]">
            SchoolBridge
          </span>
        </div>

        <div className="flex gap-6">
          <a
            href="/privacy"
            className="text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
          >
            Privacy Policy
          </a>
          <a
            href="/terms"
            className="text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
          >
            Terms of Service
          </a>
          <a
            href="mailto:hello@schoolbridge.io"
            className="text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
          >
            Contact
          </a>
        </div>

        <p className="text-xs text-[hsl(var(--muted-foreground))]">
          Made with care for busy parents.
        </p>
      </div>
    </footer>
  );
}

/* ── Page Component ───────────────────────────────────────────── */

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[hsl(var(--background))]">
      <Navbar />
      <HeroSection />
      <FeaturesSection />
      <HowItWorksSection />
      <TestimonialsSection />
      <BottomCTASection />
      <Footer />
    </div>
  );
}

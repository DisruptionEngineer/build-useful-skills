"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

/* ─────────────────────────────────────────────────────────────── */
/*  Badge                                                         */
/*  Status badges for SchoolBridge event sync states.             */
/*                                                                */
/*  Statuses:                                                     */
/*    pending  = amber  — awaiting approval or sync               */
/*    approved = green  — approved through Discord flow            */
/*    skipped  = gray   — deliberately skipped by parent/admin    */
/*    failed   = red    — sync or delivery failed                 */
/*    synced   = blue   — successfully synced to calendar/photos  */
/* ─────────────────────────────────────────────────────────────── */

const badgeVariants = cva(
  [
    "inline-flex items-center gap-1.5",
    "font-medium transition-colors",
    "border",
    "select-none",
  ],
  {
    variants: {
      variant: {
        /** Default neutral badge */
        default: [
          "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]",
          "border-[hsl(var(--border))]",
        ],

        /** Pending: warm amber — waiting for action */
        pending: [
          "bg-[hsl(var(--status-pending-bg))] text-[hsl(var(--status-pending))]",
          "border-[hsl(var(--status-pending)/0.25)]",
        ],

        /** Approved: green — Discord approval received */
        approved: [
          "bg-[hsl(var(--status-approved-bg))] text-[hsl(var(--status-approved))]",
          "border-[hsl(var(--status-approved)/0.25)]",
        ],

        /** Skipped: warm gray — intentionally skipped */
        skipped: [
          "bg-[hsl(var(--status-skipped-bg))] text-[hsl(var(--status-skipped))]",
          "border-[hsl(var(--status-skipped)/0.25)]",
        ],

        /** Failed: red — error or failure */
        failed: [
          "bg-[hsl(var(--status-failed-bg))] text-[hsl(var(--status-failed))]",
          "border-[hsl(var(--status-failed)/0.25)]",
        ],

        /** Synced: blue — successfully synced */
        synced: [
          "bg-[hsl(var(--status-synced-bg))] text-[hsl(var(--status-synced))]",
          "border-[hsl(var(--status-synced)/0.25)]",
        ],

        /** Primary: amber filled for general use */
        primary: [
          "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]",
          "border-transparent",
        ],

        /** Secondary: cream/sand filled */
        secondary: [
          "bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]",
          "border-[hsl(var(--border))]",
        ],

        /** Outline: transparent with border */
        outline: [
          "bg-transparent text-[hsl(var(--foreground))]",
          "border-[hsl(var(--border))]",
        ],

        /** Destructive: red filled */
        destructive: [
          "bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))]",
          "border-transparent",
        ],
      },

      size: {
        sm: "text-xs px-2 py-0.5 rounded-md",
        default: "text-xs px-2.5 py-1 rounded-lg",
        lg: "text-sm px-3 py-1 rounded-lg",
      },
    },

    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

/* ─────────────────────────────────────────────────────────────── */
/*  Status icon mapping                                           */
/* ─────────────────────────────────────────────────────────────── */

type StatusVariant = "pending" | "approved" | "skipped" | "failed" | "synced";

const statusIcons: Record<StatusVariant, React.ReactNode> = {
  pending: (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  approved: (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  ),
  skipped: (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </svg>
  ),
  failed: (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  ),
  synced: (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  ),
};

/* ─────────────────────────────────────────────────────────────── */
/*  Badge Component                                               */
/* ─────────────────────────────────────────────────────────────── */

interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /** Show a status icon before the label */
  withIcon?: boolean;
  /** Pulsing dot indicator (useful for "pending" or "syncing") */
  pulse?: boolean;
}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, size, withIcon = false, pulse = false, children, ...props }, ref) => {
    const isStatus = variant && variant in statusIcons;

    return (
      <span
        ref={ref}
        className={cn(badgeVariants({ variant, size }), className)}
        {...props}
      >
        {/* Pulsing dot */}
        {pulse && (
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-40" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
          </span>
        )}

        {/* Status icon */}
        {withIcon && isStatus && statusIcons[variant as StatusVariant]}

        {children}
      </span>
    );
  },
);
Badge.displayName = "Badge";

/* ─────────────────────────────────────────────────────────────── */
/*  StatusBadge — convenience wrapper for event statuses          */
/* ─────────────────────────────────────────────────────────────── */

interface StatusBadgeProps extends Omit<BadgeProps, "variant"> {
  status: StatusVariant;
}

const statusLabels: Record<StatusVariant, string> = {
  pending: "Pending",
  approved: "Approved",
  skipped: "Skipped",
  failed: "Failed",
  synced: "Synced",
};

const StatusBadge = React.forwardRef<HTMLSpanElement, StatusBadgeProps>(
  ({ status, children, ...props }, ref) => (
    <Badge
      ref={ref}
      variant={status}
      withIcon
      pulse={status === "pending"}
      {...props}
    >
      {children ?? statusLabels[status]}
    </Badge>
  ),
);
StatusBadge.displayName = "StatusBadge";

export { Badge, StatusBadge, badgeVariants };
export type { BadgeProps, StatusBadgeProps, StatusVariant };

"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

/* ─────────────────────────────────────────────────────────────── */
/*  Button                                                        */
/*  Warm, rounded button with multiple variants.                  */
/*  Primary uses warm amber, with subtle hover/active transitions */
/* ─────────────────────────────────────────────────────────────── */

const buttonVariants = cva(
  [
    /* Base styles */
    "inline-flex items-center justify-center gap-2",
    "whitespace-nowrap font-medium",
    "transition-all duration-200 ease-out",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2",
    "focus-visible:ring-offset-[hsl(var(--background))]",
    "disabled:pointer-events-none disabled:opacity-50",
    "select-none",
    /* Icon sizing within buttons */
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        /** Warm amber primary — the hero button */
        primary: [
          "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]",
          "shadow-[0_1px_3px_0_rgba(60,45,30,0.10),0_1px_2px_-1px_rgba(60,45,30,0.06)]",
          "hover:bg-[hsl(var(--primary-hover))]",
          "hover:shadow-[0_4px_6px_-1px_rgba(60,45,30,0.12),0_2px_4px_-2px_rgba(60,45,30,0.08)]",
          "hover:-translate-y-px",
          "active:translate-y-0 active:shadow-[0_1px_2px_0_rgba(60,45,30,0.08)]",
        ],

        /** Soft cream/sand secondary */
        secondary: [
          "bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]",
          "border border-[hsl(var(--border))]",
          "hover:bg-[hsl(var(--secondary-hover))]",
          "hover:border-[hsl(var(--border-strong))]",
          "active:bg-[hsl(var(--secondary))]",
        ],

        /** Outline — transparent bg with warm border */
        outline: [
          "bg-transparent text-[hsl(var(--foreground))]",
          "border border-[hsl(var(--border))]",
          "hover:bg-[hsl(var(--muted))]",
          "hover:border-[hsl(var(--border-strong))]",
          "hover:text-[hsl(var(--foreground))]",
        ],

        /** Ghost — no border, subtle hover */
        ghost: [
          "bg-transparent text-[hsl(var(--foreground))]",
          "hover:bg-[hsl(var(--muted))]",
          "hover:text-[hsl(var(--foreground))]",
        ],

        /** Destructive — red danger button */
        destructive: [
          "bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))]",
          "shadow-[0_1px_3px_0_rgba(220,38,38,0.15)]",
          "hover:bg-[hsl(var(--destructive-hover))]",
          "hover:shadow-[0_4px_6px_-1px_rgba(220,38,38,0.20)]",
          "hover:-translate-y-px",
          "active:translate-y-0",
        ],

        /** Link style — looks like a text link */
        link: [
          "bg-transparent text-[hsl(var(--primary))]",
          "underline-offset-4 hover:underline",
          "p-0 h-auto",
        ],

        /** Accent — coral/terracotta for special actions */
        accent: [
          "bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]",
          "shadow-[0_1px_3px_0_rgba(60,45,30,0.10)]",
          "hover:bg-[hsl(var(--accent-hover))]",
          "hover:shadow-[0_4px_6px_-1px_rgba(60,45,30,0.12)]",
          "hover:-translate-y-px",
          "active:translate-y-0",
        ],
      },

      size: {
        sm: "h-9 px-3.5 text-sm rounded-lg",
        default: "h-10 px-5 text-sm rounded-xl",
        lg: "h-12 px-7 text-base rounded-xl",
        xl: "h-14 px-9 text-base font-semibold rounded-2xl",
        icon: "h-10 w-10 rounded-xl",
        "icon-sm": "h-8 w-8 rounded-lg",
        "icon-lg": "h-12 w-12 rounded-xl",
      },
    },

    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  },
);

/* ─────────────────────────────────────────────────────────────── */
/*  Button Component                                              */
/* ─────────────────────────────────────────────────────────────── */

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Render as child element (uses Radix Slot) */
  asChild?: boolean;
  /** Show a loading spinner */
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      loading = false,
      disabled,
      children,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";

    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? (
          <>
            <svg
              className="animate-spin -ml-0.5"
              xmlns="http://www.w3.org/2000/svg"
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
            {children}
          </>
        ) : (
          children
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
export type { ButtonProps };

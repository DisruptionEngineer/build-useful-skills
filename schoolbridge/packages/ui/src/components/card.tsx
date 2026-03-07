"use client";

import * as React from "react";
import { cn } from "../lib/utils";

/* ─────────────────────────────────────────────────────────────── */
/*  Card                                                          */
/*  Warm, rounded card with subtle shadow and hover lift.         */
/* ─────────────────────────────────────────────────────────────── */

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Add a subtle lift effect on hover */
  hoverable?: boolean;
  /** Remove padding (useful for image cards) */
  noPadding?: boolean;
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, hoverable = false, noPadding = false, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--card-foreground))]",
        "shadow-[0_1px_3px_0_rgba(60,45,30,0.06),0_1px_2px_-1px_rgba(60,45,30,0.06)]",
        hoverable && [
          "transition-all duration-200 ease-out",
          "hover:-translate-y-0.5",
          "hover:shadow-[0_8px_25px_-5px_rgba(60,45,30,0.10),0_4px_10px_-4px_rgba(60,45,30,0.06)]",
          "hover:border-[hsl(var(--border-strong))]",
        ],
        !noPadding && "p-6",
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = "Card";

/* ─────────────────────────────────────────────────────────────── */
/*  Card Header                                                   */
/* ─────────────────────────────────────────────────────────────── */

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-1.5 pb-4", className)}
    {...props}
  />
));
CardHeader.displayName = "CardHeader";

/* ─────────────────────────────────────────────────────────────── */
/*  Card Title                                                    */
/* ─────────────────────────────────────────────────────────────── */

const CardTitle = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-tight tracking-tight text-[hsl(var(--foreground))]",
      className,
    )}
    {...props}
  />
));
CardTitle.displayName = "CardTitle";

/* ─────────────────────────────────────────────────────────────── */
/*  Card Description                                              */
/* ─────────────────────────────────────────────────────────────── */

const CardDescription = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm text-[hsl(var(--muted-foreground))]", className)}
    {...props}
  />
));
CardDescription.displayName = "CardDescription";

/* ─────────────────────────────────────────────────────────────── */
/*  Card Content                                                  */
/* ─────────────────────────────────────────────────────────────── */

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("", className)} {...props} />
));
CardContent.displayName = "CardContent";

/* ─────────────────────────────────────────────────────────────── */
/*  Card Footer                                                   */
/* ─────────────────────────────────────────────────────────────── */

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "flex items-center pt-4 border-t border-[hsl(var(--border))]",
      className,
    )}
    {...props}
  />
));
CardFooter.displayName = "CardFooter";

/* ─────────────────────────────────────────────────────────────── */
/*  Card Highlight                                                */
/*  A special card variant with a colored top border stripe.      */
/* ─────────────────────────────────────────────────────────────── */

type HighlightColor = "primary" | "accent" | "success" | "warning" | "danger";

interface CardHighlightProps extends CardProps {
  /** Color of the top border stripe */
  highlight?: HighlightColor;
}

const highlightColors: Record<HighlightColor, string> = {
  primary: "border-t-[hsl(var(--primary))]",
  accent: "border-t-[hsl(var(--accent))]",
  success: "border-t-emerald-500",
  warning: "border-t-amber-500",
  danger: "border-t-red-500",
};

const CardHighlight = React.forwardRef<HTMLDivElement, CardHighlightProps>(
  ({ className, highlight = "primary", ...props }, ref) => (
    <Card
      ref={ref}
      className={cn("border-t-[3px]", highlightColors[highlight], className)}
      {...props}
    />
  ),
);
CardHighlight.displayName = "CardHighlight";

export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  CardHighlight,
};
export type { CardProps, CardHighlightProps, HighlightColor };

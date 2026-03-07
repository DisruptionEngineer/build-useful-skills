"use client";

import * as React from "react";
import { cn } from "../lib/utils";

/* ─────────────────────────────────────────────────────────────── */
/*  Input                                                         */
/*  Warm-styled input with rounded borders and amber focus ring.  */
/* ─────────────────────────────────────────────────────────────── */

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Optional icon rendered on the left side */
  leftIcon?: React.ReactNode;
  /** Optional icon or element rendered on the right side */
  rightIcon?: React.ReactNode;
  /** Error state — shows red border + ring */
  error?: boolean;
  /** Error message text displayed below the input */
  errorMessage?: string;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      type = "text",
      leftIcon,
      rightIcon,
      error = false,
      errorMessage,
      disabled,
      ...props
    },
    ref,
  ) => {
    if (leftIcon || rightIcon) {
      return (
        <div className="relative">
          {/* Left icon */}
          {leftIcon && (
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-[hsl(var(--muted-foreground))]">
              {leftIcon}
            </div>
          )}

          {/* Input */}
          <input
            type={type}
            className={cn(
              /* Base */
              "flex h-10 w-full rounded-xl border bg-[hsl(var(--card))] text-sm text-[hsl(var(--foreground))]",
              "transition-all duration-200 ease-out",
              /* Padding */
              leftIcon ? "pl-10" : "px-4",
              rightIcon ? "pr-10" : "px-4",
              leftIcon && !rightIcon && "pr-4",
              !leftIcon && rightIcon && "pl-4",
              /* Border */
              error
                ? "border-[hsl(var(--destructive))]"
                : "border-[hsl(var(--input))]",
              /* Placeholder */
              "placeholder:text-[hsl(var(--muted-foreground)/0.6)]",
              /* Focus */
              "focus-visible:outline-none",
              error
                ? "focus-visible:ring-2 focus-visible:ring-[hsl(var(--destructive)/0.25)]"
                : "focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring)/0.20)] focus-visible:border-[hsl(var(--primary))]",
              /* Hover */
              !disabled &&
                !error &&
                "hover:border-[hsl(var(--border-strong))]",
              /* Disabled */
              "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-[hsl(var(--muted))]",
              /* File input */
              "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-[hsl(var(--foreground))]",
              className,
            )}
            ref={ref}
            disabled={disabled}
            aria-invalid={error || undefined}
            aria-describedby={errorMessage ? `${props.id}-error` : undefined}
            {...props}
          />

          {/* Right icon */}
          {rightIcon && (
            <div className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-[hsl(var(--muted-foreground))]">
              {rightIcon}
            </div>
          )}

          {/* Error message */}
          {errorMessage && (
            <p
              id={props.id ? `${props.id}-error` : undefined}
              className="mt-1.5 text-xs text-[hsl(var(--destructive))]"
              role="alert"
            >
              {errorMessage}
            </p>
          )}
        </div>
      );
    }

    return (
      <div>
        <input
          type={type}
          className={cn(
            /* Base */
            "flex h-10 w-full rounded-xl border bg-[hsl(var(--card))] px-4 text-sm text-[hsl(var(--foreground))]",
            "transition-all duration-200 ease-out",
            /* Border */
            error
              ? "border-[hsl(var(--destructive))]"
              : "border-[hsl(var(--input))]",
            /* Placeholder */
            "placeholder:text-[hsl(var(--muted-foreground)/0.6)]",
            /* Focus */
            "focus-visible:outline-none",
            error
              ? "focus-visible:ring-2 focus-visible:ring-[hsl(var(--destructive)/0.25)]"
              : "focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring)/0.20)] focus-visible:border-[hsl(var(--primary))]",
            /* Hover */
            !disabled &&
              !error &&
              "hover:border-[hsl(var(--border-strong))]",
            /* Disabled */
            "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-[hsl(var(--muted))]",
            /* File input */
            "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-[hsl(var(--foreground))]",
            className,
          )}
          ref={ref}
          disabled={disabled}
          aria-invalid={error || undefined}
          aria-describedby={errorMessage ? `${props.id}-error` : undefined}
          {...props}
        />

        {/* Error message */}
        {errorMessage && (
          <p
            id={props.id ? `${props.id}-error` : undefined}
            className="mt-1.5 text-xs text-[hsl(var(--destructive))]"
            role="alert"
          >
            {errorMessage}
          </p>
        )}
      </div>
    );
  },
);
Input.displayName = "Input";

/* ─────────────────────────────────────────────────────────────── */
/*  Textarea                                                      */
/*  Matches input styling for multi-line text.                    */
/* ─────────────────────────────────────────────────────────────── */

interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
  errorMessage?: string;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error = false, errorMessage, disabled, ...props }, ref) => (
    <div>
      <textarea
        className={cn(
          "flex min-h-[100px] w-full rounded-xl border bg-[hsl(var(--card))] px-4 py-3 text-sm text-[hsl(var(--foreground))]",
          "transition-all duration-200 ease-out resize-y",
          error
            ? "border-[hsl(var(--destructive))]"
            : "border-[hsl(var(--input))]",
          "placeholder:text-[hsl(var(--muted-foreground)/0.6)]",
          "focus-visible:outline-none",
          error
            ? "focus-visible:ring-2 focus-visible:ring-[hsl(var(--destructive)/0.25)]"
            : "focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring)/0.20)] focus-visible:border-[hsl(var(--primary))]",
          !disabled &&
            !error &&
            "hover:border-[hsl(var(--border-strong))]",
          "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-[hsl(var(--muted))]",
          className,
        )}
        ref={ref}
        disabled={disabled}
        aria-invalid={error || undefined}
        {...props}
      />
      {errorMessage && (
        <p className="mt-1.5 text-xs text-[hsl(var(--destructive))]" role="alert">
          {errorMessage}
        </p>
      )}
    </div>
  ),
);
Textarea.displayName = "Textarea";

/* ─────────────────────────────────────────────────────────────── */
/*  Label                                                         */
/*  Form label with warm styling.                                 */
/* ─────────────────────────────────────────────────────────────── */

interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
}

const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, required, children, ...props }, ref) => (
    <label
      ref={ref}
      className={cn(
        "text-sm font-medium text-[hsl(var(--foreground))] leading-none",
        "peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
        className,
      )}
      {...props}
    >
      {children}
      {required && (
        <span className="ml-0.5 text-[hsl(var(--destructive))]" aria-hidden="true">
          *
        </span>
      )}
    </label>
  ),
);
Label.displayName = "Label";

/* ─────────────────────────────────────────────────────────────── */
/*  FormField                                                     */
/*  Convenience wrapper: Label + Input + error message.           */
/* ─────────────────────────────────────────────────────────────── */

interface FormFieldProps {
  label: string;
  htmlFor: string;
  required?: boolean;
  error?: boolean;
  errorMessage?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}

function FormField({
  label,
  htmlFor,
  required,
  hint,
  children,
  className,
}: FormFieldProps) {
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-baseline justify-between">
        <Label htmlFor={htmlFor} required={required}>
          {label}
        </Label>
        {hint && (
          <span className="text-xs text-[hsl(var(--muted-foreground))]">
            {hint}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

export { Input, Textarea, Label, FormField };
export type { InputProps, TextareaProps, LabelProps, FormFieldProps };

"use client";

import * as React from "react";
import { cn } from "../lib/utils";

/* ─────────────────────────────────────────────────────────────── */
/*  Sidebar                                                       */
/*  Dashboard sidebar with navigation, warm accent on active,     */
/*  logo area at top, and collapsible behavior.                   */
/* ─────────────────────────────────────────────────────────────── */

/* ── Context ──────────────────────────────────────────────────── */

interface SidebarContextValue {
  collapsed: boolean;
  setCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  mobileOpen: boolean;
  setMobileOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

const SidebarContext = React.createContext<SidebarContextValue | null>(null);

function useSidebar(): SidebarContextValue {
  const ctx = React.useContext(SidebarContext);
  if (!ctx) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return ctx;
}

/* ── Provider ─────────────────────────────────────────────────── */

interface SidebarProviderProps {
  children: React.ReactNode;
  defaultCollapsed?: boolean;
}

function SidebarProvider({
  children,
  defaultCollapsed = false,
}: SidebarProviderProps) {
  const [collapsed, setCollapsed] = React.useState(defaultCollapsed);
  const [mobileOpen, setMobileOpen] = React.useState(false);

  const value = React.useMemo(
    () => ({ collapsed, setCollapsed, mobileOpen, setMobileOpen }),
    [collapsed, mobileOpen],
  );

  return (
    <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>
  );
}

/* ── Sidebar Root ─────────────────────────────────────────────── */

interface SidebarProps extends React.HTMLAttributes<HTMLElement> {}

const Sidebar = React.forwardRef<HTMLElement, SidebarProps>(
  ({ className, children, ...props }, ref) => {
    const { collapsed, mobileOpen, setMobileOpen } = useSidebar();

    return (
      <>
        {/* Mobile overlay */}
        {mobileOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
        )}

        <aside
          ref={ref}
          className={cn(
            /* Base layout */
            "fixed inset-y-0 left-0 z-50 flex flex-col",
            "bg-[hsl(var(--card))] border-r border-[hsl(var(--border))]",
            "transition-all duration-300 ease-out",
            /* Shadow */
            "shadow-[1px_0_3px_0_rgba(60,45,30,0.04)]",
            /* Width */
            collapsed ? "w-[72px]" : "w-[280px]",
            /* Mobile: off-screen by default */
            mobileOpen ? "translate-x-0" : "-translate-x-full",
            "lg:translate-x-0",
            className,
          )}
          {...props}
        >
          {children}
        </aside>
      </>
    );
  },
);
Sidebar.displayName = "Sidebar";

/* ── Sidebar Header / Logo Area ───────────────────────────────── */

interface SidebarHeaderProps extends React.HTMLAttributes<HTMLDivElement> {}

const SidebarHeader = React.forwardRef<HTMLDivElement, SidebarHeaderProps>(
  ({ className, children, ...props }, ref) => {
    const { collapsed } = useSidebar();

    return (
      <div
        ref={ref}
        className={cn(
          "flex items-center gap-3 border-b border-[hsl(var(--border))]",
          "h-16 shrink-0",
          collapsed ? "justify-center px-2" : "px-5",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  },
);
SidebarHeader.displayName = "SidebarHeader";

/* ── Sidebar Logo ─────────────────────────────────────────────── */

interface SidebarLogoProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Icon / logo element (always visible) */
  icon: React.ReactNode;
  /** App name text (hidden when collapsed) */
  name?: string;
  /** Subtitle below app name */
  subtitle?: string;
}

function SidebarLogo({
  icon,
  name = "SchoolBridge",
  subtitle,
  className,
  ...props
}: SidebarLogoProps) {
  const { collapsed } = useSidebar();

  return (
    <div className={cn("flex items-center gap-3 min-w-0", className)} {...props}>
      {/* Icon container */}
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[hsl(var(--primary))] to-[hsl(var(--accent))] text-white shadow-sm">
        {icon}
      </div>

      {/* Text (hidden when collapsed) */}
      {!collapsed && (
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-bold tracking-tight text-[hsl(var(--foreground))] truncate">
            {name}
          </span>
          {subtitle && (
            <span className="text-[10px] text-[hsl(var(--muted-foreground))] truncate">
              {subtitle}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Sidebar Content (scrollable nav area) ────────────────────── */

interface SidebarContentProps extends React.HTMLAttributes<HTMLDivElement> {}

const SidebarContent = React.forwardRef<HTMLDivElement, SidebarContentProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex-1 overflow-y-auto overflow-x-hidden py-3", className)}
      {...props}
    />
  ),
);
SidebarContent.displayName = "SidebarContent";

/* ── Sidebar Section ──────────────────────────────────────────── */

interface SidebarSectionProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Section heading label */
  label?: string;
}

function SidebarSection({
  label,
  className,
  children,
  ...props
}: SidebarSectionProps) {
  const { collapsed } = useSidebar();

  return (
    <div className={cn("mb-2", className)} {...props}>
      {label && !collapsed && (
        <div className="px-5 py-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
            {label}
          </span>
        </div>
      )}
      {label && collapsed && (
        <div className="mx-auto my-2 h-px w-6 bg-[hsl(var(--border))]" />
      )}
      <nav className="flex flex-col gap-0.5 px-2">{children}</nav>
    </div>
  );
}

/* ── Sidebar Nav Item ─────────────────────────────────────────── */

interface SidebarNavItemProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Icon element */
  icon: React.ReactNode;
  /** Label text (hidden when sidebar is collapsed) */
  label: string;
  /** Active/selected state */
  active?: boolean;
  /** Optional badge count */
  badge?: number | string;
  /** Render as link */
  href?: string;
}

const SidebarNavItem = React.forwardRef<HTMLButtonElement, SidebarNavItemProps>(
  (
    {
      className,
      icon,
      label,
      active = false,
      badge,
      href,
      onClick,
      ...props
    },
    ref,
  ) => {
    const { collapsed, setMobileOpen } = useSidebar();

    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      setMobileOpen(false);
      onClick?.(e);
    };

    const content = (
      <>
        {/* Icon */}
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors",
            active
              ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
              : "text-[hsl(var(--muted-foreground))]",
          )}
        >
          {icon}
        </span>

        {/* Label */}
        {!collapsed && (
          <span
            className={cn(
              "flex-1 truncate text-sm text-left",
              active
                ? "font-semibold text-[hsl(var(--foreground))]"
                : "font-medium text-[hsl(var(--muted-foreground))]",
            )}
          >
            {label}
          </span>
        )}

        {/* Badge */}
        {badge !== undefined && !collapsed && (
          <span
            className={cn(
              "flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold",
              active
                ? "bg-[hsl(var(--primary)/0.15)] text-[hsl(var(--primary))]"
                : "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]",
            )}
          >
            {badge}
          </span>
        )}
      </>
    );

    return (
      <button
        ref={ref}
        className={cn(
          "group flex items-center gap-3 rounded-xl px-2.5 py-2",
          "transition-all duration-150 ease-out",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]",
          active
            ? "bg-[hsl(var(--primary-soft))]"
            : "hover:bg-[hsl(var(--muted))] active:bg-[hsl(var(--muted))]",
          collapsed && "justify-center px-2",
          className,
        )}
        onClick={handleClick}
        aria-current={active ? "page" : undefined}
        title={collapsed ? label : undefined}
        {...props}
      >
        {content}
      </button>
    );
  },
);
SidebarNavItem.displayName = "SidebarNavItem";

/* ── Sidebar Footer ───────────────────────────────────────────── */

interface SidebarFooterProps extends React.HTMLAttributes<HTMLDivElement> {}

const SidebarFooter = React.forwardRef<HTMLDivElement, SidebarFooterProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "shrink-0 border-t border-[hsl(var(--border))] p-3",
        className,
      )}
      {...props}
    />
  ),
);
SidebarFooter.displayName = "SidebarFooter";

/* ── Sidebar Toggle Button ────────────────────────────────────── */

function SidebarToggle({ className }: { className?: string }) {
  const { collapsed, setCollapsed } = useSidebar();

  return (
    <button
      onClick={() => setCollapsed((prev) => !prev)}
      className={cn(
        "hidden lg:flex items-center justify-center",
        "h-7 w-7 rounded-lg",
        "border border-[hsl(var(--border))] bg-[hsl(var(--card))]",
        "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]",
        "hover:bg-[hsl(var(--muted))]",
        "transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]",
        className,
      )}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn(
          "transition-transform duration-200",
          collapsed && "rotate-180",
        )}
      >
        <polyline points="15 18 9 12 15 6" />
      </svg>
    </button>
  );
}

/* ── Mobile Sidebar Trigger ───────────────────────────────────── */

function SidebarMobileTrigger({ className }: { className?: string }) {
  const { setMobileOpen } = useSidebar();

  return (
    <button
      onClick={() => setMobileOpen(true)}
      className={cn(
        "lg:hidden flex items-center justify-center",
        "h-10 w-10 rounded-xl",
        "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]",
        "hover:bg-[hsl(var(--muted))]",
        "transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]",
        className,
      )}
      aria-label="Open navigation"
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <line x1="3" y1="12" x2="21" y2="12" />
        <line x1="3" y1="6" x2="21" y2="6" />
        <line x1="3" y1="18" x2="21" y2="18" />
      </svg>
    </button>
  );
}

export {
  SidebarProvider,
  useSidebar,
  Sidebar,
  SidebarHeader,
  SidebarLogo,
  SidebarContent,
  SidebarSection,
  SidebarNavItem,
  SidebarFooter,
  SidebarToggle,
  SidebarMobileTrigger,
};
export type {
  SidebarContextValue,
  SidebarProviderProps,
  SidebarProps,
  SidebarHeaderProps,
  SidebarLogoProps,
  SidebarSectionProps,
  SidebarNavItemProps,
  SidebarFooterProps,
};

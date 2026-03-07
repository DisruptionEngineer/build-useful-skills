"use client";

import * as React from "react";
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarLogo,
  SidebarContent,
  SidebarSection,
  SidebarNavItem,
  SidebarFooter,
  SidebarToggle,
  SidebarMobileTrigger,
  useSidebar,
} from "@schoolbridge/ui/components/sidebar";
import { cn } from "@schoolbridge/ui/lib/utils";

/* ─────────────────────────────────────────────────────────────── */
/*  Dashboard Layout                                              */
/*  Shell layout with sidebar + main content area.                */
/* ─────────────────────────────────────────────────────────────── */

/* ── SVG Icons ────────────────────────────────────────────────── */

function IconBridge() {
  return (
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
      <path d="M4 10a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v0" />
      <path d="M6 14v6" />
      <path d="M18 14v6" />
      <path d="M2 10h20" />
      <path d="M12 10v4" />
      <path d="M8 10v2" />
      <path d="M16 10v2" />
    </svg>
  );
}

function IconDashboard() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="7" height="9" x="3" y="3" rx="1" />
      <rect width="7" height="5" x="14" y="3" rx="1" />
      <rect width="7" height="9" x="14" y="12" rx="1" />
      <rect width="7" height="5" x="3" y="16" rx="1" />
    </svg>
  );
}

function IconCalendar() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M3 10h18" />
    </svg>
  );
}

function IconPhotos() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </svg>
  );
}

function IconSchool() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 22V8l10-6 10 6v14" />
      <path d="M6 12v5" />
      <path d="M18 12v5" />
      <path d="M6 17h12" />
      <path d="M12 2v8" />
    </svg>
  );
}

function IconApproval() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconHelp() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </svg>
  );
}

function IconUser() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function IconBell() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

function IconActivity() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />
    </svg>
  );
}

/* ── Dashboard Sidebar Content ────────────────────────────────── */

function DashboardSidebar() {
  const [activeItem, setActiveItem] = React.useState("dashboard");

  return (
    <Sidebar>
      {/* Logo area */}
      <SidebarHeader>
        <SidebarLogo
          icon={<IconBridge />}
          name="SchoolBridge"
          subtitle="Sync your school life"
        />
      </SidebarHeader>

      {/* Navigation */}
      <SidebarContent>
        <SidebarSection label="Overview">
          <SidebarNavItem
            icon={<IconDashboard />}
            label="Dashboard"
            active={activeItem === "dashboard"}
            onClick={() => setActiveItem("dashboard")}
          />
          <SidebarNavItem
            icon={<IconActivity />}
            label="Activity Feed"
            active={activeItem === "activity"}
            onClick={() => setActiveItem("activity")}
            badge={3}
          />
        </SidebarSection>

        <SidebarSection label="Sync">
          <SidebarNavItem
            icon={<IconCalendar />}
            label="Calendar Events"
            active={activeItem === "calendar"}
            onClick={() => setActiveItem("calendar")}
          />
          <SidebarNavItem
            icon={<IconPhotos />}
            label="Photo Library"
            active={activeItem === "photos"}
            onClick={() => setActiveItem("photos")}
            badge={12}
          />
          <SidebarNavItem
            icon={<IconApproval />}
            label="Approvals"
            active={activeItem === "approvals"}
            onClick={() => setActiveItem("approvals")}
            badge={2}
          />
        </SidebarSection>

        <SidebarSection label="Manage">
          <SidebarNavItem
            icon={<IconSchool />}
            label="Schools"
            active={activeItem === "schools"}
            onClick={() => setActiveItem("schools")}
          />
          <SidebarNavItem
            icon={<IconSettings />}
            label="Settings"
            active={activeItem === "settings"}
            onClick={() => setActiveItem("settings")}
          />
        </SidebarSection>
      </SidebarContent>

      {/* Footer */}
      <SidebarFooter>
        <SidebarSection>
          <SidebarNavItem
            icon={<IconHelp />}
            label="Help & Support"
            active={activeItem === "help"}
            onClick={() => setActiveItem("help")}
          />
        </SidebarSection>
        <SidebarToggle />
      </SidebarFooter>
    </Sidebar>
  );
}

/* ── Top Header Bar ───────────────────────────────────────────── */

function DashboardHeader() {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-[hsl(var(--border))] bg-[hsl(var(--card)/0.85)] px-4 backdrop-blur-md lg:px-6">
      {/* Left: mobile trigger + breadcrumb area */}
      <div className="flex items-center gap-3">
        <SidebarMobileTrigger />
        <div className="hidden sm:block">
          <h1 className="text-sm font-semibold text-[hsl(var(--foreground))]">
            Dashboard
          </h1>
        </div>
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-2">
        {/* Notification bell */}
        <button
          className={cn(
            "relative flex h-9 w-9 items-center justify-center rounded-xl",
            "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]",
            "hover:bg-[hsl(var(--muted))] transition-colors",
          )}
          aria-label="Notifications"
        >
          <IconBell />
          {/* Notification dot */}
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[hsl(var(--accent))]" />
        </button>

        {/* User avatar */}
        <button
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-xl",
            "bg-[hsl(var(--primary-soft))] text-[hsl(var(--primary))]",
            "hover:bg-[hsl(var(--primary)/0.20)] transition-colors",
            "font-semibold text-sm",
          )}
          aria-label="User menu"
        >
          <IconUser />
        </button>
      </div>
    </header>
  );
}

/* ── Main Content Area ────────────────────────────────────────── */

function DashboardMain({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebar();

  return (
    <div
      className={cn(
        "min-h-screen transition-all duration-300 ease-out",
        /* Push content to the right of the sidebar */
        collapsed ? "lg:pl-[72px]" : "lg:pl-[280px]",
      )}
    >
      <DashboardHeader />
      <main className="p-4 lg:p-6">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
    </div>
  );
}

/* ── Exported Layout ──────────────────────────────────────────── */

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <div className="relative min-h-screen bg-[hsl(var(--background))]">
        <DashboardSidebar />
        <DashboardMain>{children}</DashboardMain>
      </div>
    </SidebarProvider>
  );
}

/**
 * SchoolBridge Tailwind CSS Theme Extension
 *
 * Warm & friendly design system for a school/parent platform.
 * Uses amber/orange primary tones, cream secondaries, coral accents,
 * and generous border radius throughout.
 *
 * Usage in tailwind.config.ts:
 *   import { schoolBridgeTheme } from "@schoolbridge/ui/theme";
 *   export default { theme: { extend: schoolBridgeTheme } };
 */

export const colors = {
  /* ── Primary: Warm Amber / Orange ─────────────────────────── */
  primary: {
    50: "#FFF8F0",
    100: "#FFEFD6",
    200: "#FFDBA8",
    300: "#FFC170",
    400: "#FFA63D",
    500: "#F59115",
    600: "#E67A09",
    700: "#BF5E09",
    800: "#984A10",
    900: "#7C3D10",
    950: "#431D06",
  },

  /* ── Secondary: Soft Cream / Sand ─────────────────────────── */
  secondary: {
    50: "#FEFDFB",
    100: "#FDF9F0",
    200: "#FAF0DC",
    300: "#F5E3C0",
    400: "#EFD19E",
    500: "#E4BA78",
    600: "#D4A05A",
    700: "#B27E42",
    800: "#8F6438",
    900: "#745230",
    950: "#3E2A18",
  },

  /* ── Accent: Friendly Coral / Terracotta ──────────────────── */
  accent: {
    50: "#FEF4F2",
    100: "#FDE7E2",
    200: "#FDD3CA",
    300: "#FAB3A5",
    400: "#F58872",
    500: "#EA6548",
    600: "#D84A2C",
    700: "#B53B21",
    800: "#95331F",
    900: "#7C2F20",
    950: "#43150C",
  },

  /* ── Background: Warm Off-White / Cream ───────────────────── */
  cream: {
    50: "#FFFEFB",
    100: "#FFFCF5",
    200: "#FFF8E8",
    300: "#FFF2D6",
    400: "#FFE8B8",
    500: "#FFDEA0",
  },

  /* ── Warm Neutrals (replaces cold grays) ──────────────────── */
  warm: {
    50: "#FAFAF8",
    100: "#F5F4F0",
    200: "#E8E6E0",
    300: "#D6D3CA",
    400: "#B8B4A8",
    500: "#9A9588",
    600: "#7D786C",
    700: "#665F54",
    800: "#514B42",
    900: "#3D3832",
    950: "#28241F",
  },

  /* ── Dark Mode: Warm Dark Tones ───────────────────────────── */
  warmDark: {
    50: "#F5F2EE",
    100: "#E6E0D8",
    200: "#C4BAA8",
    300: "#A09480",
    400: "#7A6E5C",
    500: "#574D3E",
    600: "#443B2F",
    700: "#352E24",
    800: "#2A251C",
    900: "#211D16",
    950: "#161310",
  },

  /* ── Semantic Status Colors ───────────────────────────────── */
  success: {
    50: "#F0FDF4",
    100: "#DCFCE7",
    200: "#BBF7D0",
    300: "#86EFAC",
    400: "#4ADE80",
    500: "#22C55E",
    600: "#16A34A",
    700: "#15803D",
    800: "#166534",
    900: "#14532D",
    950: "#052E16",
  },
  warning: {
    50: "#FFFBEB",
    100: "#FEF3C7",
    200: "#FDE68A",
    300: "#FCD34D",
    400: "#FBBF24",
    500: "#F59E0B",
    600: "#D97706",
    700: "#B45309",
    800: "#92400E",
    900: "#78350F",
    950: "#451A03",
  },
  danger: {
    50: "#FEF2F2",
    100: "#FEE2E2",
    200: "#FECACA",
    300: "#FCA5A5",
    400: "#F87171",
    500: "#EF4444",
    600: "#DC2626",
    700: "#B91C1C",
    800: "#991B1B",
    900: "#7F1D1D",
    950: "#450A0A",
  },
  info: {
    50: "#EFF6FF",
    100: "#DBEAFE",
    200: "#BFDBFE",
    300: "#93C5FD",
    400: "#60A5FA",
    500: "#3B82F6",
    600: "#2563EB",
    700: "#1D4ED8",
    800: "#1E40AF",
    900: "#1E3A8A",
    950: "#172554",
  },
} as const;

export const borderRadius = {
  sm: "0.5rem",    // 8px
  DEFAULT: "0.75rem", // 12px
  md: "0.875rem",  // 14px
  lg: "1rem",      // 16px
  xl: "1.25rem",   // 20px
  "2xl": "1.5rem", // 24px
  "3xl": "2rem",   // 32px
} as const;

export const fontFamily = {
  sans: [
    "Inter",
    "ui-sans-serif",
    "system-ui",
    "-apple-system",
    "BlinkMacSystemFont",
    "Segoe UI",
    "Roboto",
    "Helvetica Neue",
    "Arial",
    "Noto Sans",
    "sans-serif",
    "Apple Color Emoji",
    "Segoe UI Emoji",
    "Segoe UI Symbol",
    "Noto Color Emoji",
  ],
  heading: [
    "Inter",
    "ui-sans-serif",
    "system-ui",
    "sans-serif",
  ],
} as const;

export const boxShadow = {
  /** Subtle warm shadow for cards */
  warm: "0 1px 3px 0 rgba(60, 45, 30, 0.06), 0 1px 2px -1px rgba(60, 45, 30, 0.06)",
  /** Medium warm shadow for hover states */
  "warm-md": "0 4px 6px -1px rgba(60, 45, 30, 0.08), 0 2px 4px -2px rgba(60, 45, 30, 0.06)",
  /** Large warm shadow for elevated elements */
  "warm-lg": "0 10px 15px -3px rgba(60, 45, 30, 0.08), 0 4px 6px -4px rgba(60, 45, 30, 0.06)",
  /** Extra-large warm shadow for modals/popovers */
  "warm-xl": "0 20px 25px -5px rgba(60, 45, 30, 0.08), 0 8px 10px -6px rgba(60, 45, 30, 0.04)",
  /** Glow effect for focused inputs */
  "amber-glow": "0 0 0 3px rgba(245, 145, 21, 0.20)",
  /** Soft inner shadow for inset elements */
  "warm-inner": "inset 0 2px 4px 0 rgba(60, 45, 30, 0.04)",
} as const;

export const animation = {
  keyframes: {
    "fade-in": {
      from: { opacity: "0", transform: "translateY(4px)" },
      to: { opacity: "1", transform: "translateY(0)" },
    },
    "slide-in-right": {
      from: { opacity: "0", transform: "translateX(-8px)" },
      to: { opacity: "1", transform: "translateX(0)" },
    },
    "scale-in": {
      from: { opacity: "0", transform: "scale(0.95)" },
      to: { opacity: "1", transform: "scale(1)" },
    },
    shimmer: {
      "0%": { backgroundPosition: "-200% 0" },
      "100%": { backgroundPosition: "200% 0" },
    },
  },
  animation: {
    "fade-in": "fade-in 0.3s ease-out",
    "slide-in-right": "slide-in-right 0.3s ease-out",
    "scale-in": "scale-in 0.2s ease-out",
    shimmer: "shimmer 2s linear infinite",
  },
} as const;

/**
 * Complete SchoolBridge theme extension for Tailwind CSS.
 * Spread into your tailwind.config `theme.extend`.
 */
export const schoolBridgeTheme = {
  colors,
  borderRadius,
  fontFamily,
  boxShadow,
  ...animation,
} as const;

export default schoolBridgeTheme;

import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind CSS classes with proper conflict resolution.
 * Combines clsx for conditional classes with tailwind-merge
 * to handle Tailwind class conflicts intelligently.
 *
 * @example
 * cn("px-4 py-2", isActive && "bg-amber-500", className)
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function pctColor(pct: number): string {
  if (pct >= 80) return "#22c55e";
  if (pct >= 65) return "#f59e0b";
  return "#ef4444";
}

export function pctTextColor(pct: number): string {
  if (pct >= 80) return "#16a34a";
  if (pct >= 65) return "#d97706";
  return "#dc2626";
}

/** Same tiers as pctTextColor, in shades that reach 4.5:1 contrast on white (green-700 / amber-700 / red-700). */
export function pctReadableColor(pct: number): string {
  if (pct >= 80) return "#15803d";
  if (pct >= 65) return "#b45309";
  return "#b91c1c";
}

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

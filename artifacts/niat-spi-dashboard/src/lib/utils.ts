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

/**
 * Text colour for score-style percentages (quizzes, SPI). Shades pass 4.5:1 on white.
 * Attendance % uses tierTextColor in lib/attendanceTiers.ts instead.
 */
export function pctTextColor(pct: number): string {
  if (pct >= 80) return "#1E7F4F";
  if (pct >= 65) return "#B45309";
  return "#B91C1C";
}

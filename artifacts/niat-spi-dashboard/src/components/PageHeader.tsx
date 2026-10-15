import React from "react";
import { Info } from "lucide-react";

/** Shown on every page with attendance numbers; the server counts the same rows everywhere. */
export const ATTENDANCE_SCOPE_NOTE = "Attendance is calculated on NIAT course sessions only.";

export function PageHeader({
  title,
  subtitle,
  badge,
  right,
  attendanceNote,
}: {
  title: string;
  subtitle?: React.ReactNode;
  badge?: string;
  right?: React.ReactNode;
  /** Adds the "Attendance is calculated on NIAT course sessions only" line. */
  attendanceNote?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-slate-200 py-4">
      <div className="min-w-0 w-full">
        {badge && (
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            {badge}
          </p>
        )}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-[16rem] max-w-3xl flex-1">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-1 text-sm leading-relaxed text-slate-600">
                {subtitle}
              </p>
            )}
            {attendanceNote && (
              <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-slate-600">
                <Info className="h-3.5 w-3.5 shrink-0 text-brand-700" aria-hidden="true" />
                {ATTENDANCE_SCOPE_NOTE}
              </p>
            )}
          </div>
          {right && <div className="ml-auto shrink-0">{right}</div>}
        </div>
      </div>
    </div>
  );
}

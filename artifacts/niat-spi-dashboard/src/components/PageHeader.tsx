import React from "react";
import { AttendanceInfo } from "@/components/AttendanceInfo";
import { ATTENDANCE_LABEL } from "@/lib/attendanceLabel";

/** Shown on every page with attendance numbers; the server counts the same rows everywhere. */
export const ATTENDANCE_SCOPE_NOTE = ATTENDANCE_LABEL;

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
  /** Adds the shared attendance label (lib/attendanceLabel.ts) with its tooltip. */
  attendanceNote?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-brand-100 py-4">
      <div className="min-w-0 w-full">
        {badge && (
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            {badge}
          </p>
        )}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-[16rem] max-w-3xl flex-1">
            <h1 className="text-2xl font-bold tracking-tight text-brand-900">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-1 text-sm leading-relaxed text-slate-600">
                {subtitle}
              </p>
            )}
            {attendanceNote && (
              <p className="mt-2 inline-flex max-w-full items-start gap-1.5 rounded-2xl border border-brand-100 bg-brand-50 px-3 py-1 text-xs font-medium leading-snug text-brand-900">
                <span className="min-w-0">{ATTENDANCE_SCOPE_NOTE}</span>
                <AttendanceInfo className="mt-px text-brand-600 hover:text-brand-900" />
              </p>
            )}
          </div>
          {right && <div className="ml-auto shrink-0">{right}</div>}
        </div>
      </div>
    </div>
  );
}

import React from "react";
import { AttendanceInfo } from "@/components/AttendanceInfo";
import { ATTENDANCE_LABEL } from "@/lib/attendanceLabel";
import { CalendarRange } from "lucide-react";

/** SPI started this semester, so every data page shows this semester only (an ended batch: its last one). */
export const SEMESTER_SCOPE_NOTE = "Showing the current semester only: SPI tracking began this semester, so earlier semesters are not included.";

/** Shown on every page with attendance numbers; the server counts the same rows everywhere. */
export const ATTENDANCE_SCOPE_NOTE = ATTENDANCE_LABEL;

export function PageHeader({
  title,
  subtitle,
  badge,
  right,
  attendanceNote,
  semesterNote = true,
}: {
  title: string;
  subtitle?: React.ReactNode;
  badge?: string;
  right?: React.ReactNode;
  /** Adds the shared attendance label (lib/attendanceLabel.ts) with its tooltip. */
  attendanceNote?: boolean;
  /** The "this semester only" note; on by default, off for admin pages without student data. */
  semesterNote?: boolean;
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
            {(semesterNote || attendanceNote) && (
              <div className="mt-2 flex flex-wrap gap-2">
                {semesterNote && (
                  <p className="inline-flex max-w-full items-start gap-1.5 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium leading-snug text-amber-900">
                    <CalendarRange className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="min-w-0">{SEMESTER_SCOPE_NOTE}</span>
                  </p>
                )}
                {attendanceNote && (
                  <p className="inline-flex max-w-full items-start gap-1.5 rounded-2xl border border-brand-100 bg-brand-50 px-3 py-1 text-xs font-medium leading-snug text-brand-900">
                    <span className="min-w-0">{ATTENDANCE_SCOPE_NOTE}</span>
                    <AttendanceInfo className="mt-px text-brand-600 hover:text-brand-900" />
                  </p>
                )}
              </div>
            )}
          </div>
          {right && <div className="ml-auto shrink-0">{right}</div>}
        </div>
      </div>
    </div>
  );
}

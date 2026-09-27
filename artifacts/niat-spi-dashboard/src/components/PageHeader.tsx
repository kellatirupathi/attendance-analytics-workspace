import React from "react";

export function PageHeader({
  title,
  subtitle,
  badge,
  right,
}: {
  title: string;
  subtitle?: React.ReactNode;
  badge?: string;
  right?: React.ReactNode;
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
          </div>
          {right && <div className="ml-auto shrink-0">{right}</div>}
        </div>
      </div>
    </div>
  );
}

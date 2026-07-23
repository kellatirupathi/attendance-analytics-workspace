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
    <div className="flex flex-col gap-4 border-b border-slate-200 py-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        {badge && (
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            {badge}
          </p>
        )}
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-600">
            {subtitle}
          </p>
        )}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

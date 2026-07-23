import React from "react";
import { cn } from "@/lib/utils";

interface LogoMarkProps extends React.SVGProps<SVGSVGElement> {
  className?: string;
}

/**
 * NIAT SPI mark — NIAT "N" monogram framed by the SPI performance index ring.
 */
export function LogoMark({ className, ...props }: LogoMarkProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("h-8 w-8 shrink-0", className)}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      {...props}
    >
      <rect width="32" height="32" rx="8" fill="#1e293b" stroke="#334155" strokeWidth="1" />
      <rect x="0" y="8" width="2.5" height="16" rx="1.25" fill="#FF7A1A" />

      {/* SPI index ring — track */}
      <path
        d="M7 21a9 9 0 0 1 18 0"
        stroke="#ffffff"
        strokeOpacity="0.18"
        strokeWidth="2.25"
        strokeLinecap="round"
      />
      {/* SPI score arc */}
      <path
        d="M7 21a9 9 0 0 1 15.2-10.5"
        stroke="#FF7A1A"
        strokeWidth="2.25"
        strokeLinecap="round"
      />
      {/* 80% eligibility marker */}
      <circle cx="23" cy="12.2" r="1.15" fill="#FF7A1A" />

      {/* NIAT "N" */}
      <path
        d="M11.75 20.25V13.75L16.75 20.25V13.75"
        stroke="#F8FAFC"
        strokeWidth="2.15"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LogoText({
  className,
  inverted = false,
}: {
  className?: string;
  inverted?: boolean;
}) {
  return (
    <span
      className={cn(
        "text-[15px] font-bold leading-none tracking-tight",
        inverted ? "text-white" : "text-slate-900",
        className,
      )}
    >
      NIAT{" "}
      <span className={inverted ? "text-brand-400" : "text-brand-600"}>SPI</span>
    </span>
  );
}

export function Logo({
  className,
  inverted = false,
}: {
  className?: string;
  inverted?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <LogoMark />
      <div className="min-w-0">
        <LogoText inverted={inverted} />
        <p
          className={cn(
            "mt-0.5 text-[11px] font-medium tracking-wide",
            inverted ? "text-slate-400" : "text-slate-500",
          )}
        >
          Skill Performance Index
        </p>
      </div>
    </div>
  );
}

import React from "react";
import { cn } from "@/lib/utils";

interface LogoMarkProps extends React.SVGProps<SVGSVGElement> {
  className?: string;
}

export function LogoMark({ className, ...props }: LogoMarkProps) {
  return (
    <svg viewBox="0 0 48 48" className={cn("w-10 h-10", className)} fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <defs>
        <linearGradient id="logo-grad" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FF8A1E" />
          <stop offset="1" stopColor="#F25C05" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="13" fill="url(#logo-grad)" />
      <path d="M11 31a13 13 0 0 1 26 0" stroke="#fff" strokeOpacity="0.45" strokeWidth="2" fill="none" />
      <rect x="14" y="27" width="5" height="7" rx="1.5" fill="#fff" />
      <rect x="21.5" y="22" width="5" height="12" rx="1.5" fill="#fff" />
      <rect x="29" y="16" width="5" height="18" rx="2.5" fill="#fff" />
      <path d="M31.5 16.5l5-5m0 0h-4.2m4.2 0v4.2" stroke="#fff" strokeWidth="1.5" fill="none" />
    </svg>
  );
}

export function LogoText({ className }: { className?: string }) {
  return (
    <span className={cn("font-bold text-xl tracking-tight text-foreground", className)}>
      NIAT<span className="text-[#F25C05]">SPI</span>
    </span>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <LogoMark />
      <LogoText />
    </div>
  );
}

import { useState } from "react";
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ATTENDANCE_LABEL, ATTENDANCE_TOOLTIP } from "@/lib/attendanceLabel";

/**
 * Info icon with the shared attendance tooltip. Opens on hover (mouse) and on tap or Enter, so it also works on
 * a phone and from the keyboard.
 */
export function AttendanceInfo({ className, iconClassName }: { className?: string; iconClassName?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="What attendance counts"
          onPointerEnter={(e) => e.pointerType === "mouse" && setOpen(true)}
          onPointerLeave={(e) => e.pointerType === "mouse" && setOpen(false)}
          onClick={(e) => {
            // Open on tap or Enter; a click after the hover-open must not close it again.
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
          }}
          className={cn(
            "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full align-middle text-slate-400 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600",
            className,
          )}
        >
          <Info className={cn("h-3.5 w-3.5", iconClassName)} aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        className="w-72 max-w-[calc(100vw-2rem)] p-3 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-slate-700"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {ATTENDANCE_TOOLTIP}
      </PopoverContent>
    </Popover>
  );
}

/** Small caption that goes under an attendance card or table. */
export function AttendanceCaption({ className }: { className?: string }) {
  return (
    <p className={cn("mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-slate-500", className)}>
      <span className="min-w-0">{ATTENDANCE_LABEL}</span>
      <AttendanceInfo />
    </p>
  );
}

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Squared table shell — a bordered container with no rounded corners */
/*  matching the reference "Training Stats" table.                     */
/* ------------------------------------------------------------------ */
export function TableShell({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05),0_1px_3px_rgba(0,0,0,0.08)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Bottom pagination bar:                                            */
/*    [rows-per-page ▾]   N total          Page X of Y   ← Prev  Next →*/
/* ------------------------------------------------------------------ */
export function TablePagination({
  page,
  totalPages,
  totalItems,
  pageSize,
  pageSizeOptions = [25, 50, 100, 200],
  onPageChange,
  onPageSizeChange,
  itemLabel = "total",
}: {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  pageSizeOptions?: number[];
  onPageChange: (p: number) => void;
  onPageSizeChange: (s: number) => void;
  itemLabel?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 bg-white px-4 py-3">
      <div className="flex items-center gap-3 text-sm text-gray-500">
        <Select
          value={String(pageSize)}
          onValueChange={(v) => onPageSizeChange(Number(v))}
        >
          <SelectTrigger className="h-8 w-[76px] border-gray-200">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {pageSizeOptions.map((s) => (
              <SelectItem key={s} value={String(s)}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="tabular-nums">
          {totalItems.toLocaleString()} {itemLabel}
        </span>
      </div>

      <div className="flex items-center gap-3 text-sm text-gray-600">
        <span className="tabular-nums">
          Page {page} of {totalPages}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1 border-gray-200 px-3"
            disabled={page <= 1}
            onClick={() => onPageChange(Math.max(1, page - 1))}
          >
            ← Prev
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1 border-gray-200 px-3"
            disabled={page >= totalPages}
            onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          >
            Next →
          </Button>
        </div>
      </div>
    </div>
  );
}

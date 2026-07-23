import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type BreadcrumbItem = {
  label: string;
  onClick?: () => void;
  /** Current page — not clickable */
  current?: boolean;
};

export function PageBreadcrumb({ items }: { items: BreadcrumbItem[] }) {
  if (items.length === 0) return null;

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2 text-sm text-gray-600"
    >
      {items.map((item, i) => (
        <span key={`${item.label}-${i}`} className="inline-flex min-w-0 items-center gap-2">
          {i > 0 && (
            <ChevronRight
              className="h-4 w-4 shrink-0 text-gray-300"
              aria-hidden
            />
          )}
          {item.current || !item.onClick ? (
            <span
              className={cn(
                "max-w-[min(100%,280px)] truncate",
                item.current
                  ? "font-medium text-gray-900"
                  : "text-gray-700",
              )}
              title={item.label}
            >
              {item.label}
            </span>
          ) : (
            <button
              type="button"
              onClick={item.onClick}
              className="max-w-[min(100%,280px)] truncate font-medium text-brand-600 hover:underline"
              title={item.label}
            >
              {item.label}
            </button>
          )}
        </span>
      ))}
    </nav>
  );
}

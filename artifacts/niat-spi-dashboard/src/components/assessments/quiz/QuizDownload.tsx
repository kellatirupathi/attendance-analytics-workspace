import { useState } from "react";
import { ChevronDown, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fmtInt } from "@/lib/assessmentMetrics";
import { quizApi, type DownloadView, type QuizFilters, type QuizKpis, type QuizType } from "@/lib/quizCoverage";

const OPTIONS: { view: DownloadView; label: string; count: (c: QuizKpis["counts"]) => number }[] = [
  { view: "campus", label: "Campus summary", count: (c) => c.campus },
  { view: "student", label: "Student summary", count: (c) => c.student },
  { view: "student-subject", label: "Student × subject", count: (c) => c.studentSubject },
];

/** One Download button: pick a file, pick Excel or CSV. The server writes every row for the filters above. */
export function QuizDownload({ quizType, filters, counts }: { quizType: QuizType; filters: QuizFilters; counts: QuizKpis["counts"] | undefined }) {
  const [view, setView] = useState<DownloadView>("campus");
  const [format, setFormat] = useState<"xlsx" | "csv">("xlsx");
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600">
          <Download className="h-4 w-4" aria-hidden="true" /> Download <ChevronDown className="h-4 w-4 text-slate-400" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        <fieldset>
          <legend className="sr-only">What to download</legend>
          <div className="space-y-1.5">
            {OPTIONS.map((o) => (
              <label key={o.view} className={cn("flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 text-sm", view === o.view ? "border-brand-600 bg-brand-50" : "border-transparent hover:bg-slate-50")}>
                <input type="radio" name="quiz-download-view" checked={view === o.view} onChange={() => setView(o.view)} className="mt-1" />
                <span>
                  <span className="block font-medium text-slate-900">{o.label}</span>
                  <span className="block text-xs text-slate-500">{counts ? `${fmtInt(o.count(counts))} rows` : "…"}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div role="group" aria-label="File format" className="mt-3 grid grid-cols-2 gap-1.5">
          {([["xlsx", "Excel (.xlsx)"], ["csv", "CSV"]] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={format === value}
              onClick={() => setFormat(value)}
              className={cn("h-9 rounded-lg border text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600", format === value ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-700 hover:bg-slate-50")}
            >
              {label}
            </button>
          ))}
        </div>
        <a
          href={quizApi.downloadUrl(quizType, filters, view, format)}
          onClick={() => window.setTimeout(() => setOpen(false), 200)}
          className="mt-3 inline-flex h-10 w-full items-center justify-center rounded-lg bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
        >
          Download
        </a>
        <p className="mt-2 text-center text-xs text-slate-500">Uses the filters above</p>
      </PopoverContent>
    </Popover>
  );
}

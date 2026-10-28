import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtInt } from "@/lib/assessmentMetrics";
import { NO_FILTERS, quizApi, type QuizType } from "@/lib/quizCoverage";
import { Pill } from "./quizParts";

const pctText = (v: number | null) => (v == null ? "–" : `${v.toFixed(1)}%`);

/** Right-hand panel for one student: totals, then one row per subject. */
export function QuizStudentPanel({ uid, quizType, onClose }: { uid: string | null; quizType: QuizType; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["quiz-student", quizType, uid],
    queryFn: () => quizApi.student(quizType, uid!),
    enabled: Boolean(uid),
    staleTime: 5 * 60_000,
  });
  const d = q.data;
  return (
    <Sheet open={Boolean(uid)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-slate-200 p-5 text-left">
          <SheetTitle className="text-lg">{d ? d.name || "Unknown student" : q.isLoading ? "Loading…" : "Student"}</SheetTitle>
          <SheetDescription className="text-xs">
            {d ? `${d.uid.slice(0, 8)} · ${d.section} · ${d.college}` : " "}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-5">
          {q.isLoading && <Skeleton className="h-40 w-full" />}
          {q.isError && (
            <p role="alert" className="text-sm text-red-700">
              We couldn't load this student.{" "}
              <button type="button" className="font-semibold underline" onClick={() => void q.refetch()}>Retry</button>
            </p>
          )}
          {d && (
            <>
              <dl className="grid grid-cols-3 gap-2">
                {[
                  ["Completed", `${fmtInt(d.completed)} / ${fmtInt(d.scheduled)}`],
                  ["Completion rate", pctText(d.completionPct)],
                  ["Avg score", pctText(d.avgScore)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg bg-slate-50 p-3">
                    <dt className="text-[11px] font-medium text-slate-500">{label}</dt>
                    <dd className="mt-1 text-lg font-bold tabular-nums text-slate-900">{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-[11px] font-semibold text-slate-600">
                    <tr>
                      <th scope="col" className="px-3 py-2">Subject</th>
                      <th scope="col" className="px-3 py-2 text-right">Completed</th>
                      <th scope="col" className="px-3 py-2 text-right">Completion %</th>
                      <th scope="col" className="px-3 py-2 text-right">Avg score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {d.subjects.map((s) => (
                      <tr key={s.subject}>
                        <td className="px-3 py-2.5 font-medium text-slate-900">{s.subject}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-slate-600">{fmtInt(s.completed)} / {fmtInt(s.scheduled)}</td>
                        <td className="px-3 py-2.5 text-right"><Pill metric="completion" value={s.completionPct} /></td>
                        <td className="px-3 py-2.5 text-right"><Pill metric="avg" value={s.avgScore} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="border-t border-slate-200 p-4">
          {d && (
            <a
              href={quizApi.downloadUrl(quizType, NO_FILTERS, "student-subject", "xlsx", d.uid)}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 sm:w-auto sm:px-4"
            >
              <Download className="h-4 w-4" aria-hidden="true" /> Download student report
            </a>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

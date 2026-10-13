import { useState } from "react";
import { Loader2, Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/SearchableSelect";
import { CheckMenu, Field } from "@/components/SpiRecordFilterBar";
import { cn } from "@/lib/utils";
import type { SummaryGroupBy, SummarySemester } from "@/lib/assessmentSummary";
import { FOCUS_RING } from "./parts";

export const GROUP_OPTIONS: { id: SummaryGroupBy; label: string }[] = [
  { id: "campus", label: "Campus-wise" },
  { id: "subject", label: "Subject-wise" },
  { id: "section", label: "Section-wise" },
  { id: "semester", label: "Semester-wise" },
  { id: "student", label: "Student-wise" },
];

export const SEMESTER_OPTIONS: { value: SummarySemester; label: string }[] = [
  { value: "current", label: "Current semesters" },
  { value: "1", label: "Semester 1" },
  { value: "3", label: "Semester 3" },
  { value: "all", label: "All semesters" },
];

export interface FilterState {
  groupBy: SummaryGroupBy;
  campuses: string[];
  semester: SummarySemester;
  sections: string[];
  student: string;
  subjects: string[];
}

export function AssessmentFilters({
  state,
  options,
  showCampus,
  updating,
  onChange,
  onReset,
}: {
  state: FilterState;
  options: { campuses: string[]; sections: { campus: string; section: string }[]; subjects: string[] };
  showCampus: boolean;
  updating: boolean;
  onChange: (patch: Partial<FilterState>) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const multiCampus = state.campuses.length !== 1;

  const chips: { key: string; group: string; label: string; onRemove: () => void }[] = [
    ...(showCampus
      ? state.campuses.map((c) => ({ key: `c:${c}`, group: "Campus", label: c, onRemove: () => onChange({ campuses: state.campuses.filter((x) => x !== c), sections: [] }) }))
      : []),
    ...(state.semester !== "current"
      ? [{ key: "sem", group: "Semester", label: SEMESTER_OPTIONS.find((o) => o.value === state.semester)!.label, onRemove: () => onChange({ semester: "current" }) }]
      : []),
    ...state.sections.map((id) => {
      const [campus = "", section = id] = id.split("\t");
      return { key: `s:${id}`, group: "Section", label: multiCampus ? `${campus} — ${section}` : section, onRemove: () => onChange({ sections: state.sections.filter((x) => x !== id) }) };
    }),
    ...(state.student.trim() ? [{ key: "q", group: "Student", label: state.student.trim(), onRemove: () => onChange({ student: "" }) }] : []),
    ...state.subjects.map((s) => ({ key: `j:${s}`, group: "Subject", label: s, onRemove: () => onChange({ subjects: state.subjects.filter((x) => x !== s) }) })),
  ];

  return (
    <div className="space-y-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="radiogroup" aria-label="Group by" className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1">
          <span className="sr-only">Group by</span>
          {GROUP_OPTIONS.map((g) => {
            const selected = g.id === state.groupBy;
            return (
              <button
                key={g.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChange({ groupBy: g.id })}
                className={cn(
                  "shrink-0 rounded-md border px-3 py-1.5 text-sm transition-colors",
                  FOCUS_RING,
                  selected ? "border-slate-900 bg-slate-900 font-medium text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                )}
              >
                {g.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-3">
          <span role="status" aria-live="polite" className="flex items-center gap-1.5 text-xs text-slate-600">
            {updating && (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Updating…
              </>
            )}
          </span>
          <Button type="button" variant="outline" size="sm" className="md:hidden" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <SlidersHorizontal className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Filters{chips.length ? ` (${chips.length})` : ""}
          </Button>
        </div>
      </div>

      <div className={cn("flex-wrap items-end gap-3", open ? "flex" : "hidden md:flex")}>
        {showCampus && (
          <Field label="Campus">
            <CheckMenu
              label={state.campuses.length ? `${state.campuses.length} selected` : "All campuses"}
              options={options.campuses.map((c) => ({ id: c, label: c }))}
              selected={state.campuses}
              onChange={(next) => onChange({ campuses: next, sections: [] })}
            />
          </Field>
        )}
        <Field label="Semester">
          <SearchableSelect
            value={state.semester}
            onValueChange={(v) => onChange({ semester: v as SummarySemester, sections: [] })}
            options={SEMESTER_OPTIONS}
            className="w-[180px]"
          />
        </Field>
        <Field label="Section">
          {state.campuses.length ? (
            <CheckMenu
              label={state.sections.length ? `${state.sections.length} selected` : "All sections"}
              options={options.sections.map((s) => ({ id: `${s.campus}\t${s.section}`, label: multiCampus ? `${s.campus} — ${s.section}` : s.section }))}
              selected={state.sections}
              onChange={(next) => onChange({ sections: next })}
            />
          ) : (
            <Button type="button" variant="outline" className="w-[180px] justify-start text-slate-500" disabled aria-describedby="section-hint">
              Pick a campus first
            </Button>
          )}
          <span id="section-hint" className="sr-only">Choose a campus to filter by section.</span>
        </Field>
        <Field label="Student">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" aria-hidden="true" />
            <Input
              type="search"
              aria-label="Search students by name or ID"
              placeholder="Name or ID"
              className="h-9 w-[180px] pl-8 normal-case tracking-normal"
              value={state.student}
              onChange={(event) => onChange({ student: event.target.value })}
            />
          </div>
        </Field>
        <Field label="Subject">
          <CheckMenu
            label={state.subjects.length ? `${state.subjects.length} selected` : "All subjects"}
            options={options.subjects.map((s) => ({ id: s, label: s }))}
            selected={state.subjects}
            onChange={(next) => onChange({ subjects: next })}
          />
        </Field>
        <Button type="button" variant="outline" size="sm" className="h-9" onClick={onReset}>
          Reset filters
        </Button>
      </div>

      {chips.length > 0 && (
        <ul className={cn("flex-wrap items-center gap-1.5", open ? "flex" : "hidden md:flex")} aria-label="Active filters">
          {chips.map((chip) => (
            <li key={chip.key}>
              <button
                type="button"
                onClick={chip.onRemove}
                aria-label={`Remove filter ${chip.group}: ${chip.label}`}
                className={cn("inline-flex items-center gap-1 border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100", FOCUS_RING)}
              >
                <span className="text-slate-600">{chip.group}:</span>
                <span className="font-medium">{chip.label}</span>
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

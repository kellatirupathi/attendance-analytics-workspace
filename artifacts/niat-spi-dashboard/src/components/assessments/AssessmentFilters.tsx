import { Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/SearchableSelect";
import { CheckMenu, Field } from "@/components/SpiRecordFilterBar";
import { cn } from "@/lib/utils";
import type { SummaryGroupBy, SummarySemester } from "@/lib/assessmentSummary";
import { FOCUS_RING } from "./parts";

export const GROUP_OPTIONS: { value: SummaryGroupBy; label: string }[] = [
  { value: "campus", label: "Campus-wise" },
  { value: "subject", label: "Subject-wise" },
  { value: "section", label: "Section-wise" },
  { value: "semester", label: "Semester-wise" },
  { value: "student", label: "Student-wise" },
];

export const CURRENT_SEMESTERS = "current";

export interface FilterState {
  groupBy: SummaryGroupBy;
  campuses: string[];
  semester: SummarySemester;
  sections: string[];
  student: string;
  subjects: string[];
}

/** Filter bar in the same layout as the Overview and Student Directory filter bars. */
export function AssessmentFilters({
  state,
  options,
  showCampus,
  updating,
  onChange,
  onReset,
}: {
  state: FilterState;
  options: { campuses: string[]; semesters: string[]; sections: { campus: string; section: string }[]; subjects: string[] };
  showCampus: boolean;
  updating: boolean;
  onChange: (patch: Partial<FilterState>) => void;
  onReset: () => void;
}) {
  const multiCampus = state.campuses.length !== 1;
  const semesterOptions = [
    { value: CURRENT_SEMESTERS, label: "Current semesters" },
    ...options.semesters.map((s) => ({ value: s, label: s })),
  ];

  const chips: { key: string; group: string; label: string; onRemove: () => void }[] = [
    ...(showCampus
      ? state.campuses.map((c) => ({ key: `c:${c}`, group: "Campus", label: c, onRemove: () => onChange({ campuses: state.campuses.filter((x) => x !== c), sections: [] }) }))
      : []),
    ...(state.semester !== CURRENT_SEMESTERS
      ? [{ key: "sem", group: "Semester", label: state.semester, onRemove: () => onChange({ semester: CURRENT_SEMESTERS, sections: [] }) }]
      : []),
    ...state.sections.map((id) => {
      const [campus = "", section = id] = id.split("\t");
      return { key: `s:${id}`, group: "Section", label: multiCampus ? `${campus} — ${section}` : section, onRemove: () => onChange({ sections: state.sections.filter((x) => x !== id) }) };
    }),
    ...(state.student.trim() ? [{ key: "q", group: "Student", label: state.student.trim(), onRemove: () => onChange({ student: "" }) }] : []),
    ...state.subjects.map((s) => ({ key: `j:${s}`, group: "Subject", label: s, onRemove: () => onChange({ subjects: state.subjects.filter((x) => x !== s) }) })),
  ];

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-[14px] border border-[#E6ECF5] bg-white px-5 py-4 shadow-[0_1px_2px_rgba(11,31,77,0.04)]">
      <Field label="Group by">
        <SearchableSelect
          value={state.groupBy}
          onValueChange={(v) => onChange({ groupBy: v as SummaryGroupBy })}
          options={GROUP_OPTIONS}
          className="w-[160px]"
        />
      </Field>
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
          onValueChange={(v) => onChange({ semester: v, sections: [] })}
          options={semesterOptions}
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
          <Button type="button" variant="outline" className="w-[180px] justify-start font-normal normal-case tracking-normal text-slate-500" disabled title="Pick a campus first">
            Pick a campus first
          </Button>
        )}
      </Field>
      <Field label="Student">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" aria-hidden="true" />
          <Input
            type="search"
            aria-label="Search students by name or ID"
            placeholder="Name or ID"
            className="h-9 w-[180px] pl-8 font-normal normal-case tracking-normal"
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
      <Button type="button" variant="outline" size="sm" onClick={onReset}>
        Reset filters
      </Button>
      <span role="status" aria-live="polite" className="flex h-9 items-center gap-1.5 text-xs text-slate-600">
        {updating && (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Updating…
          </>
        )}
      </span>
      {chips.length > 0 && (
        <ul className="flex w-full flex-wrap items-center gap-1.5" aria-label="Active filters">
          {chips.map((chip) => (
            <li key={chip.key}>
              <button
                type="button"
                onClick={chip.onRemove}
                aria-label={`Remove filter ${chip.group}: ${chip.label}`}
                className={cn("inline-flex items-center gap-1 border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100", FOCUS_RING)}
              >
                <span className="text-slate-500">{chip.group}:</span>
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

import { useMemo, useState, type ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/SearchableSelect";
import { ColumnOrderList, moveListItem } from "@/components/ColumnOrderList";

export type FilterId = "group" | "campus" | "semester" | "section" | "student" | "spi" | "attendance";
export type Grain = "all" | "campus" | "semester" | "section" | "student";
export type BoundOp = "" | "gte" | "lte" | "between";
export type AttendanceRange = "semester_to_date" | "last_30" | "custom" | "all_dates";

export const FILTER_LABEL: Record<FilterId, string> = {
  group: "Group by",
  campus: "Campus",
  semester: "Semester",
  section: "Section",
  student: "Student",
  spi: "SPI points",
  attendance: "Attendance period",
};

export const DEFAULT_FILTERS: FilterId[] = ["group", "campus", "semester", "section", "student", "spi", "attendance"];
const LINE_1: FilterId[] = ["group", "campus", "semester", "section", "student"];
const ALL_FILTERS: FilterId[] = ["group", "campus", "semester", "section", "student", "spi", "attendance"];

export interface SectionChoice {
  campus: string;
  section: string;
}

export interface StudentChoice {
  studentId: string;
  studentName: string;
  campus: string;
  section: string;
}

export function SpiRecordFilterBar({
  shown,
  grain,
  onGrain,
  campuses,
  campusOptions,
  onCampuses,
  semesters,
  semesterOptions,
  onSemesters,
  sections,
  onSections,
  students,
  onStudents,
  spiOp,
  spiA,
  spiB,
  onSpi,
  attendanceOp,
  attendanceA,
  attendanceB,
  attendanceRange,
  attendanceFrom,
  attendanceTo,
  onAttendance,
  onClear,
  sectionChoices,
  studentCatalog,
}: {
  shown: FilterId[];
  grain: Grain;
  onGrain: (grain: Grain) => void;
  campuses: string[];
  campusOptions: string[];
  onCampuses: (next: string[]) => void;
  semesters: string[];
  semesterOptions: string[];
  onSemesters: (next: string[]) => void;
  sections: SectionChoice[];
  onSections: (next: SectionChoice[]) => void;
  students: StudentChoice[];
  onStudents: (next: StudentChoice[]) => void;
  spiOp: BoundOp;
  spiA: string;
  spiB: string;
  onSpi: (op: BoundOp, a: string, b: string) => void;
  attendanceOp: BoundOp;
  attendanceA: string;
  attendanceB: string;
  attendanceRange: AttendanceRange;
  attendanceFrom: string;
  attendanceTo: string;
  onAttendance: (patch: {
    op?: BoundOp;
    a?: string;
    b?: string;
    range?: AttendanceRange;
    from?: string;
    to?: string;
  }) => void;
  onClear: () => void;
  sectionChoices: SectionChoice[];
  studentCatalog: StudentChoice[];
}) {
  const [studentQuery, setStudentQuery] = useState("");
  const studentHits = useMemo(() => {
    const q = studentQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    return studentCatalog
      .filter((item) => item.studentName.toLowerCase().includes(q) || item.studentId.toLowerCase().includes(q))
      .slice(0, 20);
  }, [studentCatalog, studentQuery]);

  const multiCampus = campuses.length !== 1;

  const controls: Record<FilterId, ReactNode> = {
    group: (
      <SearchableSelect
        value={grain}
        onValueChange={(value) => onGrain(value as Grain)}
        options={[
          { value: "all", label: "All-campus cumulative" },
          { value: "campus", label: "Campus-wise" },
          { value: "semester", label: "Semester-wise" },
          { value: "section", label: "Section-wise" },
          { value: "student", label: "Student-wise" },
        ]}
        className="w-[180px]"
      />
    ),
    campus: (
      <CheckMenu
        label={campuses.length ? `${campuses.length} selected` : "All campuses"}
        options={campusOptions.map((name) => ({ id: name, label: name }))}
        selected={campuses}
        onChange={onCampuses}
      />
    ),
    semester: (
      <CheckMenu
        label={semesters.length ? `${semesters.length} selected` : "Current semesters"}
        options={semesterOptions.map((name) => ({ id: name, label: name }))}
        selected={semesters}
        onChange={onSemesters}
      />
    ),
    section: (
      <CheckMenu
        label={
          sections.length
            ? `${sections.length} selected`
            : campuses.length
              ? "All sections"
              : "Select a campus"
        }
        options={sectionChoices.map((item) => ({
          id: `${item.campus}\t${item.section}`,
          label: multiCampus ? `${item.campus} — ${item.section}` : item.section,
        }))}
        selected={sections.map((item) => `${item.campus}\t${item.section}`)}
        onChange={(ids) =>
          onSections(ids.map((id) => {
            const [campus, section] = id.split("\t");
            return { campus: campus ?? "", section: section ?? "" };
          }))
        }
      />
    ),
    student: (
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-[180px] justify-between">
            {students.length ? `${students.length} selected` : "All students"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72" align="start">
          <Input
            value={studentQuery}
            placeholder="Search name or ID"
            onChange={(event) => setStudentQuery(event.target.value)}
          />
          <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">
            {studentHits.map((hit) => {
              const on = students.some((item) => item.studentId === hit.studentId && item.campus === hit.campus);
              return (
                <label key={`${hit.campus}-${hit.studentId}`} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      onStudents(
                        on
                          ? students.filter((item) => !(item.studentId === hit.studentId && item.campus === hit.campus))
                          : [...students, hit],
                      )
                    }
                  />
                  <span>
                    {hit.studentName}
                    <span className="block text-xs text-gray-500">{hit.campus} — {hit.section}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    ),
    spi: (
      <BoundControl scale="0–10" op={spiOp} a={spiA} b={spiB} onChange={onSpi} />
    ),
    attendance: null,
  };

  const visible = (ids: FilterId[]) => ids.filter((id) => shown.includes(id));

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-nowrap items-end gap-3 overflow-x-auto pb-1">
        {visible(LINE_1).map((id) => (
          <Field key={id} label={FILTER_LABEL[id]}>
            {controls[id]}
          </Field>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        {shown.includes("attendance") && (
          <>
            <Field label="Attendance period">
              <div className="flex flex-wrap items-center gap-2">
                <SearchableSelect
                  value={attendanceRange}
                  onValueChange={(value) => onAttendance({ range: value as AttendanceRange })}
                  options={[
                    { value: "semester_to_date", label: "This semester's dates so far" },
                    { value: "last_30", label: "Last 30 days" },
                    { value: "all_dates", label: "All dates" },
                    { value: "custom", label: "Custom range" },
                  ]}
                  className="w-[220px]"
                />
                {attendanceRange === "custom" && (
                  <>
                    <Input type="date" aria-label="Attendance period from" className="h-9 w-[150px]" value={attendanceFrom} onChange={(event) => onAttendance({ from: event.target.value })} />
                    <Input type="date" aria-label="Attendance period to" className="h-9 w-[150px]" value={attendanceTo} onChange={(event) => onAttendance({ to: event.target.value })} />
                  </>
                )}
              </div>
            </Field>
            <Field label="Attendance %">
              <BoundControl scale="0–100" op={attendanceOp} a={attendanceA} b={attendanceB} onChange={(op, a, b) => onAttendance({ op, a, b })} />
            </Field>
          </>
        )}
        {shown.includes("spi") && (
          <Field label={FILTER_LABEL.spi}>{controls.spi}</Field>
        )}
        <div className="flex items-end">
          <Button type="button" variant="outline" size="sm" onClick={onClear}>
            Clear
          </Button>
        </div>
      </div>
    </div>
  );
}

export function SpiRecordFiltersButton({
  shown,
  onShown,
}: {
  shown: FilterId[];
  onShown: (next: FilterId[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<FilterId[]>(shown);
  const order = [...draft, ...ALL_FILTERS.filter((id) => !draft.includes(id))];
  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (next) setDraft(shown); }}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">Filters</Button>
      </PopoverTrigger>
      <PopoverContent className="w-72" align="end">
        <p className="mb-2 text-xs text-gray-500">Group by and Student stay on.</p>
        <ColumnOrderList
          ids={order}
          label={(id) => FILTER_LABEL[id]}
          checked={(id) => draft.includes(id)}
          locked={(id) => id === "group" || id === "student"}
          onToggle={(id) => {
            if (id === "group" || id === "student") return;
            setDraft((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
          }}
          onReorder={(from, to) => {
            const next = moveListItem(order, from, to);
            setDraft(next.filter((id) => draft.includes(id)));
          }}
        />
        <Button
          size="sm"
          className="mt-2 w-full"
          onClick={() => {
            const next: FilterId[] = draft.includes("group") ? [...draft] : ["group", ...draft];
            if (!next.includes("student")) next.push("student");
            onShown(next);
            setOpen(false);
          }}
        >
          Apply
        </Button>
      </PopoverContent>
    </Popover>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex shrink-0 flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
      {label}
      {children}
    </label>
  );
}

export function CheckMenu({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { id: string; label: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const allSelected = options.length > 0 && options.every((option) => selectedSet.has(option.id));
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-[180px] justify-between">{label}</Button>
      </PopoverTrigger>
      <PopoverContent className="w-72" align="start">
        {options.length > 0 && (
          <label className="mb-1 flex items-center gap-2 border-b border-gray-200 pb-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => onChange(allSelected ? [] : options.map((option) => option.id))}
            />
            Select all
          </label>
        )}
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {options.map((option) => (
            <label key={option.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selectedSet.has(option.id)}
                onChange={() =>
                  onChange(
                    selectedSet.has(option.id)
                      ? selected.filter((id) => id !== option.id)
                      : [...selected, option.id],
                  )
                }
              />
              {option.label}
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function BoundControl({
  scale,
  op,
  a,
  b,
  onChange,
}: {
  scale: string;
  op: BoundOp;
  a: string;
  b: string;
  onChange: (op: BoundOp, a: string, b: string) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <SearchableSelect
        value={op || "any"}
        onValueChange={(value) => onChange(value === "any" ? "" : value as BoundOp, a, b)}
        options={[
          { value: "any", label: "Any" },
          { value: "gte", label: "≥" },
          { value: "lte", label: "≤" },
          { value: "between", label: "Between" },
        ]}
        className="w-[110px]"
      />
      {op && (
        <Input className="h-9 w-[72px]" inputMode="decimal" placeholder={scale} value={a} onChange={(event) => onChange(op, event.target.value, b)} />
      )}
      {op === "between" && (
        <Input className="h-9 w-[72px]" inputMode="decimal" placeholder={scale} value={b} onChange={(event) => onChange(op, a, event.target.value)} />
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  matchPreset,
  rangeForPreset,
  type DatePreset,
  type DateRange,
} from "@/lib/dateRange";

export function DateRangeFilter({
  value,
  onChange,
  allDatesLabel = "Current semester",
}: {
  value: DateRange;
  onChange: (next: DateRange) => void;
  allDatesLabel?: string;
}) {
  const preset = matchPreset(value);
  const [showCustom, setShowCustom] = useState(preset === "custom");

  useEffect(() => {
    if (preset === "custom") setShowCustom(true);
  }, [preset]);

  const selectValue: DatePreset = showCustom ? "custom" : preset;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={selectValue}
        onValueChange={(next) => {
          if (next === "all") {
            setShowCustom(false);
            onChange({});
            return;
          }
          if (next === "custom") {
            setShowCustom(true);
            onChange({});
            return;
          }
          setShowCustom(false);
          onChange(rangeForPreset(next as "7d" | "30d" | "month"));
        }}
      >
        <SelectTrigger className="h-9 w-[190px] border-gray-200 bg-white">
          <span className="flex items-center gap-2 truncate">
            <CalendarDays className="h-4 w-4 shrink-0 text-gray-500" />
            <SelectValue />
          </span>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{allDatesLabel}</SelectItem>
          <SelectItem value="7d">Last 7 days</SelectItem>
          <SelectItem value="30d">Last 30 days</SelectItem>
          <SelectItem value="month">This month</SelectItem>
          <SelectItem value="custom">Custom range</SelectItem>
        </SelectContent>
      </Select>
      {showCustom && (
        <>
          <Input
            type="date"
            aria-label="From date"
            value={value.dateFrom ?? ""}
            onChange={(e) =>
              onChange({
                dateFrom: e.target.value || undefined,
                dateTo: value.dateTo,
              })
            }
            className="h-9 w-[150px] border-gray-200 bg-white"
          />
          <span className="text-sm text-gray-400">–</span>
          <Input
            type="date"
            aria-label="To date"
            value={value.dateTo ?? ""}
            onChange={(e) =>
              onChange({
                dateFrom: value.dateFrom,
                dateTo: e.target.value || undefined,
              })
            }
            className="h-9 w-[150px] border-gray-200 bg-white"
          />
        </>
      )}
    </div>
  );
}

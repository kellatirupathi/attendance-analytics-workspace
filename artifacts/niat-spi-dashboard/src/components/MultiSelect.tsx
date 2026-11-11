import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

interface MultiSelectProps {
  options: string[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  emptyText?: string;
  /** Shows "N selected" (or the one chosen name) instead of a badge per choice; for long lists. */
  compact?: boolean;
  /** Label for the options, e.g. "colleges" in "3 colleges". Compact mode only. */
  noun?: string;
  disabled?: boolean;
  /** Text for each option when it differs from its value. */
  labelFor?: (option: string) => string;
}

export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = "Select…",
  emptyText = "No options.",
  compact = false,
  noun = "selected",
  disabled = false,
  labelFor = (o) => o,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);

  const toggle = (item: string) => {
    onChange(
      value.includes(item)
        ? value.filter((v) => v !== item)
        : [...value, item],
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("h-auto min-h-9 w-full justify-between border-gray-200 py-1.5", compact && "h-10")}
        >
          <div className={cn("flex gap-1", compact ? "min-w-0" : "flex-wrap")}>
            {value.length === 0 ? (
              <span className="font-normal text-gray-400">{placeholder}</span>
            ) : compact ? (
              <span className="truncate font-normal">
                {value.length === 1 ? labelFor(value[0]!) : `${value.length} ${noun}`}
              </span>
            ) : (
              value.map((v) => (
                <Badge key={v} variant="secondary" className="font-normal">
                  {labelFor(v)}
                </Badge>
              ))
            )}
          </div>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder="Search…" />
          <CommandList className="scrollbar-thin">
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => (
                <CommandItem
                  key={opt}
                  value={labelFor(opt)}
                  onSelect={() => toggle(opt)}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value.includes(opt) ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {labelFor(opt)}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

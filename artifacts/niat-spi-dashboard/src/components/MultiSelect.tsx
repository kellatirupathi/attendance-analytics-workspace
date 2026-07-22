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
}

export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = "Select…",
  emptyText = "No options.",
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
          className="h-auto min-h-9 w-full justify-between border-gray-200 py-1.5"
        >
          <div className="flex flex-wrap gap-1">
            {value.length === 0 ? (
              <span className="font-normal text-gray-400">{placeholder}</span>
            ) : (
              value.map((v) => (
                <Badge key={v} variant="secondary" className="font-normal">
                  {v}
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
                  value={opt}
                  onSelect={() => toggle(opt)}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value.includes(opt) ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {opt}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

import { GripVertical } from "lucide-react";
import { useState } from "react";

export function moveListItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

export function ColumnOrderList<T extends string>({
  ids,
  label,
  checked,
  locked,
  onToggle,
  onReorder,
}: {
  ids: T[];
  label: (id: T) => string;
  checked: (id: T) => boolean;
  locked?: (id: T) => boolean;
  onToggle: (id: T) => void;
  onReorder: (from: number, to: number) => void;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  return (
    <div className="max-h-80 space-y-1 overflow-y-auto">
      {ids.map((id, index) => (
        <div
          key={id}
          draggable
          onDragStart={() => setDragIndex(index)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={() => {
            if (dragIndex == null) return;
            onReorder(dragIndex, index);
            setDragIndex(null);
          }}
          className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-gray-50"
        >
          <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-gray-400" />
          <input
            type="checkbox"
            checked={checked(id)}
            disabled={locked?.(id)}
            onChange={() => onToggle(id)}
          />
          <span>{label(id)}</span>
        </div>
      ))}
    </div>
  );
}

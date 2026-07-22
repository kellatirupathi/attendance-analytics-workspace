import React, { useState } from "react";
import {
  useListCampuses,
  getListCampusesQueryKey,
  useCreateCampus,
  useUpdateCampus,
  useDeleteCampus,
  type Campus,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableShell } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Edit2, Trash2, Plus, Building2 } from "lucide-react";

export default function AdminCampuses() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editCampus, setEditCampus] = useState<Campus | null>(null);

  const { data: campuses, isLoading } = useListCampuses({
    query: { queryKey: getListCampusesQueryKey() },
  });

  const deleteCampus = useDeleteCampus();

  const handleDelete = (id: string, name: string) => {
    if (!confirm(`Delete campus "${name}"?`)) return;
    deleteCampus.mutate(
      { id },
      {
        onSuccess: () => {
          toast({ title: "Campus deleted" });
          queryClient.invalidateQueries({ queryKey: getListCampusesQueryKey() });
        },
        onError: () =>
          toast({ variant: "destructive", title: "Error deleting campus" }),
      },
    );
  };

  return (
    <div className="flex flex-col">
      <PageHeader
        badge="Administration"
        title="Campus Setup"
        subtitle="Add and maintain campus records used for staff scope assignment."
        right={
          <Button onClick={() => setIsCreateOpen(true)} size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            Add campus
          </Button>
        }
      />

      <TableShell>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-gray-200 bg-gray-50 hover:bg-gray-50">
                <TableHead className="h-11 px-3 text-[11px] font-semibold uppercase tracking-wider text-gray-600">
                  Campus name
                </TableHead>
                <TableHead className="h-11 px-3 text-[11px] font-semibold uppercase tracking-wider text-gray-600">
                  Institute ID
                </TableHead>
                <TableHead className="h-11 px-3 text-[11px] font-semibold uppercase tracking-wider text-gray-600">
                  Added
                </TableHead>
                <TableHead className="h-11 w-[100px] px-3 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-600">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i} className="border-b border-gray-200">
                    <TableCell className="py-3">
                      <Skeleton className="h-5 w-48" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-24" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-28" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="ml-auto h-8 w-16" />
                    </TableCell>
                  </TableRow>
                ))
              ) : !campuses?.length ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-32 text-center">
                    <div className="flex flex-col items-center gap-2 text-gray-500">
                      <Building2 className="h-8 w-8 text-gray-400" />
                      <p className="text-sm font-medium text-gray-700">
                        No campuses yet
                      </p>
                      <p className="text-xs text-gray-500">
                        Add a campus to get started.
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                campuses.map((campus) => (
                  <TableRow
                    key={campus.id}
                    className="border-b border-gray-200 hover:bg-gray-50"
                  >
                    <TableCell className="py-3 font-medium text-gray-900">
                      {campus.name}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-gray-600">
                      {campus.instituteId || "—"}
                    </TableCell>
                    <TableCell className="text-sm text-gray-600">
                      {format(new Date(campus.createdAt), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setEditCampus(campus)}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-red-600 hover:bg-red-50 hover:text-red-700"
                          onClick={() => handleDelete(campus.id, campus.name)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </TableShell>

      <CampusFormSheet
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        mode="create"
      />
      {editCampus && (
        <CampusFormSheet
          open={!!editCampus}
          onOpenChange={(o) => !o && setEditCampus(null)}
          mode="edit"
          campus={editCampus}
        />
      )}
    </div>
  );
}

function CampusFormSheet({
  open,
  onOpenChange,
  mode,
  campus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  campus?: Campus;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState(campus?.name ?? "");
  const [instituteId, setInstituteId] = useState(campus?.instituteId ?? "");
  const [error, setError] = useState("");

  const createCampus = useCreateCampus();
  const updateCampus = useUpdateCampus();

  React.useEffect(() => {
    if (open) {
      setName(campus?.name ?? "");
      setInstituteId(campus?.instituteId ?? "");
      setError("");
    }
  }, [open, campus]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Campus name is required.");
      return;
    }
    setError("");

    if (mode === "create") {
      createCampus.mutate(
        { data: { name: name.trim(), instituteId: instituteId.trim() || undefined } },
        {
          onSuccess: () => {
            toast({ title: "Campus created" });
            queryClient.invalidateQueries({ queryKey: getListCampusesQueryKey() });
            onOpenChange(false);
          },
          onError: () =>
            toast({ variant: "destructive", title: "Failed to create campus" }),
        },
      );
    } else if (campus) {
      updateCampus.mutate(
        {
          id: campus.id,
          data: {
            name: name.trim(),
            instituteId: instituteId.trim() || undefined,
          },
        },
        {
          onSuccess: () => {
            toast({ title: "Campus updated" });
            queryClient.invalidateQueries({ queryKey: getListCampusesQueryKey() });
            onOpenChange(false);
          },
          onError: () =>
            toast({ variant: "destructive", title: "Failed to update campus" }),
        },
      );
    }
  };

  const pending = createCampus.isPending || updateCampus.isPending;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle>
            {mode === "create" ? "Add campus" : "Edit campus"}
          </SheetTitle>
          <SheetDescription>
            Campus names should match institute names in BigQuery for scope
            filtering to work correctly.
          </SheetDescription>
        </SheetHeader>

        <form
          onSubmit={handleSubmit}
          className="flex flex-1 flex-col gap-5 overflow-y-auto py-6"
        >
          <div className="space-y-1.5">
            <Label htmlFor="campus-name">Campus name</Label>
            <Input
              id="campus-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. NIAT Chevella"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="institute-id">Institute ID (optional)</Label>
            <Input
              id="institute-id"
              value={instituteId}
              onChange={(e) => setInstituteId(e.target.value)}
              placeholder="External institute identifier"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="mt-auto flex justify-end gap-2 border-t border-gray-200 pt-4">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={pending}
              className="bg-brand-600 text-white hover:bg-brand-700"
            >
              {mode === "create" ? "Create campus" : "Save changes"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

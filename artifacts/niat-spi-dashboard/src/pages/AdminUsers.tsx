import React, { useEffect, useState } from "react";
import {
  useListUsers,
  getListUsersQueryKey,
  useCreateUser,
  useUpdateUser,
  useDeleteUser,
  useGetAdminMeta,
  getGetAdminMetaQueryKey,
  type User,
  type AdminMeta,
} from "@workspace/api-client-react";
import { useAuth } from "@/contexts/AuthContext";
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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { MultiSelect } from "@/components/MultiSelect";
import { Edit2, Trash2, Shield, Plus } from "lucide-react";

const CAMPUS_ROLES = ["capability_manager", "boa", "instructor"];
const SUBJECT_ROLES = ["capability_manager", "instructor"];

export default function AdminUsers() {
  const { user: currentUser } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);

  const { data: users, isLoading } = useListUsers({
    query: { queryKey: getListUsersQueryKey() },
  });

  const { data: meta } = useGetAdminMeta({
    query: { queryKey: getGetAdminMetaQueryKey() },
  });

  const deleteUser = useDeleteUser();

  const handleDelete = (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete user ${name}?`)) return;
    deleteUser.mutate(
      { id },
      {
        onSuccess: () => {
          toast({ title: "User deleted" });
          queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
        },
        onError: () =>
          toast({ variant: "destructive", title: "Error deleting user" }),
      },
    );
  };

  const canEdit = (targetRole: string) => {
    if (currentUser?.role === "superadmin") return true;
    if (
      currentUser?.role === "admin" &&
      !["admin", "superadmin"].includes(targetRole)
    )
      return true;
    return false;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="font-serif text-[26px] font-semibold tracking-tight text-gray-900">
            Manage Users
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Add, update, and manage access for staff members.
          </p>
        </div>
        <Button
          onClick={() => setIsCreateOpen(true)}
          disabled={!meta}
          className="bg-brand-600 text-white hover:bg-brand-700"
        >
          <Plus className="mr-2 h-4 w-4" />
          Create user
        </Button>
      </div>

      <TableShell>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-gray-200 bg-gray-50 hover:bg-gray-50">
                <Th>User</Th>
                <Th>Role</Th>
                <Th>Scope</Th>
                <Th>Status</Th>
                <Th>Last Login</Th>
                <Th className="w-[100px] text-right">Actions</Th>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i} className="border-b border-gray-100">
                    <TableCell className="py-3">
                      <Skeleton className="h-10 w-48" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-6 w-20 rounded-full" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-24" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-6 w-16 rounded-full" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-24" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="ml-auto h-8 w-16" />
                    </TableCell>
                  </TableRow>
                ))
              ) : users?.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="h-24 text-center text-gray-500"
                  >
                    No users found.
                  </TableCell>
                </TableRow>
              ) : (
                users?.map((u) => (
                  <TableRow
                    key={u.id}
                    className="border-b border-gray-100 hover:bg-gray-50/70"
                  >
                    <TableCell className="py-3">
                      <div>
                        <p className="font-medium text-gray-900">{u.name}</p>
                        <p className="text-xs text-gray-500">{u.email}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`capitalize ${
                          u.role === "superadmin"
                            ? "border-purple-200 bg-purple-50 text-purple-700"
                            : u.role === "admin"
                              ? "border-blue-200 bg-blue-50 text-blue-700"
                              : "border-gray-200 bg-gray-50 text-gray-700"
                        }`}
                      >
                        {u.role === "superadmin" && (
                          <Shield className="mr-1 h-3 w-3" />
                        )}
                        {u.role.replace(/_/g, " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[220px] text-xs text-gray-500">
                      {u.campuses.length === 0 && u.subjects.length === 0 ? (
                        <span className="text-gray-400">All access</span>
                      ) : (
                        <span title={[...u.campuses, ...u.subjects].join(", ")}>
                          {u.campuses.length > 0 && (
                            <span className="block truncate">
                              {u.campuses.join(", ")}
                            </span>
                          )}
                          {u.subjects.length > 0 && (
                            <span className="block truncate text-gray-400">
                              {u.subjects.join(", ")}
                            </span>
                          )}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          u.isActive
                            ? "border-green-200 bg-green-50 text-green-700"
                            : "border-red-200 bg-red-50 text-red-700"
                        }
                      >
                        {u.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-gray-500">
                      {u.lastLoginAt
                        ? format(new Date(u.lastLoginAt), "MMM d, yyyy")
                        : "Never"}
                    </TableCell>
                    <TableCell className="text-right">
                      {canEdit(u.role) && (
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-gray-500 hover:text-brand-600"
                            onClick={() => setEditUser(u)}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-gray-500 hover:text-red-600"
                            onClick={() => handleDelete(u.id, u.name)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </TableShell>

      {isCreateOpen && (
        <UserFormDialog
          mode="create"
          meta={meta}
          open={isCreateOpen}
          onOpenChange={setIsCreateOpen}
        />
      )}
      {editUser && (
        <UserFormDialog
          mode="edit"
          user={editUser}
          meta={meta}
          open={!!editUser}
          onOpenChange={(o) => {
            if (!o) setEditUser(null);
          }}
        />
      )}
    </div>
  );
}

interface UserFormDialogProps {
  mode: "create" | "edit";
  user?: User;
  meta: AdminMeta | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function UserFormDialog({
  mode,
  user,
  meta,
  open,
  onOpenChange,
}: UserFormDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();

  const roleOptions = meta?.roles ?? [];
  const campusOptions = meta?.campuses ?? [];
  const subjectOptions = meta?.subjects ?? [];

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [campuses, setCampuses] = useState<string[]>([]);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && user) {
      setName(user.name);
      setEmail(user.email);
      setPassword("");
      setRole(user.role);
      setIsActive(user.isActive);
      setCampuses(user.campuses ?? []);
      setSubjects(user.subjects ?? []);
    } else {
      setName("");
      setEmail("");
      setPassword("");
      setRole(roleOptions[0]?.value ?? "");
      setIsActive(true);
      setCampuses([]);
      setSubjects([]);
    }
    setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, user]);

  const showCampuses = CAMPUS_ROLES.includes(role);
  const showSubjects = SUBJECT_ROLES.includes(role);
  const isSubmitting = createUser.isPending || updateUser.isPending;

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = "Name is required";
    if (!email.trim()) next.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      next.email = "Enter a valid email";
    if (!role) next.role = "Role is required";
    if (mode === "create" && !password.trim())
      next.password = "Password is required";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    const scopedCampuses = showCampuses ? campuses : [];
    const scopedSubjects = showSubjects ? subjects : [];

    const onSuccess = () => {
      toast({
        title: mode === "create" ? "User created" : "User updated",
      });
      queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
      onOpenChange(false);
    };
    const onError = (err: unknown) => {
      const message =
        (err as { data?: { error?: string } })?.data?.error ??
        (err instanceof Error ? err.message : "Something went wrong");
      toast({
        variant: "destructive",
        title:
          mode === "create" ? "Error creating user" : "Error updating user",
        description: message,
      });
    };

    if (mode === "create") {
      createUser.mutate(
        {
          data: {
            name: name.trim(),
            email: email.trim(),
            password: password.trim(),
            role,
            campuses: scopedCampuses,
            subjects: scopedSubjects,
            isActive,
          },
        },
        { onSuccess, onError },
      );
    } else if (user) {
      updateUser.mutate(
        {
          id: user.id,
          data: {
            name: name.trim(),
            email: email.trim(),
            ...(password.trim() ? { password: password.trim() } : {}),
            role,
            campuses: scopedCampuses,
            subjects: scopedSubjects,
            isActive,
          },
        },
        { onSuccess, onError },
      );
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
      >
        <SheetHeader className="border-b border-gray-100 px-6 py-5 text-left">
          <SheetTitle>
            {mode === "create" ? "Create user" : "Edit user"}
          </SheetTitle>
          <SheetDescription>
            {mode === "create"
              ? "Add a new staff member and set their access."
              : "Update this staff member's details and access."}
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
            <div className="space-y-1.5">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name"
              />
              {errors.name && (
                <p className="text-xs text-red-600">{errors.name}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@nxtwave.co.in"
              />
              {errors.email && (
                <p className="text-xs text-red-600">{errors.email}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">
                Password{" "}
                {mode === "edit" && (
                  <span className="font-normal text-gray-400">
                    (leave blank to keep current)
                  </span>
                )}
              </Label>
              <Input
                id="password"
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === "create" ? "Set a password" : "••••••••"}
              />
              {errors.password && (
                <p className="text-xs text-red-600">{errors.password}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a role" />
                </SelectTrigger>
                <SelectContent>
                  {roleOptions.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.role && (
                <p className="text-xs text-red-600">{errors.role}</p>
              )}
              {role && (
                <p className="text-xs text-gray-400">
                  {roleOptions.find((r) => r.value === role)?.description}
                </p>
              )}
            </div>

            {showCampuses && (
              <div className="space-y-1.5">
                <Label>Campuses</Label>
                <MultiSelect
                  options={campusOptions}
                  value={campuses}
                  onChange={setCampuses}
                  placeholder="Select campuses…"
                  emptyText="No campuses."
                />
              </div>
            )}

            {showSubjects && (
              <div className="space-y-1.5">
                <Label>Subjects</Label>
                <MultiSelect
                  options={subjectOptions}
                  value={subjects}
                  onChange={setSubjects}
                  placeholder="Select subjects…"
                  emptyText="No subjects."
                />
              </div>
            )}

            <div className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2.5">
              <div>
                <Label htmlFor="active" className="cursor-pointer">
                  Active
                </Label>
                <p className="text-xs text-gray-400">
                  Inactive users cannot sign in.
                </p>
              </div>
              <Switch
                id="active"
                checked={isActive}
                onCheckedChange={setIsActive}
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-6 py-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="bg-brand-600 text-white hover:bg-brand-700"
              disabled={isSubmitting}
            >
              {isSubmitting
                ? "Saving…"
                : mode === "create"
                  ? "Create user"
                  : "Save changes"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function Th({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <TableHead
      className={
        "h-11 text-[11px] font-semibold uppercase tracking-wider text-gray-500 " +
        (className ?? "")
      }
    >
      {children}
    </TableHead>
  );
}

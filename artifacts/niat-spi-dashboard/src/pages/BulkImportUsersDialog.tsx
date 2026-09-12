import React, { useMemo, useRef, useState } from "react";
import {
  getListUsersQueryKey,
  useBulkCreateUsers,
  type AdminMeta,
  type BulkUserResult,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  campusInstructorEmail,
  exportCsv,
  parseBulkUsersCsv,
  type BulkUserCsvRow,
} from "@/lib/csv";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Download, Loader2, Upload } from "lucide-react";

const DUMMY_PASSWORD = "Niat@2026";
const TEMPLATE_HEADERS = [
  "name",
  "email",
  "role",
  "campuses",
  "subjects",
  "password",
];

function campusLoginRow(campus: string): string[] {
  return [
    `${campus} Instructor`,
    campusInstructorEmail(campus),
    "instructor",
    campus,
    "",
    DUMMY_PASSWORD,
  ];
}

interface BulkImportUsersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meta: AdminMeta | undefined;
}

export function BulkImportUsersDialog({
  open,
  onOpenChange,
  meta,
}: BulkImportUsersDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const bulkCreate = useBulkCreateUsers();

  const [password, setPassword] = useState(DUMMY_PASSWORD);
  const [csvText, setCsvText] = useState("");
  const [result, setResult] = useState<BulkUserResult | null>(null);

  const parsed = useMemo(() => {
    if (!csvText.trim()) return { rows: [] as BulkUserCsvRow[] };
    return parseBulkUsersCsv(csvText);
  }, [csvText]);

  const reset = () => {
    setPassword(DUMMY_PASSWORD);
    setCsvText("");
    setResult(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const downloadTemplate = () => {
    const campuses = meta?.campuses ?? [];
    const rows =
      campuses.length > 0
        ? campuses.map((campus) => campusLoginRow(campus))
        : [
            [
              "CDU Instructor",
              "cdu.instructor@nxtwave.co.in",
              "instructor",
              "Chaitanya Deemed-to-be University",
              "",
              DUMMY_PASSWORD,
            ],
          ];
    exportCsv("staff-login-template.csv", TEMPLATE_HEADERS, rows);
  };

  const fillFromCampuses = () => {
    const campuses = meta?.campuses ?? [];
    if (campuses.length === 0) {
      toast({
        variant: "destructive",
        title: "No campuses found",
        description: "Add campuses first, then generate instructor logins.",
      });
      return;
    }
    const header = TEMPLATE_HEADERS.join(",");
    const lines = campuses.map((campus) => {
      const [name, email, role, campusName, subjects, rowPassword] =
        campusLoginRow(campus);
      return [
        name,
        email,
        role,
        `"${String(campusName).replace(/"/g, '""')}"`,
        subjects,
        rowPassword,
      ].join(",");
    });
    setCsvText([header, ...lines].join("\n"));
    setResult(null);
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    setCsvText(text);
    setResult(null);
  };

  const handleImport = () => {
    if (parsed.error) {
      toast({ variant: "destructive", title: parsed.error });
      return;
    }
    if (parsed.rows.length === 0) {
      toast({
        variant: "destructive",
        title: "Add users first",
        description: "Upload a CSV or generate one login per campus.",
      });
      return;
    }
    if (password.trim().length < 6) {
      toast({
        variant: "destructive",
        title: "Shared password required",
        description: "Use at least 6 characters. All new accounts share it.",
      });
      return;
    }

    bulkCreate.mutate(
      {
        data: {
          password: password.trim(),
          users: parsed.rows.map((row) => ({
            name: row.name,
            email: row.email,
            role: row.role,
            campuses: row.campuses,
            subjects: row.subjects,
            ...(row.password ? { password: row.password } : {}),
          })),
        },
      },
      {
        onSuccess: (data) => {
          setResult(data);
          queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
          toast({
            title: `Created ${data.created.length} account${data.created.length === 1 ? "" : "s"}`,
            description:
              data.skipped.length || data.errors.length
                ? `${data.skipped.length} skipped, ${data.errors.length} failed`
                : "They can sign in at /staff-login with the shared password.",
          });
        },
        onError: (err) => {
          const message =
            (err as { data?: { error?: string } })?.data?.error ??
            (err instanceof Error ? err.message : "Import failed");
          toast({
            variant: "destructive",
            title: "Could not import users",
            description: message,
          });
        },
      },
    );
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl"
      >
        <SheetHeader className="border-b border-gray-100 px-6 py-5 text-left">
          <SheetTitle>Bulk import logins</SheetTitle>
          <SheetDescription>
            Create many BOA or instructor accounts at once. Leave subjects empty
            for institute-wide instructor access. Dummy emails use password
            login, not Google.
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
            <div className="space-y-1.5">
              <Label htmlFor="bulk-password">Shared password</Label>
              <Input
                id="bulk-password"
                type="text"
                autoComplete="off"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={DUMMY_PASSWORD}
              />
              <p className="text-xs text-gray-400">
                Default dummy password is {DUMMY_PASSWORD}. The generated sheet
                includes this in the password column. A row password overrides
                the shared one.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={downloadTemplate}
              >
                <Download className="h-4 w-4" />
                Download template
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={fillFromCampuses}
                disabled={!meta}
              >
                One instructor login per campus
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="h-4 w-4" />
                Upload CSV
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => void handleFile(e.target.files?.[0])}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="bulk-csv">CSV</Label>
              <Textarea
                id="bulk-csv"
                value={csvText}
                onChange={(e) => {
                  setCsvText(e.target.value);
                  setResult(null);
                }}
                placeholder="name,email,role,campuses,subjects"
                className="min-h-[140px] font-mono text-xs"
              />
              {parsed.error && (
                <p className="text-xs text-red-600">{parsed.error}</p>
              )}
            </div>

            {parsed.rows.length > 0 && (
              <div className="overflow-hidden rounded-lg border border-gray-200">
                <div className="border-b border-gray-100 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-600">
                  Preview · {parsed.rows.length} account
                  {parsed.rows.length === 1 ? "" : "s"}
                </div>
                <div className="max-h-56 overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Campus</TableHead>
                        <TableHead>Password</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {parsed.rows.slice(0, 40).map((row) => (
                        <TableRow key={`${row.row}-${row.email}`}>
                          <TableCell className="text-sm">{row.name || "—"}</TableCell>
                          <TableCell className="text-xs">{row.email || "—"}</TableCell>
                          <TableCell className="text-xs capitalize">
                            {row.role.replace(/_/g, " ") || "—"}
                          </TableCell>
                          <TableCell className="text-xs text-gray-500">
                            {row.campuses.join(", ") || "—"}
                          </TableCell>
                          <TableCell className="text-xs">
                            {row.password || password || "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {result && (
              <Alert>
                <AlertDescription className="space-y-2 text-sm">
                  <p>
                    Created {result.created.length}. Skipped {result.skipped.length}.
                    Failed {result.errors.length}.
                  </p>
                  {[...result.skipped, ...result.errors].slice(0, 8).map((issue) => (
                    <p key={`${issue.row}-${issue.email}`} className="text-xs text-gray-500">
                      Row {issue.row}: {issue.email || "(no email)"} — {issue.reason}
                    </p>
                  ))}
                </AlertDescription>
              </Alert>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-6 py-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={bulkCreate.isPending}
            >
              Close
            </Button>
            <Button
              type="button"
              className="bg-brand-600 text-white hover:bg-brand-700"
              onClick={handleImport}
              disabled={bulkCreate.isPending || !!parsed.error}
            >
              {bulkCreate.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating…
                </>
              ) : (
                "Create accounts"
              )}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import { AlertCircle, Eye, EyeOff, Loader2 } from "lucide-react";
import { Logo } from "@/components/LogoMark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useQueryParams } from "@/hooks/useQueryParams";

/**
 * Test student login: student UUID + password opens that student's report only.
 * For testing until the Learning Portal SSO passes the UUID in.
 */
export default function StudentLogin() {
  // ?next=/spi/<uuid> is set when a report sent the user here; the UUID is prefilled from it.
  const next = useQueryParams().get("next");
  const safeNext = next && next.startsWith("/spi/") && !next.includes("//") ? next : null;
  const [studentId, setStudentId] = useState(safeNext ? decodeURIComponent(safeNext.slice("/spi/".length).split(/[/?#]/)[0] ?? "") : "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [, setLocation] = useLocation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = studentId.trim();
    if (!id || !password) return;
    setPending(true);
    setFailed(false);
    try {
      const res = await fetch("/api/auth/student-login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login: id, password }),
      });
      if (!res.ok) throw new Error(String(res.status));
      // The server says which student this login opens (the login may be an email).
      const { studentId: opened } = (await res.json()) as { studentId: string };
      setLocation(`/spi/${encodeURIComponent(opened)}`);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] w-full items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-[400px]">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <h1 className="mb-1 text-center text-2xl font-bold tracking-tight text-slate-900">Student sign in</h1>
        <p className="mb-6 text-center text-sm text-slate-500">Open your Skill Performance report</p>

        {failed && (
          <Alert role="alert" variant="destructive" className="mb-5 border-red-200 bg-red-50 text-red-900 [&>svg]:text-red-600">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-[13px] font-medium">Invalid email, student ID or password. Please try again.</AlertDescription>
          </Alert>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="studentId" className="text-sm font-medium text-slate-700">Email or student ID</Label>
            <Input
              id="studentId"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={studentId}
              onChange={(e) => {
                setStudentId(e.target.value);
                setFailed(false);
              }}
              required
              className="h-11 bg-white"
              disabled={pending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="studentPassword" className="text-sm font-medium text-slate-700">Password</Label>
            <div className="relative">
              <Input
                id="studentPassword"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setFailed(false);
                }}
                required
                className="h-11 bg-white pr-10"
                disabled={pending}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-sm text-slate-400 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                disabled={pending}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <Button type="submit" className="h-11 w-full bg-brand-600 font-medium text-white shadow-sm hover:bg-brand-700" disabled={pending}>
            {pending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                Signing in...
              </>
            ) : (
              "Open report"
            )}
          </Button>
        </form>

        <p className="mt-8 text-center text-sm text-slate-500">
          Staff? <Link href={`/staff-login${safeNext ? `?next=${encodeURIComponent(safeNext)}` : ""}`} className="font-medium text-brand-600 hover:underline">Sign in here</Link>
        </p>
      </div>
    </div>
  );
}

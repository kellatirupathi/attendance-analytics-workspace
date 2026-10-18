import React, { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Logo } from "@/components/LogoMark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLogin, getGetMeQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Eye, EyeOff, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryParams } from "@/hooks/useQueryParams";

export default function StaffLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const loginMutation = useLogin();
  const { user, isLoading: authLoading } = useAuth();

  // ?next= is set when a protected page (e.g. a student report) sent the user here.
  // Only same-site paths are followed, never "//host" or full URLs.
  const next = useQueryParams().get("next");
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : null;
  const homeFor = (role: string) => (role === "instructor" ? "/instructor" : safeNext ?? "/dashboard");

  // Already signed in (e.g. cookie from a prior attempt) — go straight on.
  useEffect(() => {
    if (!authLoading && user) {
      setLocation(homeFor(user.role));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, setLocation]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;

    loginMutation.mutate(
      { data: { email: email.trim(), password } },
      {
        onSuccess: async (loggedInUser) => {
          // Cancel any in-flight /me from the login page (no cookie yet). If that
          // 401 lands after login it wipes the cache and forces a second sign-in.
          await queryClient.cancelQueries({ queryKey: getGetMeQueryKey() });
          queryClient.setQueryData(getGetMeQueryKey(), loggedInUser);
          setLocation(homeFor(loggedInUser.role));
        },
      },
    );
  };

  return (
    <div className="min-h-[100dvh] w-full flex bg-slate-50 lg:bg-white">
      {/* Left Panel - Branding */}
      <div className="hidden lg:flex flex-col justify-between w-1/2 bg-slate-950 relative overflow-hidden p-12 xl:p-16">
        {/* Decorative Background */}
        <div className="absolute inset-0 pointer-events-none">
          {/* Abstract glowing orbs */}
          <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] rounded-full bg-brand-500/20 blur-[120px]" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[600px] h-[600px] rounded-full bg-brand-600/20 blur-[130px]" />

          {/* Subtle grid pattern */}
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff08_1px,transparent_1px),linear-gradient(to_bottom,#ffffff08_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:radial-gradient(ellipse_80%_80%_at_50%_50%,#000_20%,transparent_100%)]" />
        </div>

        <div className="relative z-10">
          <Logo inverted />
        </div>

        <div className="relative z-10 max-w-lg mb-12">
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h1 className="text-4xl xl:text-5xl font-bold text-white tracking-tight mb-6 leading-[1.1]">
              Skill Performance<br />
              <span className="text-brand-400">Index</span>
            </h1>
            <p className="text-slate-400 text-lg leading-relaxed">
              The centralized academic platform for monitoring student progress, managing recovery sessions, and driving operational excellence.
            </p>
          </div>
        </div>
      </div>

      {/* Right Panel - Login Form */}
      <div className="w-full lg:w-1/2 flex flex-col justify-center items-center p-6 sm:p-12 relative">
        <div className="w-full max-w-[400px]">
          {/* Mobile Logo */}
          <div className="lg:hidden flex justify-center mb-10">
            <Logo />
          </div>

          <div className="animate-in fade-in slide-in-from-bottom-3 duration-500">
            <div className="text-center lg:text-left mb-8">
              <h2 className="text-3xl font-bold tracking-tight text-slate-900 mb-2">Welcome back</h2>
              <p className="text-slate-500">Sign in to your staff account to continue</p>
            </div>

            {loginMutation.isError && (
              <div className="mb-6 animate-in fade-in slide-in-from-top-1 duration-200">
                <Alert
                  role="alert"
                  variant="destructive"
                  className="border-red-200 bg-red-50 text-red-900 [&>svg]:text-red-600"
                >
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="font-medium text-[13px]">
                    Invalid email or password. Please try again.
                  </AlertDescription>
                </Alert>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-medium text-slate-700">Email address</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  autoCapitalize="none"
                  inputMode="email"
                  spellCheck={false}
                  placeholder="name@niat.edu"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (loginMutation.isError) loginMutation.reset();
                  }}
                  required
                  className="h-11 bg-white"
                  disabled={loginMutation.isPending}
                  aria-invalid={loginMutation.isError}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-sm font-medium text-slate-700">Password</Label>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (loginMutation.isError) loginMutation.reset();
                    }}
                    required
                    className="h-11 bg-white pr-10"
                    disabled={loginMutation.isPending}
                    aria-invalid={loginMutation.isError}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded-sm transition-colors"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                    disabled={loginMutation.isPending}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                className="w-full h-11 bg-brand-600 hover:bg-brand-700 text-white font-medium shadow-sm transition-all"
                disabled={loginMutation.isPending}
              >
                {loginMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                    Signing in...
                  </>
                ) : (
                  "Sign in"
                )}
              </Button>
            </form>

            <div className="mt-8">
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-200"></div>
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-3 bg-slate-50 lg:bg-white text-slate-500 font-medium">
                    Or continue with
                  </span>
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                className="w-full mt-6 h-11 bg-white border-slate-200 hover:bg-slate-50 hover:text-slate-900 transition-colors text-slate-700 font-medium shadow-sm"
                onClick={() => {
                  window.location.href = "/api/auth/google/start";
                }}
                disabled={loginMutation.isPending}
              >
                <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                Google Workspace
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import React, { createContext, useContext, ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";
import type { AuthUser } from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";
import { useLocation } from "wouter";

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  isError: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  isError: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: user, isLoading, isError, isPending } = useGetMe({
    query: {
      queryKey: getGetMeQueryKey(),
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      staleTime: 60_000,
    },
  });

  // isPending covers the initial /me fetch; keep loading until we know auth state.
  const authLoading = isLoading || (isPending && user == null);

  return (
    <AuthContext.Provider
      value={{ user: user ?? null, isLoading: authLoading, isError }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

export function ProtectedRoute({
  children,
  adminOnly = false,
  superadminOnly = false,
}: {
  children: ReactNode;
  adminOnly?: boolean;
  superadminOnly?: boolean;
}) {
  const queryClient = useQueryClient();
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  // Fall back to the query cache so a just-completed login is visible before
  // subscribers re-render (and so a late 401 refetch cannot flash logged-out).
  const cachedUser =
    queryClient.getQueryData<AuthUser>(getGetMeQueryKey()) ?? null;
  const sessionUser = user ?? cachedUser;

  const lacksAccess = (role: string) =>
    (adminOnly && !["admin", "superadmin"].includes(role)) ||
    (superadminOnly && role !== "superadmin");

  React.useEffect(() => {
    if (isLoading) return;
    if (!sessionUser) {
      setLocation("/staff-login");
    } else if (lacksAccess(sessionUser.role)) {
      setLocation("/dashboard");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionUser, isLoading, setLocation, adminOnly, superadminOnly]);

  if (isLoading && !sessionUser) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!sessionUser || lacksAccess(sessionUser.role)) {
    return null;
  }

  return <>{children}</>;
}

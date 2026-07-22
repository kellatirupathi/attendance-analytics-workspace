import React, { createContext, useContext, ReactNode } from "react";
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
  const { data: user, isLoading, isError } = useGetMe({
    query: {
      queryKey: getGetMeQueryKey(),
      retry: false,
      refetchOnWindowFocus: false,
    },
  });

  return (
    <AuthContext.Provider value={{ user: user ?? null, isLoading, isError }}>
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
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  const lacksAccess = (role: string) =>
    (adminOnly && !["admin", "superadmin"].includes(role)) ||
    (superadminOnly && role !== "superadmin");

  React.useEffect(() => {
    if (!isLoading && !user) {
      setLocation("/staff-login");
    } else if (!isLoading && user && lacksAccess(user.role)) {
      setLocation("/dashboard");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isLoading, setLocation, adminOnly, superadminOnly]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user || lacksAccess(user.role)) {
    return null;
  }

  return <>{children}</>;
}

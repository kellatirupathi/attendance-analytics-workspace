import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, ProtectedRoute } from "@/contexts/AuthContext";
import { DashboardLayout } from "@/components/DashboardLayout";
import type { ReactNode } from "react";

// Pages
import NotFound from "@/pages/not-found";
import Landing from "@/pages/Landing";
import StaffLogin from "@/pages/StaffLogin";
import Dashboard from "@/pages/Dashboard";
import SpiReport from "@/pages/SpiReport";
import Students from "@/pages/Students";
import Campuses from "@/pages/Campuses";
import Profile from "@/pages/Profile";
import BigQueryExplorer from "@/pages/BigQueryExplorer";
import AdminUsers from "@/pages/AdminUsers";
import AdminCampuses from "@/pages/AdminCampuses";
import AttendanceRequests from "@/pages/AttendanceRequests";

const queryClient = new QueryClient();

function Protected({
  children,
  adminOnly,
  superadminOnly,
}: {
  children: ReactNode;
  adminOnly?: boolean;
  superadminOnly?: boolean;
}) {
  return (
    <ProtectedRoute adminOnly={adminOnly} superadminOnly={superadminOnly}>
      <DashboardLayout>{children}</DashboardLayout>
    </ProtectedRoute>
  );
}

function Router() {
  return (
    <Switch>
      {/* Public */}
      <Route path="/" component={Landing} />
      <Route path="/staff-login" component={StaffLogin} />
      <Route path="/spi/:studentId" component={SpiReport} />

      {/* Authenticated dashboard */}
      <Route path="/dashboard">
        <Protected>
          <Dashboard />
        </Protected>
      </Route>
      <Route path="/dashboard/students">
        <Protected>
          <Students />
        </Protected>
      </Route>
      <Route path="/dashboard/campuses">
        <Protected>
          <Campuses />
        </Protected>
      </Route>
      <Route path="/dashboard/profile">
        <Protected>
          <Profile />
        </Protected>
      </Route>
      <Route path="/dashboard/requests">
        <Protected>
          <AttendanceRequests />
        </Protected>
      </Route>
      <Route path="/dashboard/bigquery">
        <Protected superadminOnly>
          <BigQueryExplorer />
        </Protected>
      </Route>

      {/* Admin (superadmin/admin) */}
      <Route path="/admin/users">
        <Protected adminOnly>
          <AdminUsers />
        </Protected>
      </Route>
      <Route path="/admin/campuses">
        <Protected adminOnly>
          <AdminCampuses />
        </Protected>
      </Route>

      {/* 404 fallback — keep last */}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <Router />
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

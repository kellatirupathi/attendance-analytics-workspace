import { lazy, Suspense, type ReactNode } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, ProtectedRoute } from "@/contexts/AuthContext";
import { DashboardLayout } from "@/components/DashboardLayout";
import { PageLoader } from "@/components/PageLoader";

// Pages load on demand so staff only download the feature they visit.
const NotFound = lazy(() => import("@/pages/not-found"));
const Landing = lazy(() => import("@/pages/Landing"));
const StaffLogin = lazy(() => import("@/pages/StaffLogin"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const SpiReport = lazy(() => import("@/pages/SpiReport"));
const Students = lazy(() => import("@/pages/Students"));
const Campuses = lazy(() => import("@/pages/Campuses"));
const Profile = lazy(() => import("@/pages/Profile"));
const BigQueryExplorer = lazy(() => import("@/pages/BigQueryExplorer"));
const AdminUsers = lazy(() => import("@/pages/AdminUsers"));
const AdminCampuses = lazy(() => import("@/pages/AdminCampuses"));
const AttendanceRequests = lazy(() => import("@/pages/AttendanceRequests"));
const StudentAttendanceStats = lazy(() => import("@/pages/StudentAttendanceStats"));
const SubjectAttendanceStudents = lazy(
  () => import("@/pages/SubjectAttendanceStudents"),
);
const CampusWiseStats = lazy(() => import("@/pages/CampusWiseStats"));
const Assessments = lazy(() => import("@/pages/Assessments"));
const SubjectSessions = lazy(() => import("@/pages/SubjectSessions"));
const Recovery = lazy(() => import("@/pages/Recovery"));
const RecoverySubjectDetail = lazy(
  () => import("@/pages/RecoverySubjectDetail"),
);
const RecoveryQuizSubjectDetail = lazy(
  () => import("@/pages/RecoveryQuizSubjectDetail"),
);
const InstructorRecovery = lazy(() => import("@/pages/InstructorRecovery"));
const AdminRecoveryInstructors = lazy(
  () => import("@/pages/AdminRecoveryInstructors"),
);

const queryClient = new QueryClient();

function Protected({
  children,
  adminOnly,
  superadminOnly,
  instructorOnly,
  allowInstructor,
}: {
  children: ReactNode;
  adminOnly?: boolean;
  superadminOnly?: boolean;
  instructorOnly?: boolean;
  allowInstructor?: boolean;
}) {
  return (
    <ProtectedRoute
      adminOnly={adminOnly}
      superadminOnly={superadminOnly}
      instructorOnly={instructorOnly}
      allowInstructor={allowInstructor}
    >
      <DashboardLayout>
        <Suspense fallback={<PageLoader />}>{children}</Suspense>
      </DashboardLayout>
    </ProtectedRoute>
  );
}

function Router() {
  return (
    <Suspense fallback={<PageLoader />}>
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
        <Route path="/dashboard/attendance-stats/campuses">
          <Protected>
            <CampusWiseStats />
          </Protected>
        </Route>
        <Route path="/dashboard/attendance-stats/sessions">
          <Protected>
            <SubjectSessions />
          </Protected>
        </Route>
        <Route path="/dashboard/attendance-stats/students">
          <Protected>
            <SubjectAttendanceStudents />
          </Protected>
        </Route>
        <Route path="/dashboard/attendance-stats">
          <Protected>
            <StudentAttendanceStats />
          </Protected>
        </Route>
        <Route path="/dashboard/assessments/students">
          <Protected>
            <Assessments />
          </Protected>
        </Route>
        <Route path="/dashboard/assessments">
          <Protected>
            <Assessments />
          </Protected>
        </Route>
        <Route path="/dashboard/campuses">
          <Protected>
            <Campuses />
          </Protected>
        </Route>
        <Route path="/dashboard/recovery/quiz/:campus/:subject">
          <Protected>
            <RecoveryQuizSubjectDetail />
          </Protected>
        </Route>
        <Route path="/dashboard/recovery/quiz">
          <Protected>
            <Recovery />
          </Protected>
        </Route>
        <Route path="/dashboard/recovery/:campus/:subject">
          <Protected>
            <RecoverySubjectDetail />
          </Protected>
        </Route>
        <Route path="/dashboard/recovery">
          <Protected>
            <Recovery />
          </Protected>
        </Route>
        <Route path="/dashboard/profile">
          <Protected allowInstructor>
            <Profile />
          </Protected>
        </Route>
        <Route path="/instructor">
          <Protected instructorOnly>
            <InstructorRecovery />
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
        <Route path="/admin/recovery-instructors">
          <Protected adminOnly>
            <AdminRecoveryInstructors />
          </Protected>
        </Route>

        {/* 404 fallback — keep last */}
        <Route component={NotFound} />
      </Switch>
    </Suspense>
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

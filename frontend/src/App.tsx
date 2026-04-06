import { Box } from "@mui/material";
import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import MainLayout from "./app/layout/MainLayout";
import ProtectedRoute from "./auth/components/ProtectedRoute";
import LoginPage from "./auth/pages/LoginPage";
import { TPageSkeleton } from "./components/tijaero";

// Lazy load route modules for better initial load performance
const DashboardPage = lazy(() => import("./app/pages/DashboardPage"));
const SalesRoutes = lazy(() => import("./modules/sales/routes"));
const InventoryRoutes = lazy(() => import("./modules/inventory/routes"));
const PurchasingRoutes = lazy(() => import("./modules/purchasing/routes"));
const FinanceRoutes = lazy(() => import("./modules/finance/routes"));
const HRRoutes = lazy(() => import("./modules/hr/routes"));
const WarehouseRoutes = lazy(() => import("./modules/warehouse/routes"));
const SupportRoutes = lazy(() => import("./modules/support/routes"));
const ReportingRoutes = lazy(() => import("./modules/reporting/routes"));
const BranchesRoutes = lazy(() => import("./modules/branches/routes"));
const UsersPage = lazy(() => import("./modules/users/pages/UsersPage"));
const SettingsPage = lazy(
  () => import("./modules/settings/pages/SettingsPage"),
);
const CompanySettingsPage = lazy(
  () => import("./modules/settings/pages/CompanySettingsPage"),
);
const GroupsPage = lazy(() => import("./modules/groups/pages/GroupsPage"));

// Loading fallback component
function RouteLoadingFallback() {
  return <TPageSkeleton />;
}

function App() {
  return (
    <Box
      sx={{
        display: "flex",
        minHeight: "100dvh",
        width: "100%",
        maxWidth: "100vw",
        overflow: "hidden",
      }}
    >
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route
          element={
            <ProtectedRoute>
              <MainLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute resource="dashboard" action="view">
                <Suspense fallback={<RouteLoadingFallback />}>
                  <DashboardPage />
                </Suspense>
              </ProtectedRoute>
            }
          />
          <Route
            path="/sales/*"
            element={
              <ProtectedRoute resource="sales" action="view">
                <Suspense fallback={<RouteLoadingFallback />}>
                  <SalesRoutes />
                </Suspense>
              </ProtectedRoute>
            }
          />
          <Route
            path="/inventory/*"
            element={
              <ProtectedRoute resource="inventory" action="view">
                <Suspense fallback={<RouteLoadingFallback />}>
                  <InventoryRoutes />
                </Suspense>
              </ProtectedRoute>
            }
          />
          <Route
            path="/purchasing/*"
            element={
              <ProtectedRoute resource="purchasing" action="view">
                <Suspense fallback={<RouteLoadingFallback />}>
                  <PurchasingRoutes />
                </Suspense>
              </ProtectedRoute>
            }
          />
          <Route
            path="/finance/*"
            element={
              <ProtectedRoute resource="finance" action="view">
                <Suspense fallback={<RouteLoadingFallback />}>
                  <FinanceRoutes />
                </Suspense>
              </ProtectedRoute>
            }
          />
          <Route
            path="/hr/*"
            element={
              <ProtectedRoute resource="hr" action="view">
                <Suspense fallback={<RouteLoadingFallback />}>
                  <HRRoutes />
                </Suspense>
              </ProtectedRoute>
            }
          />
          <Route
            path="/warehouse/*"
            element={
              <ProtectedRoute resource="warehouse" action="view">
                <Suspense fallback={<RouteLoadingFallback />}>
                  <WarehouseRoutes />
                </Suspense>
              </ProtectedRoute>
            }
          />
          <Route
            path="/support/*"
            element={
              <ProtectedRoute resource="support" action="view">
                <Suspense fallback={<RouteLoadingFallback />}>
                  <SupportRoutes />
                </Suspense>
              </ProtectedRoute>
            }
          />
          <Route
            path="/reporting/*"
            element={
              <ProtectedRoute resource="reporting" action="view">
                <Suspense fallback={<RouteLoadingFallback />}>
                  <ReportingRoutes />
                </Suspense>
              </ProtectedRoute>
            }
          />
          <Route
            path="/branches/*"
            element={
              <ProtectedRoute resource="branches" action="view">
                <Suspense fallback={<RouteLoadingFallback />}>
                  <BranchesRoutes />
                </Suspense>
              </ProtectedRoute>
            }
          />
          <Route
            path="/users"
            element={
              <ProtectedRoute resource="users" action="view">
                <Suspense fallback={<RouteLoadingFallback />}>
                  <UsersPage />
                </Suspense>
              </ProtectedRoute>
            }
          />
          <Route
            path="/roles"
            element={
              <ProtectedRoute resource="groups" action="view">
                <Suspense fallback={<RouteLoadingFallback />}>
                  <GroupsPage />
                </Suspense>
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute resource="settings" action="view">
                <Suspense fallback={<RouteLoadingFallback />}>
                  <SettingsPage />
                </Suspense>
              </ProtectedRoute>
            }
          />
          <Route
            path="/company-settings"
            element={
              <ProtectedRoute resource="settings" action="view">
                <Suspense fallback={<RouteLoadingFallback />}>
                  <CompanySettingsPage />
                </Suspense>
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
    </Box>
  );
}

export default App;

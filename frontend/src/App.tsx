import { Box } from "@mui/material";
import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import MainLayout from "./app/layout/MainLayout";
import ProtectedRoute from "./auth/components/ProtectedRoute";
import LoginPage from "./auth/pages/LoginPage";
import { TPageSkeleton } from "./components/tijaero";
import PermissionGuard from "./auth/components/PermissionGuard";

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
          <Route path="/dashboard" element={
            <Suspense fallback={<RouteLoadingFallback />}>
              <DashboardPage />
            </Suspense>
          } />
          <Route path="/sales/*" element={
            <PermissionGuard resource="sales" action="view" redirectTo="/dashboard">
              <Suspense fallback={<RouteLoadingFallback />}>
                <SalesRoutes />
              </Suspense>
            </PermissionGuard>
          } />
          <Route path="/inventory/*" element={
            <PermissionGuard resource="inventory" action="view" redirectTo="/dashboard">
              <Suspense fallback={<RouteLoadingFallback />}>
                <InventoryRoutes />
              </Suspense>
            </PermissionGuard>
          } />
          <Route path="/purchasing/*" element={
            <PermissionGuard resource="purchasing" action="view" redirectTo="/dashboard">
              <Suspense fallback={<RouteLoadingFallback />}>
                <PurchasingRoutes />
              </Suspense>
            </PermissionGuard>
          } />
          <Route path="/finance/*" element={
            <PermissionGuard resource="finance" action="view" redirectTo="/dashboard">
              <Suspense fallback={<RouteLoadingFallback />}>
                <FinanceRoutes />
              </Suspense>
            </PermissionGuard>
          } />
          <Route path="/hr/*" element={
            <PermissionGuard resource="hr" action="view" redirectTo="/dashboard">
              <Suspense fallback={<RouteLoadingFallback />}>
                <HRRoutes />
              </Suspense>
            </PermissionGuard>
          } />
          <Route path="/warehouse/*" element={
            <PermissionGuard resource="warehouse" action="view" redirectTo="/dashboard">
              <Suspense fallback={<RouteLoadingFallback />}>
                <WarehouseRoutes />
              </Suspense>
            </PermissionGuard>
          } />
          <Route path="/support/*" element={
            <PermissionGuard resource="support" action="view" redirectTo="/dashboard">
              <Suspense fallback={<RouteLoadingFallback />}>
                <SupportRoutes />
              </Suspense>
            </PermissionGuard>
          } />
          <Route path="/reporting/*" element={
            <PermissionGuard resource="reporting" action="view" redirectTo="/dashboard">
              <Suspense fallback={<RouteLoadingFallback />}>
                <ReportingRoutes />
              </Suspense>
            </PermissionGuard>
          } />
          <Route path="/branches/*" element={
            <PermissionGuard resource="branches" action="view" redirectTo="/dashboard">
              <Suspense fallback={<RouteLoadingFallback />}>
                <BranchesRoutes />
              </Suspense>
            </PermissionGuard>
          } />
          <Route path="/users" element={
            <PermissionGuard resource="users" action="view" redirectTo="/dashboard">
              <Suspense fallback={<RouteLoadingFallback />}>
                <UsersPage />
              </Suspense>
            </PermissionGuard>
          } />
          <Route path="/roles" element={
            <PermissionGuard resource="groups" action="view" redirectTo="/dashboard">
              <Suspense fallback={<RouteLoadingFallback />}>
                <GroupsPage />
              </Suspense>
            </PermissionGuard>
          } />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
    </Box>
  );
}

export default App;

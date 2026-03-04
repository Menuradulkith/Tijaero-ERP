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
            <Suspense fallback={<RouteLoadingFallback />}>
              <SalesRoutes />
            </Suspense>
          } />
          <Route path="/inventory/*" element={
            <Suspense fallback={<RouteLoadingFallback />}>
              <InventoryRoutes />
            </Suspense>
          } />
          <Route path="/purchasing/*" element={
            <Suspense fallback={<RouteLoadingFallback />}>
              <PurchasingRoutes />
            </Suspense>
          } />
          <Route path="/finance/*" element={
            <Suspense fallback={<RouteLoadingFallback />}>
              <FinanceRoutes />
            </Suspense>
          } />
          <Route path="/hr/*" element={
            <Suspense fallback={<RouteLoadingFallback />}>
              <HRRoutes />
            </Suspense>
          } />
          <Route path="/warehouse/*" element={
            <Suspense fallback={<RouteLoadingFallback />}>
              <WarehouseRoutes />
            </Suspense>
          } />
          <Route path="/support/*" element={
            <Suspense fallback={<RouteLoadingFallback />}>
              <SupportRoutes />
            </Suspense>
          } />
          <Route path="/reporting/*" element={
            <Suspense fallback={<RouteLoadingFallback />}>
              <ReportingRoutes />
            </Suspense>
          } />
          <Route path="/branches/*" element={
            <Suspense fallback={<RouteLoadingFallback />}>
              <BranchesRoutes />
            </Suspense>
          } />
          <Route path="/users" element={
            <Suspense fallback={<RouteLoadingFallback />}>
              <UsersPage />
            </Suspense>
          } />
          <Route path="/roles" element={
            <Suspense fallback={<RouteLoadingFallback />}>
              <GroupsPage />
            </Suspense>
          } />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
    </Box>
  );
}

export default App;

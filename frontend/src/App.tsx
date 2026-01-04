import { Routes, Route, Navigate } from "react-router-dom";
import { Box } from "@mui/material";
import MainLayout from "./app/layout/MainLayout";
import LoginPage from "./auth/pages/LoginPage";
import ProtectedRoute from "./auth/components/ProtectedRoute";
import DashboardPage from "./app/pages/DashboardPage";
import CustomersRoutes from "./features/customers/routes";
import SalesRoutes from "./features/sales/routes";
import InventoryRoutes from "./features/inventory/routes";
import PurchasingRoutes from "./features/purchasing/routes";
import FinanceRoutes from "./features/finance/routes";
import HRRoutes from "./features/hr/routes";
import WarehouseRoutes from "./features/warehouse/routes";
import SupportRoutes from "./features/support/routes";
import ReportingRoutes from "./features/reporting/routes";
import BranchesRoutes from "./modules/branches/routes";
import UsersPage from "./modules/users/pages/UsersPage";
import GroupsPage from "./modules/groups/pages/GroupsPage";

function App() {
  return (
    <Box
      sx={{
        display: "flex",
        minHeight: "100vh",
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
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/customers/*" element={<CustomersRoutes />} />
          <Route path="/sales/*" element={<SalesRoutes />} />
          <Route path="/inventory/*" element={<InventoryRoutes />} />
          <Route path="/purchasing/*" element={<PurchasingRoutes />} />
          <Route path="/finance/*" element={<FinanceRoutes />} />
          <Route path="/hr/*" element={<HRRoutes />} />
          <Route path="/warehouse/*" element={<WarehouseRoutes />} />
          <Route path="/support/*" element={<SupportRoutes />} />
          <Route path="/reporting/*" element={<ReportingRoutes />} />
          <Route path="/branches/*" element={<BranchesRoutes />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/roles" element={<GroupsPage />} />
        </Route>
      </Routes>
    </Box>
  );
}

export default App;

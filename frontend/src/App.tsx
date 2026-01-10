import { Box } from "@mui/material";
import { Navigate, Route, Routes } from "react-router-dom";
import MainLayout from "./app/layout/MainLayout";
import DashboardPage from "./app/pages/DashboardPage";
import CustomersRoutes from "./modules/customers/routes";
import SalesRoutes from "./modules/sales/routes";
import InventoryRoutes from "./modules/inventory/routes";
import PurchasingRoutes from "./modules/purchasing/routes";
import FinanceRoutes from "./modules/finance/routes";
import HRRoutes from "./modules/hr/routes";
import WarehouseRoutes from "./modules/warehouse/routes";
import SupportRoutes from "./modules/support/routes";
import ReportingRoutes from "./modules/reporting/routes";
import ProtectedRoute from "./auth/components/ProtectedRoute";
import LoginPage from "./auth/pages/LoginPage";
import BranchesRoutes from "./modules/branches/routes";
import FinanceRoutes from "./modules/finance/routes";
import GroupsPage from "./modules/groups/pages/GroupsPage";
import HRRoutes from "./modules/hr/routes";
import InventoryRoutes from "./modules/inventory/routes";
import PurchasingRoutes from "./modules/purchasing/routes";
import ReportingRoutes from "./modules/reporting/routes";
import SalesRoutes from "./modules/sales/routes";
import SupportRoutes from "./modules/support/routes";
import UsersPage from "./modules/users/pages/UsersPage";
import WarehouseRoutes from "./modules/warehouse/routes";

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

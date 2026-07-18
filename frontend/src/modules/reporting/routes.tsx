import { Navigate, Route, Routes } from "react-router-dom";
import ProtectedRoute from "@/auth/components/ProtectedRoute";
import ReportingDashboard from "./pages/ReportingDashboard";
import SalesReportPage from "./pages/SalesReportPage";
import FinanceReportPage from "./pages/FinanceReportPage";
import InventoryReportPage from "./pages/InventoryReportPage";
import HRReportPage from "./pages/HRReportPage";
import WarehouseReportPage from "./pages/WarehouseReportPage";
import SupportReportPage from "./pages/SupportReportPage";
import BranchSummaryPage from "./pages/BranchSummaryPage";

export default function ReportingRoutes() {
  return (
    <Routes>
      <Route index element={<ProtectedRoute resource="reporting_dashboard" action="view"><ReportingDashboard /></ProtectedRoute>} />
      <Route path="sales" element={<ProtectedRoute resource="reporting_sales" action="view"><SalesReportPage /></ProtectedRoute>} />
      <Route path="finance" element={<ProtectedRoute resource="reporting_finance" action="view"><FinanceReportPage /></ProtectedRoute>} />
      <Route path="inventory" element={<ProtectedRoute resource="reporting_inventory" action="view"><InventoryReportPage /></ProtectedRoute>} />
      <Route path="hr" element={<ProtectedRoute resource="reporting_hr" action="view"><HRReportPage /></ProtectedRoute>} />
      <Route path="warehouse" element={<ProtectedRoute resource="reporting_warehouse" action="view"><WarehouseReportPage /></ProtectedRoute>} />
      <Route path="support" element={<ProtectedRoute resource="reporting_support" action="view"><SupportReportPage /></ProtectedRoute>} />
      <Route path="branch-summary" element={<ProtectedRoute resource="reporting_branch_summary" action="view"><BranchSummaryPage /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="." replace />} />
    </Routes>
  );
}

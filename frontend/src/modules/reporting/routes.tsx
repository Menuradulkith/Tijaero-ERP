import { Navigate, Route, Routes } from "react-router-dom";
import ReportingDashboard from "./pages/ReportingDashboard";
import SalesReportPage from "./pages/SalesReportPage";
import FinanceReportPage from "./pages/FinanceReportPage";
import InventoryReportPage from "./pages/InventoryReportPage";
import HRReportPage from "./pages/HRReportPage";
import WarehouseReportPage from "./pages/WarehouseReportPage";
import SupportReportPage from "./pages/SupportReportPage";

export default function ReportingRoutes() {
  return (
    <Routes>
      <Route index element={<ReportingDashboard />} />
      <Route path="sales" element={<SalesReportPage />} />
      <Route path="finance" element={<FinanceReportPage />} />
      <Route path="inventory" element={<InventoryReportPage />} />
      <Route path="hr" element={<HRReportPage />} />
      <Route path="warehouse" element={<WarehouseReportPage />} />
      <Route path="support" element={<SupportReportPage />} />
      <Route path="*" element={<Navigate to="." replace />} />
    </Routes>
  );
}

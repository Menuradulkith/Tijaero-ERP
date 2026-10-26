import { Navigate, Route, Routes } from "react-router-dom";
import ProtectedRoute from "@/auth/components/ProtectedRoute";
import ReportCenterPage from "./pages/ReportCenterPage";
import BranchSummaryPage from "./pages/BranchSummaryPage";

// The old per-module report pages now live in the Report Center; keep their links working.
const MOVED: Record<string, string> = {
  sales: "sales.summary",
  finance: "finance.summary",
  inventory: "inventory.summary",
  hr: "hr.payroll_summary",
  warehouse: "warehouse.summary",
  support: "support.summary",
};

export default function ReportingRoutes() {
  return (
    <Routes>
      <Route index element={<ProtectedRoute resource="reporting_dashboard" action="view"><ReportCenterPage /></ProtectedRoute>} />
      {Object.entries(MOVED).map(([path, key]) => (
        <Route key={path} path={path} element={<Navigate to={`/reporting?report=${key}`} replace />} />
      ))}
      <Route path="branch-summary" element={<ProtectedRoute resource="reporting_branch_summary" action="view"><BranchSummaryPage /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="." replace />} />
    </Routes>
  );
}

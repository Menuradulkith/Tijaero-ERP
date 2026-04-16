import { Navigate, Route, Routes } from "react-router-dom";
import ProtectedRoute from "@/auth/components/ProtectedRoute";
import HRDashboard from "./pages/HRDashboard";
import PayrollPage from "./pages/PayrollPage";
import PayrollProcessingPage from "./pages/PayrollProcessingPage";
import PayrollApprovalsPage from "./pages/PayrollApprovalsPage";
import PromotionsPage from "./pages/PromotionsPage";
import SalaryProfilesPage from "./pages/SalaryProfilesPage";
import ReimbursementsPage from "./pages/ReimbursementsPage";
import ReimbursementApprovalsPage from "./pages/ReimbursementApprovalsPage";
import DeductionsPage from "./pages/DeductionsPage";
import EmployeeAssetsPage from "./pages/EmployeeAssetsPage";
import SalesCommissionsPage from "./pages/SalesCommissionsPage";

export default function HRRoutes() {
  return (
    <Routes>
      <Route index element={<ProtectedRoute resource="hr_dashboard" action="view"><HRDashboard /></ProtectedRoute>} />
      <Route path="payroll" element={<ProtectedRoute resource="payroll" action="view"><PayrollPage /></ProtectedRoute>} />
      <Route path="payroll-processing" element={<ProtectedRoute resource="payroll_processing" action="view"><PayrollProcessingPage /></ProtectedRoute>} />
      <Route path="payroll-approvals" element={<ProtectedRoute resource="payroll_approvals" action="view"><PayrollApprovalsPage /></ProtectedRoute>} />
      <Route path="sales-commissions" element={<ProtectedRoute resource="hr_sales_commissions" action="view"><SalesCommissionsPage /></ProtectedRoute>} />
      <Route path="promotions" element={<ProtectedRoute resource="promotions" action="view"><PromotionsPage /></ProtectedRoute>} />
      <Route path="salary-profiles" element={<ProtectedRoute resource="salary_profiles" action="view"><SalaryProfilesPage /></ProtectedRoute>} />
      <Route path="reimbursements" element={<ProtectedRoute resource="reimbursements" action="view"><ReimbursementsPage /></ProtectedRoute>} />
      <Route path="reimbursement-approvals" element={<ProtectedRoute resource="reimbursement_approvals" action="view"><ReimbursementApprovalsPage /></ProtectedRoute>} />
      <Route path="deductions" element={<ProtectedRoute resource="deductions" action="view"><DeductionsPage /></ProtectedRoute>} />
      <Route path="assets" element={<ProtectedRoute resource="hr_assets" action="view"><EmployeeAssetsPage /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="." replace />} />
    </Routes>
  );
}

import { Routes, Route } from "react-router-dom";
import HRDashboard from "./pages/HRDashboard";
import PayrollPage from "./pages/PayrollPage";
import PayrollProcessingPage from "./pages/PayrollProcessingPage";
import PromotionsPage from "./pages/PromotionsPage";
import SalaryProfilesPage from "./pages/SalaryProfilesPage";
import ReimbursementsPage from "./pages/ReimbursementsPage";
import DeductionsPage from "./pages/DeductionsPage";
import EmployeeAssetsPage from "./pages/EmployeeAssetsPage";
import SalesCommissionsPage from "./pages/SalesCommissionsPage";

export default function HRRoutes() {
  return (
    <Routes>
      <Route index element={<HRDashboard />} />
      <Route path="payroll" element={<PayrollPage />} />
      <Route path="payroll-processing" element={<PayrollProcessingPage />} />
      <Route path="sales-commissions" element={<SalesCommissionsPage />} />
      <Route path="promotions" element={<PromotionsPage />} />
      <Route path="salary-profiles" element={<SalaryProfilesPage />} />
      <Route path="reimbursements" element={<ReimbursementsPage />} />
      <Route path="deductions" element={<DeductionsPage />} />
      <Route path="assets" element={<EmployeeAssetsPage />} />
    </Routes>
  );
}

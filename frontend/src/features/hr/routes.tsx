import { Routes, Route } from "react-router-dom";
import HRDashboard from "./pages/HRDashboard";
import PayrollPage from "./pages/PayrollPage";
import PromotionsPage from "./pages/PromotionsPage";
import SalaryProfilesPage from "./pages/SalaryProfilesPage";
import ReimbursementsPage from "./pages/ReimbursementsPage";
import DeductionsPage from "./pages/DeductionsPage";
import EmployeeAssetsPage from "./pages/EmployeeAssetsPage";

export default function HRRoutes() {
  return (
    <Routes>
      <Route index element={<HRDashboard />} />
      <Route path="payroll" element={<PayrollPage />} />
      <Route path="promotions" element={<PromotionsPage />} />
      <Route path="salary-profiles" element={<SalaryProfilesPage />} />
      <Route path="reimbursements" element={<ReimbursementsPage />} />
      <Route path="deductions" element={<DeductionsPage />} />
      <Route path="assets" element={<EmployeeAssetsPage />} />
    </Routes>
  );
}

import AgentCommissionsPage from "@/modules/sales/pages/AgentCommissionsPage";
import CommissionApprovalsPage from "@/modules/sales/pages/CommissionApprovalsPage";
import CouponsPage from "@/modules/sales/pages/CouponsPage";
import VouchersPage from "@/modules/sales/pages/VouchersPage";
import CustomersPage from "@/modules/sales/pages/CustomersPage";
import QuotationsPage from "@/modules/sales/pages/QuotationsPage";
import SaleReturnsPage from "@/modules/sales/pages/SaleReturnsPage";
import SaleReturnApprovalsPage from "@/modules/sales/pages/SaleReturnApprovalsPage";
import SalesApprovalsPage from "@/modules/sales/pages/SalesApprovalsPage";
import SalesDashboard from "@/modules/sales/pages/SalesDashboard";
import SalesOrderApprovalsPage from "@/modules/sales/pages/SalesOrderApprovalsPage";
import SalesPage from "@/modules/sales/pages/SalesPage";
import SalesSettingsPage from "@/modules/sales/pages/SalesSettingsPage";
import SalesTrackPage from "@/modules/sales/pages/SalesTrackPage";
import { Route, Routes } from "react-router-dom";

export default function SalesRoutes() {
  return (
    <Routes>
      <Route index element={<SalesPage />} />
      <Route path="orders" element={<SalesPage />} />
      <Route path="quotations" element={<QuotationsPage />} />
      <Route path="proforma" element={<QuotationsPage />} />
      <Route path="returns" element={<SaleReturnsPage />} />
      <Route path="track" element={<SalesTrackPage />} />
      <Route path="dashboard" element={<SalesDashboard />} />
      <Route path="customers" element={<CustomersPage />} />
      <Route path="coupons" element={<CouponsPage />} />
      <Route path="vouchers" element={<VouchersPage />} />
      <Route path="agent-commissions" element={<AgentCommissionsPage />} />
      <Route path="settings/*" element={<SalesSettingsPage />} />
      {/* Approvals - parent hub and sub-routes */}
      <Route path="approvals" element={<SalesApprovalsPage />} />
      <Route path="approvals/so-approvals" element={<SalesOrderApprovalsPage />} />
      <Route path="approvals/return-approvals" element={<SaleReturnApprovalsPage />} />
      <Route path="approvals/commission-approvals" element={<CommissionApprovalsPage />} />
      {/* Legacy routes for backward compatibility */}
      <Route path="return-approvals" element={<SaleReturnApprovalsPage />} />
      <Route path="commission-approvals" element={<CommissionApprovalsPage />} />
    </Routes>
  );
}


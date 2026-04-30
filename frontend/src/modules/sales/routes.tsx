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
import SalesTrackPage from "@/modules/sales/pages/SalesTrackPage";
import ProtectedRoute from "@/auth/components/ProtectedRoute";
import { Navigate, Route, Routes } from "react-router-dom";

export default function SalesRoutes() {
  return (
    <Routes>
      <Route index element={<ProtectedRoute resource="sales_orders" action="view"><SalesPage /></ProtectedRoute>} />
      <Route path="orders" element={<ProtectedRoute resource="sales_orders" action="view"><SalesPage /></ProtectedRoute>} />
      <Route path="quotations" element={<ProtectedRoute resource="quotations" action="view"><QuotationsPage /></ProtectedRoute>} />
      <Route path="proforma" element={<ProtectedRoute resource="proforma_invoices" action="view"><QuotationsPage /></ProtectedRoute>} />
      <Route path="returns" element={<ProtectedRoute resource="sales_returns" action="view"><SaleReturnsPage /></ProtectedRoute>} />
      <Route path="track" element={<ProtectedRoute resource="sales_track" action="view"><SalesTrackPage /></ProtectedRoute>} />
      <Route path="dashboard" element={<ProtectedRoute resource="sales_dashboard" action="view"><SalesDashboard /></ProtectedRoute>} />
      <Route path="customers" element={<ProtectedRoute resource="customers" action="view"><CustomersPage /></ProtectedRoute>} />
      <Route path="coupons" element={<ProtectedRoute resource="coupons" action="view"><CouponsPage /></ProtectedRoute>} />
      <Route path="vouchers" element={<ProtectedRoute resource="gift_vouchers" action="view"><VouchersPage /></ProtectedRoute>} />
      <Route path="agent-commissions" element={<ProtectedRoute resource="agent_commissions" action="view"><AgentCommissionsPage /></ProtectedRoute>} />
      {/* Approvals - parent hub and sub-routes */}
      <Route path="approvals" element={<SalesApprovalsPage />} />
      <Route path="approvals/so-approvals" element={<ProtectedRoute resource="so_approvals" action="view"><SalesOrderApprovalsPage /></ProtectedRoute>} />
      <Route path="approvals/return-approvals" element={<ProtectedRoute resource="sales_return_approvals" action="view"><SaleReturnApprovalsPage /></ProtectedRoute>} />
      <Route path="approvals/commission-approvals" element={<ProtectedRoute resource="commission_approvals" action="view"><CommissionApprovalsPage /></ProtectedRoute>} />
      {/* Legacy routes for backward compatibility */}
      <Route path="return-approvals" element={<ProtectedRoute resource="sales_return_approvals" action="view"><SaleReturnApprovalsPage /></ProtectedRoute>} />
      <Route path="commission-approvals" element={<ProtectedRoute resource="commission_approvals" action="view"><CommissionApprovalsPage /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="." replace />} />
    </Routes>
  );
}


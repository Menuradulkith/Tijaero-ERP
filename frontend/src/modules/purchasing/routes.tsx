import { Routes, Route, Navigate } from "react-router-dom";
import SuppliersPage from "./pages/SuppliersPage";
import PurchaseOrdersPage from "./pages/PurchaseOrdersPage";
import PurchaseReturnsPage from "./pages/PurchaseReturnsPage";
import GoodReceivedNotesPage from "./pages/GoodReceivedNotesPage";
import PurchasingDashboard from "./pages/PurchasingDashboard";
// CreditSettlementPage is kept but redirected to unified SupplierPaymentsPage
// import CreditSettlementPage from "./pages/CreditSettlementPage";
import POApprovalsPage from "./pages/POApprovalsPage";
import PurchaseReturnApprovalsPage from "./pages/PurchaseReturnApprovalsPage";
import SupplierPaymentsPage from "./pages/SupplierPaymentsPage";
import PaymentApprovalsPage from "./pages/PaymentApprovalsPage";

export default function PurchasingRoutes() {
  return (
    <Routes>
      <Route index element={<PurchasingDashboard />} />
      <Route path="suppliers" element={<SuppliersPage />} />
      <Route path="orders" element={<PurchaseOrdersPage />} />
      <Route path="approvals" element={<POApprovalsPage />} />
      <Route path="grn" element={<GoodReceivedNotesPage />} />
      <Route path="returns" element={<PurchaseReturnsPage />} />
      <Route path="return-approvals" element={<PurchaseReturnApprovalsPage />} />
      {/* Redirect old settlements route to unified payments page */}
      <Route path="settlements" element={<Navigate to="/purchasing/payments" replace />} />
      <Route path="payments" element={<SupplierPaymentsPage />} />
      <Route path="payment-approvals" element={<PaymentApprovalsPage />} />
    </Routes>
  );
}

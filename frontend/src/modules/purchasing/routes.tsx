import { Routes, Route, Navigate } from "react-router-dom";
import SuppliersPage from "./pages/SuppliersPage";
import PurchaseOrdersPage from "./pages/PurchaseOrdersPage";
import PurchaseReturnsPage from "./pages/PurchaseReturnsPage";
import GoodReceivedNotesPage from "./pages/GoodReceivedNotesPage";
import PurchaseInvoicesPage from "./pages/PurchaseInvoicesPage";
import PurchasingDashboard from "./pages/PurchasingDashboard";
import POApprovalsPage from "./pages/POApprovalsPage";
import PurchaseReturnApprovalsPage from "./pages/PurchaseReturnApprovalsPage";
import PurchasingApprovalsPage from "./pages/PurchasingApprovalsPage";
import ProtectedRoute from "@/auth/components/ProtectedRoute";

export default function PurchasingRoutes() {
  return (
    <Routes>
      <Route index element={<ProtectedRoute resource="purchasing_dashboard" action="view"><PurchasingDashboard /></ProtectedRoute>} />
      <Route path="suppliers" element={<ProtectedRoute resource="suppliers" action="view"><SuppliersPage /></ProtectedRoute>} />
      <Route path="orders" element={<ProtectedRoute resource="purchase_orders" action="view"><PurchaseOrdersPage /></ProtectedRoute>} />
      <Route path="grn" element={<ProtectedRoute resource="grn" action="view"><GoodReceivedNotesPage /></ProtectedRoute>} />
      <Route path="invoices" element={<ProtectedRoute resource="purchase_orders" action="view"><PurchaseInvoicesPage /></ProtectedRoute>} />
      <Route path="returns" element={<ProtectedRoute resource="purchase_returns" action="view"><PurchaseReturnsPage /></ProtectedRoute>} />
      {/* Approvals - parent hub and sub-routes */}
      <Route path="approvals" element={<PurchasingApprovalsPage />} />
      <Route path="approvals/po-approvals" element={<ProtectedRoute resource="po_approvals" action="view"><POApprovalsPage /></ProtectedRoute>} />
      <Route path="approvals/return-approvals" element={<ProtectedRoute resource="purchase_return_approvals" action="view"><PurchaseReturnApprovalsPage /></ProtectedRoute>} />
      {/* Legacy routes for backward compatibility */}
      <Route path="return-approvals" element={<ProtectedRoute resource="purchase_return_approvals" action="view"><PurchaseReturnApprovalsPage /></ProtectedRoute>} />
      {/* Redirect old routes to finance module */}
      <Route path="settlements" element={<Navigate to="/finance/supplier-payments" replace />} />
      <Route path="payments" element={<Navigate to="/finance/supplier-payments" replace />} />
      <Route path="payment-approvals" element={<Navigate to="/finance/payment-approvals" replace />} />
      <Route path="*" element={<Navigate to="." replace />} />
    </Routes>
  );
}

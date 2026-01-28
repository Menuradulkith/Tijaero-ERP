import { Routes, Route, Navigate } from "react-router-dom";
import SuppliersPage from "./pages/SuppliersPage";
import PurchaseOrdersPage from "./pages/PurchaseOrdersPage";
import PurchaseReturnsPage from "./pages/PurchaseReturnsPage";
import GoodReceivedNotesPage from "./pages/GoodReceivedNotesPage";
import PurchasingDashboard from "./pages/PurchasingDashboard";
import POApprovalsPage from "./pages/POApprovalsPage";
import PurchaseReturnApprovalsPage from "./pages/PurchaseReturnApprovalsPage";

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
      {/* Redirect old routes to finance module */}
      <Route path="settlements" element={<Navigate to="/finance/supplier-payments" replace />} />
      <Route path="payments" element={<Navigate to="/finance/supplier-payments" replace />} />
      <Route path="payment-approvals" element={<Navigate to="/finance/payment-approvals" replace />} />
    </Routes>
  );
}

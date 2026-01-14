import { Routes, Route } from "react-router-dom";
import SuppliersPage from "./pages/SuppliersPage";
import PurchaseOrdersPage from "./pages/PurchaseOrdersPage";
import PurchaseReturnsPage from "./pages/PurchaseReturnsPage";
import GoodReceivedNotesPage from "./pages/GoodReceivedNotesPage";
import PurchasingDashboard from "./pages/PurchasingDashboard";
import CreditSettlementPage from "./pages/CreditSettlementPage";
import POApprovalsPage from "./pages/POApprovalsPage";
import PurchaseReturnApprovalsPage from "./pages/PurchaseReturnApprovalsPage";
import SupplierPaymentsPage from "./pages/SupplierPaymentsPage";

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
      <Route path="settlements" element={<CreditSettlementPage />} />
      <Route path="payments" element={<SupplierPaymentsPage />} />
    </Routes>
  );
}

import { Routes, Route } from "react-router-dom";
import SuppliersPage from "./pages/SuppliersPage.tsx";
import PurchaseOrdersPage from "./pages/PurchaseOrdersPage.tsx";
import PurchaseReturnsPage from "./pages/PurchaseReturnsPage.tsx";
import GoodReceivedNotesPage from "./pages/GoodReceivedNotesPage.tsx";
import PurchasingDashboard from "./pages/PurchasingDashboard.tsx";
import CreditSettlementPage from "./pages/CreditSettlementPage.tsx";

export default function PurchasingRoutes() {
  return (
    <Routes>
      <Route index element={<PurchasingDashboard />} />
      <Route path="suppliers" element={<SuppliersPage />} />
      <Route path="orders" element={<PurchaseOrdersPage />} />
      <Route path="grn" element={<GoodReceivedNotesPage />} />
      <Route path="returns" element={<PurchaseReturnsPage />} />
      <Route path="settlements" element={<CreditSettlementPage />} />
    </Routes>
  );
}

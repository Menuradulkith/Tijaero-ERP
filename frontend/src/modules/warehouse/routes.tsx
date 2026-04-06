import { Navigate, Route, Routes } from "react-router-dom";
import SalesStockDashboard from "./pages/SalesStockDashboard";
import SalesTrackPage from "./pages/SalesTrackPage";
import StockTransferNotesPage from "./pages/StockTransferNotesPage";
import ItemTransferNotesPage from "./pages/ItemTransferNotesPage";
import ItemTransferNoteApprovalsPage from "./pages/ItemTransferNoteApprovalsPage";
import ReceiveNotesPage from "./pages/ReceiveNotesPage";
import CompanyAssetsDashboard from "./pages/CompanyAssetsDashboard";

export default function WarehouseRoutes() {
  return (
    <Routes>
      <Route index element={<SalesStockDashboard />} />
      <Route path="company-assets" element={<CompanyAssetsDashboard />} />
      <Route path="sales-track" element={<SalesTrackPage />} />
      <Route path="transfer-notes" element={<StockTransferNotesPage />} />
      <Route path="item-transfer-notes" element={<ItemTransferNotesPage />} />
      <Route path="itn-approvals" element={<ItemTransferNoteApprovalsPage />} />
      <Route path="receive-notes" element={<ReceiveNotesPage />} />
      <Route path="*" element={<Navigate to="." replace />} />
    </Routes>
  );
}

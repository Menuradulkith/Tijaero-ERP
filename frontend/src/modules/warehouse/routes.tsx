import { Navigate, Route, Routes } from "react-router-dom";
import ProtectedRoute from "@/auth/components/ProtectedRoute";
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
      <Route index element={<ProtectedRoute resource="sales_stock" action="view"><SalesStockDashboard /></ProtectedRoute>} />
      <Route path="company-assets" element={<ProtectedRoute resource="company_assets" action="view"><CompanyAssetsDashboard /></ProtectedRoute>} />
      <Route path="sales-track" element={<ProtectedRoute resource="warehouse_sales_track" action="view"><SalesTrackPage /></ProtectedRoute>} />
      <Route path="transfer-notes" element={<ProtectedRoute resource="item_transfer_notes" action="view"><StockTransferNotesPage /></ProtectedRoute>} />
      <Route path="item-transfer-notes" element={<ProtectedRoute resource="item_transfer_notes" action="view"><ItemTransferNotesPage /></ProtectedRoute>} />
      <Route path="itn-approvals" element={<ProtectedRoute resource="itn_approvals" action="view"><ItemTransferNoteApprovalsPage /></ProtectedRoute>} />
      <Route path="receive-notes" element={<ProtectedRoute resource="receive_notes" action="view"><ReceiveNotesPage /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="." replace />} />
    </Routes>
  );
}

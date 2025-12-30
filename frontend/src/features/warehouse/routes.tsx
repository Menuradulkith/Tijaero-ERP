import { Routes, Route } from "react-router-dom";
import WarehouseDashboard from "./pages/WarehouseDashboard";
import TransferNotesPage from "./pages/TransferNotesPage";
import ReceiveNotesPage from "./pages/ReceiveNotesPage";
import ApprovalsPage from "./pages/ApprovalsPage";
import ReportsPage from "./pages/ReportsPage";

export default function WarehouseRoutes() {
  return (
    <Routes>
      <Route index element={<WarehouseDashboard />} />
      <Route path="transfer-notes" element={<TransferNotesPage />} />
      <Route path="receive-notes" element={<ReceiveNotesPage />} />
      <Route path="approvals" element={<ApprovalsPage />} />
      <Route path="reports" element={<ReportsPage />} />
    </Routes>
  );
}

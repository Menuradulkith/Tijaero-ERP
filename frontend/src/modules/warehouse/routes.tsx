import { Routes, Route } from "react-router-dom";
import SalesStockDashboard from "./pages/SalesStockDashboard";
import SalesTrackPage from "./pages/SalesTrackPage";
import StockTransferNotesPage from "./pages/StockTransferNotesPage";

export default function WarehouseRoutes() {
  return (
    <Routes>
      <Route index element={<SalesStockDashboard />} />
      <Route path="sales-track" element={<SalesTrackPage />} />
      <Route path="transfer-notes" element={<StockTransferNotesPage />} />
    </Routes>
  );
}

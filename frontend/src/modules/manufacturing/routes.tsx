import { Routes, Route, Navigate } from "react-router-dom";
import ManufacturingDashboard from "./pages/ManufacturingDashboard";
import ProductionOrdersPage from "./pages/ProductionOrdersPage";
import JobCardsPage from "./pages/JobCardsPage";
import MaterialRequirementsPage from "./pages/MaterialRequirementsPage";
import ReorderRulesPage from "./pages/ReorderRulesPage";
import BOMsPage from "./pages/BOMsPage";
import WorkCentersPage from "./pages/WorkCentersPage";
import ProtectedRoute from "@/auth/components/ProtectedRoute";

export default function ManufacturingRoutes() {
  return (
    <Routes>
      <Route index element={<ProtectedRoute resource="manufacturing_dashboard" action="view"><ManufacturingDashboard /></ProtectedRoute>} />
      <Route path="orders" element={<ProtectedRoute resource="production_orders" action="view"><ProductionOrdersPage /></ProtectedRoute>} />
      <Route path="job-cards" element={<ProtectedRoute resource="shop_floor" action="view"><JobCardsPage /></ProtectedRoute>} />
      <Route path="mrp" element={<ProtectedRoute resource="mrp" action="view"><MaterialRequirementsPage /></ProtectedRoute>} />
      <Route path="reorder-rules" element={<ProtectedRoute resource="mrp" action="view"><ReorderRulesPage /></ProtectedRoute>} />
      <Route path="boms" element={<ProtectedRoute resource="boms" action="view"><BOMsPage /></ProtectedRoute>} />
      <Route path="work-centers" element={<ProtectedRoute resource="work_centers" action="view"><WorkCentersPage /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="." replace />} />
    </Routes>
  );
}

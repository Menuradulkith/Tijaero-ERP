import { Routes, Route, Navigate } from "react-router-dom";
import ProductsPage from "@/modules/inventory/pages/ProductsPage";
import ProtectedRoute from "@/auth/components/ProtectedRoute";

export default function InventoryRoutes() {
  return (
    <Routes>
      <Route index element={<ProtectedRoute resource="products" action="view"><ProductsPage view="products" hideTabs /></ProtectedRoute>} />
      <Route path="categories" element={<ProtectedRoute resource="categories" action="view"><ProductsPage view="categories" hideTabs /></ProtectedRoute>} />
      <Route path="brands" element={<ProtectedRoute resource="brands" action="view"><ProductsPage view="brands" hideTabs /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="." replace />} />
    </Routes>
  );
}

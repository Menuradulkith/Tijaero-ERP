import { Navigate, Route, Routes } from "react-router-dom";
import ProtectedRoute from "@/auth/components/ProtectedRoute";
import ItemCatalogPage from "@/modules/materials/pages/ItemCatalogPage";

export default function MaterialsRoutes() {
  return (
    <Routes>
      <Route index element={<Navigate to="item-catalog" replace />} />
      <Route
        path="item-catalog"
        element={<ProtectedRoute resource="materials" action="view"><ItemCatalogPage view="products" hideTabs /></ProtectedRoute>}
      />
      {/* Material categories are the Item Catalog's own; brands are shared with the product catalog. */}
      <Route
        path="categories"
        element={<ProtectedRoute resource="materials" action="view"><ItemCatalogPage view="categories" hideTabs /></ProtectedRoute>}
      />
      <Route
        path="brands"
        element={<ProtectedRoute resource="brands" action="view"><ItemCatalogPage view="brands" hideTabs /></ProtectedRoute>}
      />
      <Route path="*" element={<Navigate to="item-catalog" replace />} />
    </Routes>
  );
}

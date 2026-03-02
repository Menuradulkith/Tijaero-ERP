import { Routes, Route, Navigate } from "react-router-dom";
import ProductsPage from "@/modules/inventory/pages/ProductsPage";

export default function InventoryRoutes() {
  return (
    <Routes>
      <Route index element={<ProductsPage view="products" hideTabs />} />
      <Route path="categories" element={<ProductsPage view="categories" hideTabs />} />
      <Route path="brands" element={<ProductsPage view="brands" hideTabs />} />
      <Route path="*" element={<Navigate to="." replace />} />
    </Routes>
  );
}

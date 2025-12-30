import { Routes, Route } from "react-router-dom";
import ProductsPage from "@/modules/inventory/pages/ProductsPage";

export default function InventoryRoutes() {
  return (
    <Routes>
      <Route index element={<ProductsPage />} />
    </Routes>
  );
}

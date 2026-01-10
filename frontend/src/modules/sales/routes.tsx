import { Routes, Route } from "react-router-dom";
import SalesPage from "@/modules/sales/pages/SalesPage";
import SaleReturnsPage from "@/modules/sales/pages/SaleReturnsPage";
import SalesDashboard from "@/modules/sales/pages/SalesDashboard";

export default function SalesRoutes() {
  return (
    <Routes>
      <Route index element={<SalesPage />} />
      <Route path="orders" element={<SalesPage />} />
      <Route path="returns" element={<SaleReturnsPage />} />
      <Route path="dashboard" element={<SalesDashboard />} />
    </Routes>
  );
}

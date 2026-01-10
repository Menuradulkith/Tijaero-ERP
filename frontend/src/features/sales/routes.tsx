import CustomersPage from "@/modules/sales/pages/CustomersPage";
import SaleReturnsPage from "@/modules/sales/pages/SaleReturnsPage";
import SalesDashboard from "@/modules/sales/pages/SalesDashboard";
import SalesPage from "@/modules/sales/pages/SalesPage";
import { Route, Routes } from "react-router-dom";

export default function SalesRoutes() {
  return (
    <Routes>
      <Route index element={<SalesPage />} />
      <Route path="orders" element={<SalesPage />} />
      <Route path="returns" element={<SaleReturnsPage />} />
      <Route path="dashboard" element={<SalesDashboard />} />
      <Route path="customers" element={<CustomersPage />} />
    </Routes>
  );
}

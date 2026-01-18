import CustomerPaymentDashboard from "@/modules/sales/pages/CustomerPaymentDashboard";
import CustomersPage from "@/modules/sales/pages/CustomersPage";
import QuotationsPage from "@/modules/sales/pages/QuotationsPage";
import SaleReturnsPage from "@/modules/sales/pages/SaleReturnsPage";
import SalesDashboard from "@/modules/sales/pages/SalesDashboard";
import SalesOrderApprovalsPage from "@/modules/sales/pages/SalesOrderApprovalsPage";
import SalesPage from "@/modules/sales/pages/SalesPage";
import { Route, Routes } from "react-router-dom";

export default function SalesRoutes() {
  return (
    <Routes>
      <Route index element={<SalesPage />} />
      <Route path="orders" element={<SalesPage />} />
      <Route path="quotations" element={<QuotationsPage />} />
      <Route path="proforma" element={<QuotationsPage />} />
      <Route path="returns" element={<SaleReturnsPage />} />
      <Route path="dashboard" element={<SalesDashboard />} />
      <Route path="customers" element={<CustomersPage />} />
      <Route path="approvals" element={<SalesOrderApprovalsPage />} />
      <Route path="payments" element={<CustomerPaymentDashboard />} />
    </Routes>
  );
}

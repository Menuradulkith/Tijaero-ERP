import { Routes, Route, Navigate } from "react-router-dom";
import CustomersPage from "@/modules/customers/pages/CustomersPage";

export default function CustomersRoutes() {
  return (
    <Routes>
      <Route index element={<CustomersPage />} />
      <Route path="*" element={<Navigate to="." replace />} />
    </Routes>
  );
}

import { Routes, Route } from "react-router-dom";
import CustomersPage from "@/modules/customers/pages/CustomersPage";

export default function CustomersRoutes() {
  return (
    <Routes>
      <Route index element={<CustomersPage />} />
    </Routes>
  );
}

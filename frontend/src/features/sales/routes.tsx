import { Routes, Route } from "react-router-dom";
import SalesPage from "@/modules/sales/pages/SalesPage";

export default function SalesRoutes() {
  return (
    <Routes>
      <Route index element={<SalesPage />} />
    </Routes>
  );
}

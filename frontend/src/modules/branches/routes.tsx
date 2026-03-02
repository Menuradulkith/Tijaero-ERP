import { Routes, Route, Navigate } from "react-router-dom";
import BranchesPage from "./pages/BranchesPage";

export default function BranchesRoutes() {
  return (
    <Routes>
      <Route index element={<BranchesPage />} />
      <Route path="*" element={<Navigate to="." replace />} />
    </Routes>
  );
}

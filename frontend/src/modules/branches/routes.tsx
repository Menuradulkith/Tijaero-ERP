import { Routes, Route } from "react-router-dom";
import BranchesPage from "./pages/BranchesPage";

export default function BranchesRoutes() {
  return (
    <Routes>
      <Route path="/" element={<BranchesPage />} />
    </Routes>
  );
}

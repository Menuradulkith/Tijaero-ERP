import { Routes, Route } from "react-router-dom";
import SupportDashboard from "./pages/SupportDashboard";
import SupportTicketsPage from "./pages/SupportTicketsPage";
import JobItemsPage from "./pages/JobItemsPage";
import CallLogsPage from "./pages/CallLogsPage";
import WarrantyClaimsPage from "./pages/WarrantyClaimsPage";

export default function SupportRoutes() {
  return (
    <Routes>
      <Route index element={<SupportDashboard />} />
      <Route path="tickets" element={<SupportTicketsPage />} />
      <Route path="job-items" element={<JobItemsPage />} />
      <Route path="call-logs" element={<CallLogsPage />} />
      <Route path="warranty-claims" element={<WarrantyClaimsPage />} />
    </Routes>
  );
}

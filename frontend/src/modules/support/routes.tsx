import { Navigate, Route, Routes } from "react-router-dom";
import SupportDashboard from "./pages/SupportDashboard";
import SupportTicketsPage from "./pages/SupportTicketsPage";
import JobItemsPage from "./pages/JobItemsPage";
import CallLogsPage from "./pages/CallLogsPage";
import WarrantyClaimsPage from "./pages/WarrantyClaimsPage";

import ProtectedRoute from "@/auth/components/ProtectedRoute";

export default function SupportRoutes() {
  return (
    <Routes>
      <Route index element={<ProtectedRoute resource="support_dashboard" action="view"><SupportDashboard /></ProtectedRoute>} />
      <Route path="tickets" element={<ProtectedRoute resource="support_tickets" action="view"><SupportTicketsPage /></ProtectedRoute>} />
      <Route path="job-items" element={<ProtectedRoute resource="job_items" action="view"><JobItemsPage /></ProtectedRoute>} />
      <Route path="call-logs" element={<ProtectedRoute resource="call_logs" action="view"><CallLogsPage /></ProtectedRoute>} />
      <Route path="warranty-claims" element={<ProtectedRoute resource="warranty_claims" action="view"><WarrantyClaimsPage /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="." replace />} />
    </Routes>
  );
}

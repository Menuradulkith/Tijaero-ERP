import { Routes, Route } from "react-router-dom";
import { Box } from "@mui/material";
import SalesPage from "@/modules/sales/pages/SalesPage";
import SaleReturnsPage from "@/modules/sales/pages/SaleReturnsPage";
import SalesDashboard from "@/modules/sales/pages/SalesDashboard";
import SalesNavTabs from "@/modules/sales/components/SalesNavTabs";

function SalesLayout({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <SalesNavTabs />
      <Box sx={{ flex: 1, overflow: "hidden" }}>{children}</Box>
    </Box>
  );
}

export default function SalesRoutes() {
  return (
    <Routes>
      <Route index element={<SalesLayout><SalesPage /></SalesLayout>} />
      <Route path="orders" element={<SalesLayout><SalesPage /></SalesLayout>} />
      <Route path="returns" element={<SalesLayout><SaleReturnsPage /></SalesLayout>} />
      <Route path="dashboard" element={<SalesLayout><SalesDashboard /></SalesLayout>} />
    </Routes>
  );
}

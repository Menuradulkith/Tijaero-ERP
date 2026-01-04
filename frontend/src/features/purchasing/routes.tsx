import { Routes, Route } from "react-router-dom";
import { Box, Tabs, Tab } from "@mui/material";
import { useNavigate, useLocation } from "react-router-dom";
import SuppliersPage from "./pages/SuppliersPage";
import PurchaseOrdersPage from "./pages/PurchaseOrdersPage";
import PurchaseReturnsPage from "./pages/PurchaseReturnsPage";
import GoodReceivedNotesPage from "./pages/GoodReceivedNotesPage";
import PurchasingDashboard from "./pages/PurchasingDashboard";
import CreditSettlementPage from "./pages/CreditSettlementPage";

function PurchasingNavTabs() {
  const navigate = useNavigate();
  const location = useLocation();

  const getTabValue = () => {
    const path = location.pathname;
    if (path.includes("/suppliers")) return 1;
    if (path.includes("/orders")) return 2;
    if (path.includes("/grn")) return 3;
    if (path.includes("/returns")) return 4;
    if (path.includes("/settlements")) return 5;
    return 0;
  };

  return (
    <Box sx={{ borderBottom: 1, borderColor: "divider", mb: 2 }}>
      <Tabs value={getTabValue()} onChange={(_, v) => {
        const paths = ["", "suppliers", "orders", "grn", "returns", "settlements"];
        navigate(`/purchasing/${paths[v]}`);
      }}>
        <Tab label="Dashboard" />
        <Tab label="Suppliers" />
        <Tab label="Purchase Orders" />
        <Tab label="Good Received Notes" />
        <Tab label="Purchase Returns" />
        <Tab label="Credit Settlements" />
      </Tabs>
    </Box>
  );
}

function PurchasingLayout({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <PurchasingNavTabs />
      <Box sx={{ flex: 1, overflow: "hidden" }}>{children}</Box>
    </Box>
  );
}

export default function PurchasingRoutes() {
  return (
    <Routes>
      <Route index element={<PurchasingLayout><PurchasingDashboard /></PurchasingLayout>} />
      <Route path="suppliers" element={<PurchasingLayout><SuppliersPage /></PurchasingLayout>} />
      <Route path="orders" element={<PurchasingLayout><PurchaseOrdersPage /></PurchasingLayout>} />
      <Route path="grn" element={<PurchasingLayout><GoodReceivedNotesPage /></PurchasingLayout>} />
      <Route path="returns" element={<PurchasingLayout><PurchaseReturnsPage /></PurchasingLayout>} />
      <Route path="settlements" element={<PurchasingLayout><CreditSettlementPage /></PurchasingLayout>} />
    </Routes>
  );
}

import SalesStockDashboard from "./SalesStockDashboard";

/** Warehouse > Stocks: per-product on-hand stock summary (moved off the dashboard). */
export default function StocksPage() {
  return <SalesStockDashboard view="summary" />;
}

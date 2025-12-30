import apiClient from "@/api/client";
import * as types from "./types";

export const reportingApi = {
  // Sales Report
  getSalesReport: async (request: types.SalesReportRequest) => {
    const response = await apiClient.post<types.SalesReportResponse>(
      "/reporting/sales",
      request
    );
    return response.data;
  },

  // Finance Report
  getFinanceReport: async (request: types.FinanceReportRequest) => {
    const response = await apiClient.post<types.FinanceReportResponse>(
      "/reporting/finance",
      request
    );
    return response.data;
  },

  // Inventory Report
  getInventoryReport: async (request: types.InventoryReportRequest) => {
    const response = await apiClient.post<types.InventoryReportResponse>(
      "/reporting/inventory",
      request
    );
    return response.data;
  },

  // HR Report
  getHRReport: async (request: types.HRReportRequest) => {
    const response = await apiClient.post<types.HRReportResponse>(
      "/reporting/hr",
      request
    );
    return response.data;
  },

  // Warehouse Report
  getWarehouseReport: async (request: types.WarehouseReportRequest) => {
    const response = await apiClient.post<types.WarehouseReportResponse>(
      "/reporting/warehouse",
      request
    );
    return response.data;
  },

  // Support Report
  getSupportReport: async (request: types.SupportReportRequest) => {
    const response = await apiClient.post<types.SupportReportResponse>(
      "/reporting/support",
      request
    );
    return response.data;
  },

  // Dashboard Metrics
  getDashboardMetrics: async () => {
    const response = await apiClient.get<types.DashboardMetrics>(
      "/reporting/dashboard"
    );
    return response.data;
  },

  // Quick Stats
  getQuickStats: async (
    period: "today" | "week" | "month" | "year" = "today"
  ) => {
    const response = await apiClient.get<types.QuickStats>(
      "/reporting/quick-stats",
      { params: { period } }
    );
    return response.data;
  },
};

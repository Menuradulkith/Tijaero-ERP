import apiClient from "@/api/client";
import {
  Invoice,
  InvoiceCreate,
  InvoiceUpdate,
  InvoiceWithItems,
  SaleReturn,
  SaleReturnCreate,
  SaleReturnWithItems,
  SaleReturnProcessResponse,
  SalesStats,
} from "./types";

export const salesApi = {
  getAll: async (skip = 0, limit = 100) => {
    const response = await apiClient.get<Invoice[]>("/sales/", {
      params: { skip, limit },
    });
    return response.data;
  },

  search: async (query: string, skip = 0, limit = 100) => {
    const response = await apiClient.get<Invoice[]>("/sales/search", {
      params: { q: query, skip, limit },
    });
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<InvoiceWithItems>(`/sales/${id}`);
    return response.data;
  },

  create: async (data: InvoiceCreate) => {
    const response = await apiClient.post<InvoiceWithItems>("/sales/", data);
    return response.data;
  },

  update: async (id: number, data: InvoiceUpdate) => {
    const response = await apiClient.put<InvoiceWithItems>(
      `/sales/${id}`,
      data
    );
    return response.data;
  },

  delete: async (id: number) => {
    await apiClient.delete(`/sales/${id}`);
  },

  // Approve a pending credit invoice
  approve: async (id: number) => {
    const response = await apiClient.post<InvoiceWithItems>(`/sales/${id}/approve`);
    return response.data;
  },

  // Mark an invoice as completed (delivered/paid)
  complete: async (id: number) => {
    const response = await apiClient.post<InvoiceWithItems>(`/sales/${id}/complete`);
    return response.data;
  },

  // Cancel an invoice and restore stock
  cancel: async (id: number) => {
    const response = await apiClient.post<InvoiceWithItems>(`/sales/${id}/cancel`);
    return response.data;
  },

  // Get sales statistics
  getStatistics: async () => {
    const response = await apiClient.get<SalesStats>("/sales/statistics");
    return response.data;
  },

  // OPTIMIZED: Get invoices by customer - now uses server-side filtering
  getByCustomer: async (customerId: number, skip = 0, limit = 100) => {
    const response = await apiClient.get<Invoice[]>(`/sales/by-customer/${customerId}`, {
      params: { skip, limit },
    });
    return response.data;
  },

  // Get recent sales for a customer (last 5 from any branch)
  getRecentByCustomer: async (customerId: number, limit = 5) => {
    const response = await apiClient.get<Invoice[]>(`/sales/customer/${customerId}/recent`, {
      params: { limit },
    });
    return response.data;
  },

  // OPTIMIZED: Get pending approval invoices - now uses server-side filtering
  getPendingApproval: async (skip = 0, limit = 100) => {
    const response = await apiClient.get<Invoice[]>("/sales/pending-approval", {
      params: { skip, limit },
    });
    return response.data;
  },
};

export const saleReturnsApi = {
  getAll: async (skip = 0, limit = 100) => {
    const response = await apiClient.get<SaleReturn[]>("/sales/returns/", {
      params: { skip, limit },
    });
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<SaleReturnWithItems>(
      `/sales/returns/${id}`
    );
    return response.data;
  },

  create: async (data: SaleReturnCreate) => {
    const response = await apiClient.post<SaleReturn>("/sales/returns/", data);
    return response.data;
  },

  delete: async (id: number) => {
    await apiClient.delete(`/sales/returns/${id}`);
  },

  // Workflow endpoints
  approve: async (id: number) => {
    const response = await apiClient.post<SaleReturn>(`/sales/returns/${id}/approve`);
    return response.data;
  },

  reject: async (id: number, reason?: string) => {
    const response = await apiClient.post<SaleReturn>(`/sales/returns/${id}/reject`, null, {
      params: reason ? { reason } : undefined,
    });
    return response.data;
  },

  process: async (id: number) => {
    const response = await apiClient.post<SaleReturnProcessResponse>(`/sales/returns/${id}/process`);
    return response.data;
  },

  // Get statistics
  getStatistics: async () => {
    const response = await apiClient.get("/sales/returns/statistics");
    return response.data;
  },

  // OPTIMIZED: Get returns by invoice - now uses server-side filtering
  getByInvoice: async (invoiceId: number, skip = 0, limit = 100) => {
    const response = await apiClient.get<SaleReturn[]>(`/sales/returns/by-invoice/${invoiceId}`, {
      params: { skip, limit },
    });
    return response.data;
  },
};

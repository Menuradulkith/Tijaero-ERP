import apiClient from "@/api/client";
import {
  Invoice,
  InvoiceCreate,
  InvoiceUpdate,
  InvoiceWithItems,
  SaleReturn,
  SaleReturnCreate,
  SaleReturnWithItems,
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

  // Approve an invoice
  approve: async (id: number) => {
    const response = await apiClient.put<InvoiceWithItems>(`/sales/${id}`, {
      approval: true,
    });
    return response.data;
  },

  // Get sales statistics
  getStatistics: async () => {
    const response = await apiClient.get<SalesStats>("/sales/statistics");
    return response.data;
  },

  // Get invoices by customer
  getByCustomer: async (customerId: number, skip = 0, limit = 100) => {
    const response = await apiClient.get<Invoice[]>("/sales/search", {
      params: { q: customerId.toString(), skip, limit },
    });
    return response.data;
  },

  // Get pending approval invoices
  getPendingApproval: async (skip = 0, limit = 100) => {
    const all = await salesApi.getAll(skip, limit);
    return all.filter((inv) => !inv.approval);
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

  // Get returns by invoice
  getByInvoice: async (invoiceId: number) => {
    const all = await saleReturnsApi.getAll();
    return all.filter((ret) => ret.invoice_id === invoiceId);
  },
};

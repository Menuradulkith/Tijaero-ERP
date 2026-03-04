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
  PaginatedInvoices,
  PaginatedSaleReturns,
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
  getStatistics: async (branchCode?: string) => {
    const response = await apiClient.get<SalesStats>("/sales/statistics", {
      params: branchCode ? { branch_code: branchCode } : undefined,
    });
    return response.data;
  },

  // OPTIMIZED: Paginated list with server-side filtering
  getPaginated: async (params: {
    page?: number;
    pageSize?: number;
    search?: string;
    branchCode?: string;
    status?: string;
    sortBy?: string;
    sortDesc?: boolean;
  } = {}) => {
    const response = await apiClient.get<PaginatedInvoices>("/sales/list", {
      params: {
        page: params.page || 1,
        page_size: params.pageSize || 50,
        search: params.search || undefined,
        branch_code: params.branchCode || undefined,
        status: params.status || undefined,
        sort_by: params.sortBy || "created_date",
        sort_desc: params.sortDesc !== false,
      },
    });
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

  // Get payment history for an invoice
  getPaymentHistory: async (invoiceId: number) => {
    const response = await apiClient.get(`/sales/${invoiceId}/payment-history`);
    return response.data;
  },

  // Complete invoice (alias for complete for clearer semantics)
  completeInvoice: async (id: number) => {
    const response = await apiClient.post<InvoiceWithItems>(`/sales/${id}/complete`);
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

  // OPTIMIZED: Paginated list with server-side filtering
  getPaginated: async (params: {
    page?: number;
    pageSize?: number;
    search?: string;
    branchCode?: string;
    status?: string;
    sortBy?: string;
    sortDesc?: boolean;
  } = {}) => {
    const response = await apiClient.get<PaginatedSaleReturns>("/sales/returns/list", {
      params: {
        page: params.page || 1,
        page_size: params.pageSize || 50,
        search: params.search || undefined,
        branch_code: params.branchCode || undefined,
        status: params.status || undefined,
        sort_by: params.sortBy || "added_date",
        sort_desc: params.sortDesc !== false,
      },
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

  // Workflow endpoints - Use centralized approval API
  approve: async (id: number) => {
    // Get the sale return to find its approval_id
    const saleReturn = await saleReturnsApi.getById(id);

    if (!saleReturn.approval_id) {
      throw new Error('Sale return does not have an approval record');
    }

    // Use centralized approval API
    const { approvalsApi } = await import('@/modules/common/api');
    await approvalsApi.approve(saleReturn.approval_id);

    // Return the updated sale return
    return saleReturnsApi.getById(id);
  },

  reject: async (id: number, reason?: string) => {
    // Get the sale return to find its approval_id
    const saleReturn = await saleReturnsApi.getById(id);

    if (!saleReturn.approval_id) {
      throw new Error('Sale return does not have an approval record');
    }

    // Use centralized approval API
    const { approvalsApi } = await import('@/modules/common/api');
    await approvalsApi.reject(saleReturn.approval_id, reason || 'Rejected');

    // Return the updated sale return
    return saleReturnsApi.getById(id);
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


// =============================================================================
// Payment Card Settings API
// =============================================================================

import { PaymentCard, PaymentCardCreate, PaymentCardUpdate } from "./types";

export const paymentCardsApi = {
  getAll: async (activeOnly = false) => {
    const response = await apiClient.get<PaymentCard[]>("/sales/settings/payment-cards", {
      params: { active_only: activeOnly },
    });
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<PaymentCard>(`/sales/settings/payment-cards/${id}`);
    return response.data;
  },

  create: async (data: PaymentCardCreate) => {
    const response = await apiClient.post<PaymentCard>("/sales/settings/payment-cards", data);
    return response.data;
  },

  update: async (id: number, data: PaymentCardUpdate) => {
    const response = await apiClient.put<PaymentCard>(`/sales/settings/payment-cards/${id}`, data);
    return response.data;
  },

  delete: async (id: number) => {
    await apiClient.delete(`/sales/settings/payment-cards/${id}`);
  },
};

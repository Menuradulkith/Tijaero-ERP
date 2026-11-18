import apiClient from "@/api/client";
import {
  Invoice,
  InvoiceCreate,
  InvoiceUpdate,
  InvoiceWithItems,
  SalesStats,
  PaginatedInvoices,
} from "./types";

const PAGE = 1000; // the API serves at most 1000 rows per request

/** Reads every row of a skip/limit list, one page at a time (stops at `maxRows` so a huge table cannot lock the browser). */
async function fetchAllRows<T>(url: string, params: Record<string, unknown> = {}, skip = 0, maxRows = 50000): Promise<T[]> {
  const out: T[] = [];
  for (let at = skip; out.length < maxRows; at += PAGE) {
    const { data } = await apiClient.get<T[]>(url, { params: { ...params, skip: at, limit: PAGE } });
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

export const salesApi = {
  getAll: async (skip = 0) => fetchAllRows<Invoice>("/sales/", {}, skip),

  search: async (query: string, skip = 0) => fetchAllRows<Invoice>("/sales/search", { q: query }, skip),

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
  // Goes through the central approval queue, which verifies the approver credentials (step-up sign-in),
  // like the quotation and sale-return approvals. /sales/{id}/approve takes no credentials.
  approve: async (id: number, credentials?: { approver_username?: string; approver_password?: string }) => {
    const order = await salesApi.getById(id);
    if (order.approval_id) {
      const { approvalsApi } = await import("@/modules/common/api");
      await approvalsApi.approve(order.approval_id, undefined, credentials);
      return salesApi.getById(id);
    }
    const response = await apiClient.post<InvoiceWithItems>(`/sales/${id}/approve`);
    return response.data;
  },

  // Reject a pending order; the reason is required and kept
  reject: async (id: number, reason: string) => {
    const response = await apiClient.post<InvoiceWithItems>(`/sales/${id}/reject`, { reason });
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
  getByCustomer: async (customerId: number, skip = 0) => fetchAllRows<Invoice>(`/sales/by-customer/${customerId}`, {}, skip),

  // Get recent sales for a customer (last 5 from any branch)
  getRecentByCustomer: async (customerId: number, limit = 5) => {
    const response = await apiClient.get<InvoiceWithItems[]>(`/sales/customer/${customerId}/recent`, {
      params: { limit },
    });
    return response.data;
  },

  // OPTIMIZED: Get pending approval invoices - now uses server-side filtering
  getPendingApproval: async (skip = 0) => fetchAllRows<Invoice>("/sales/pending-approval", {}, skip),

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

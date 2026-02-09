/**
 * Customer Agent Commission API Client
 */

import apiClient from "@/api/client";
import {
  CommissionListResponse,
  CustomerAgentCommission,
  CustomerAgentCommissionCreate,
  CustomerAgentCommissionUpdate,
  CustomerAgentCommissionPayment,
  CustomerAgentCommissionPaymentCreate,
  CustomerAgentCommissionPaymentWithItems,
  AgentCommissionSummary,
} from "./commission-types";

// =============================================================================
// Commissions API
// =============================================================================

export const commissionsApi = {
  getAll: async (params?: {
    skip?: number;
    limit?: number;
    agent_id?: number;
    status?: string;
    search?: string;
    date_from?: string;
    date_to?: string;
  }) => {
    const response = await apiClient.get<CommissionListResponse>(
      "/customers/commissions/",
      { params }
    );
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<CustomerAgentCommission>(
      `/customers/commissions/${id}`
    );
    return response.data;
  },

  create: async (data: CustomerAgentCommissionCreate) => {
    const response = await apiClient.post<CustomerAgentCommission>(
      "/customers/commissions/",
      data
    );
    return response.data;
  },

  update: async (id: number, data: CustomerAgentCommissionUpdate) => {
    const response = await apiClient.put<CustomerAgentCommission>(
      `/customers/commissions/${id}`,
      data
    );
    return response.data;
  },

  approve: async (id: number) => {
    const response = await apiClient.post<CustomerAgentCommission>(
      `/customers/commissions/${id}/approve`
    );
    return response.data;
  },

  delete: async (id: number) => {
    await apiClient.delete(`/customers/commissions/${id}`);
  },

  // Agent-specific
  getAgentSummary: async (agentId: number) => {
    const response = await apiClient.get<AgentCommissionSummary>(
      `/customers/commissions/agent/${agentId}/summary`
    );
    return response.data;
  },

  getAllAgentsSummary: async () => {
    const response = await apiClient.get<AgentCommissionSummary[]>(
      "/customers/commissions/agents-summary"
    );
    return response.data;
  },

  getPendingForAgent: async (agentId: number) => {
    const response = await apiClient.get<CustomerAgentCommission[]>(
      `/customers/commissions/agent/${agentId}/pending`
    );
    return response.data;
  },

  // Report endpoints
  getPendingReport: async (params?: { agent_id?: number; date_from?: string; date_to?: string }) => {
    const response = await apiClient.get("/customers/commissions/reports/pending", { params });
    return response.data;
  },

  getAgentSummaryReport: async (params?: { date_from?: string; date_to?: string }) => {
    const response = await apiClient.get("/customers/commissions/reports/agent-summary", { params });
    return response.data;
  },

  getPaymentHistoryReport: async (params?: { agent_id?: number; date_from?: string; date_to?: string }) => {
    const response = await apiClient.get("/customers/commissions/reports/payment-history", { params });
    return response.data;
  },
};

// =============================================================================
// Commission Payments API
// =============================================================================

export const commissionPaymentsApi = {
  getAll: async (params?: {
    skip?: number;
    limit?: number;
    agent_id?: number;
    status?: string;
    search?: string;
  }) => {
    const response = await apiClient.get<{
      items: (CustomerAgentCommissionPayment & { agent_name?: string })[];
      total: number;
    }>("/customers/commissions/payments/", { params });
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<CustomerAgentCommissionPaymentWithItems>(
      `/customers/commissions/payments/${id}`
    );
    return response.data;
  },

  create: async (data: CustomerAgentCommissionPaymentCreate) => {
    const response = await apiClient.post<CustomerAgentCommissionPayment>(
      "/customers/commissions/payments/",
      data
    );
    return response.data;
  },

  verify: async (id: number) => {
    const response = await apiClient.post<CustomerAgentCommissionPayment>(
      `/customers/commissions/payments/${id}/verify`
    );
    return response.data;
  },

  cancel: async (id: number) => {
    const response = await apiClient.post<CustomerAgentCommissionPayment>(
      `/customers/commissions/payments/${id}/cancel`
    );
    return response.data;
  },
};

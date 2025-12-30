import apiClient from "@/api/client";
import {
  CustomerSupport,
  CustomerSupportCreate,
  CSJobItem,
  CSJobItemCreate,
  CustomerCallLog,
  CustomerCallLogCreate,
  WarrantyClaim,
  WarrantyClaimCreate,
} from "./types";

// Customer Support Tickets API
export const supportTicketsApi = {
  getAll: async (params?: {
    branch_code?: string;
    job_type?: string;
    assigned_user_id?: number;
    customer_id?: number;
    date_from?: string;
    date_to?: string;
    skip?: number;
    limit?: number;
  }) => {
    const response = await apiClient.get<CustomerSupport[]>(
      "/support/tickets",
      {
        params,
      }
    );
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<CustomerSupport>(
      `/support/tickets/${id}`
    );
    return response.data;
  },

  create: async (data: CustomerSupportCreate) => {
    const response = await apiClient.post<CustomerSupport>(
      "/support/tickets",
      data
    );
    return response.data;
  },

  update: async (id: number, data: CustomerSupportCreate) => {
    const response = await apiClient.put<CustomerSupport>(
      `/support/tickets/${id}`,
      data
    );
    return response.data;
  },

  delete: async (id: number) => {
    await apiClient.delete(`/support/tickets/${id}`);
  },
};

// Job Items API
export const jobItemsApi = {
  getAll: async (ticketId: number) => {
    const response = await apiClient.get<CSJobItem[]>(
      `/support/tickets/${ticketId}/job-items`
    );
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<CSJobItem>(`/support/job-items/${id}`);
    return response.data;
  },

  create: async (data: CSJobItemCreate) => {
    const response = await apiClient.post<CSJobItem>(
      "/support/job-items",
      data
    );
    return response.data;
  },

  update: async (id: number, data: CSJobItemCreate) => {
    const response = await apiClient.put<CSJobItem>(
      `/support/job-items/${id}`,
      data
    );
    return response.data;
  },

  delete: async (id: number) => {
    await apiClient.delete(`/support/job-items/${id}`);
  },
};

// Call Logs API
export const callLogsApi = {
  getAll: async (ticketId: number) => {
    const response = await apiClient.get<CustomerCallLog[]>(
      `/support/tickets/${ticketId}/call-logs`
    );
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<CustomerCallLog>(
      `/support/call-logs/${id}`
    );
    return response.data;
  },

  create: async (data: CustomerCallLogCreate) => {
    const response = await apiClient.post<CustomerCallLog>(
      "/support/call-logs",
      data
    );
    return response.data;
  },

  update: async (id: number, data: CustomerCallLogCreate) => {
    const response = await apiClient.put<CustomerCallLog>(
      `/support/call-logs/${id}`,
      data
    );
    return response.data;
  },

  delete: async (id: number) => {
    await apiClient.delete(`/support/call-logs/${id}`);
  },
};

// Warranty Claims API
export const warrantyClaimsApi = {
  getAll: async (params?: {
    date_from?: string;
    date_to?: string;
    skip?: number;
    limit?: number;
  }) => {
    const response = await apiClient.get<WarrantyClaim[]>(
      "/support/warranty-claims",
      { params }
    );
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<WarrantyClaim>(
      `/support/warranty-claims/${id}`
    );
    return response.data;
  },

  create: async (data: WarrantyClaimCreate) => {
    const response = await apiClient.post<WarrantyClaim>(
      "/support/warranty-claims",
      data
    );
    return response.data;
  },

  update: async (id: number, data: WarrantyClaimCreate) => {
    const response = await apiClient.put<WarrantyClaim>(
      `/support/warranty-claims/${id}`,
      data
    );
    return response.data;
  },

  delete: async (id: number) => {
    await apiClient.delete(`/support/warranty-claims/${id}`);
  },
};

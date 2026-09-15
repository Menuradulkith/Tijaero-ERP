import apiClient from "@/api/client";
import type {
  Branch,
  BranchCreate,
  BranchUpdate,
  PaginatedResponse,
} from "@/api/types";

export interface BranchPerformance {
  sales_today: number;
  sales_month: number;
  orders_today: number;
  orders_month: number;
  in_stock: number;
  reserved: number;
  sold_today: number;
  returned: number;
}

export const branchApi = {
  getAll: async (page = 1, size = 100000): Promise<PaginatedResponse<Branch>> => {
    const response = await apiClient.get<PaginatedResponse<Branch>>(
      "/branches",
      {
        params: { page, size },
      }
    );
    return response.data;
  },

  getById: async (id: number): Promise<Branch> => {
    const response = await apiClient.get<Branch>(`/branches/${id}`);
    return response.data;
  },

  getPerformance: async (id: number): Promise<BranchPerformance> => {
    const response = await apiClient.get<BranchPerformance>(`/branches/${id}/performance`);
    return response.data;
  },

  checkCodeExists: async (branchCode: string, excludeId?: number): Promise<boolean> => {
    try {
      const response = await apiClient.get(`/branches/check-code/${encodeURIComponent(branchCode)}`, {
        params: excludeId ? { exclude_id: excludeId } : undefined,
      });
      return response.data.exists;
    } catch {
      return false;
    }
  },

  checkNameExists: async (branchName: string, excludeId?: number): Promise<boolean> => {
    try {
      const response = await apiClient.get(`/branches/check-name/${encodeURIComponent(branchName)}`, {
        params: excludeId ? { exclude_id: excludeId } : undefined,
      });
      return response.data.exists;
    } catch {
      return false;
    }
  },

  checkEmailExists: async (email: string, excludeId?: number): Promise<boolean> => {
    try {
      const response = await apiClient.get(`/branches/check-email/${encodeURIComponent(email)}`, {
        params: excludeId ? { exclude_id: excludeId } : undefined,
      });
      return response.data.exists;
    } catch {
      return false;
    }
  },

  create: async (data: BranchCreate): Promise<Branch> => {
    // Clean up empty strings to null for optional EmailStr fields
    const cleanData = {
      ...data,
      email: data.email?.trim() || null,
      address: data.address?.trim() || null,
      contact_number: data.contact_number?.trim() || null,
    };
    const response = await apiClient.post<Branch>("/branches", cleanData);
    return response.data;
  },

  update: async (id: number, data: BranchUpdate): Promise<Branch> => {
    // Clean up empty strings to null for optional EmailStr fields
    const cleanData = {
      ...data,
      email: data.email?.trim() || null,
      address: data.address?.trim() || null,
      contact_number: data.contact_number?.trim() || null,
    };
    const response = await apiClient.put<Branch>(`/branches/${id}`, cleanData);
    return response.data;
  },

  delete: async (id: number): Promise<{ message: string }> => {
    const response = await apiClient.delete<{ message: string }>(`/branches/${id}`);
    return response.data;
  },
};

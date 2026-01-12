import apiClient from "@/api/client";
import type {
  Branch,
  BranchCreate,
  BranchUpdate,
  PaginatedResponse,
} from "@/api/types";

export const branchApi = {
  getAll: async (page = 1, size = 10): Promise<PaginatedResponse<Branch>> => {
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

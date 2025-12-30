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
    const response = await apiClient.post<Branch>("/branches", data);
    return response.data;
  },

  update: async (id: number, data: BranchUpdate): Promise<Branch> => {
    const response = await apiClient.put<Branch>(`/branches/${id}`, data);
    return response.data;
  },

  delete: async (id: number): Promise<void> => {
    await apiClient.delete(`/branches/${id}`);
  },
};

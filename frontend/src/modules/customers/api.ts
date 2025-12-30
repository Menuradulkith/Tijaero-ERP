import apiClient from "@/api/client";
import { Customer, CustomerCreate, CustomerUpdate } from "./types";

export const customersApi = {
  getAll: async (skip = 0, limit = 100) => {
    const response = await apiClient.get<Customer[]>("/customers/", {
      params: { skip, limit },
    });
    return response.data;
  },

  search: async (query: string, skip = 0, limit = 100) => {
    const response = await apiClient.get<Customer[]>("/customers/search", {
      params: { q: query, skip, limit },
    });
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<Customer>(`/customers/${id}`);
    return response.data;
  },

  create: async (data: CustomerCreate) => {
    const response = await apiClient.post<Customer>("/customers/", data);
    return response.data;
  },

  update: async (id: number, data: CustomerUpdate) => {
    const response = await apiClient.put<Customer>(`/customers/${id}`, data);
    return response.data;
  },

  delete: async (id: number) => {
    await apiClient.delete(`/customers/${id}`);
  },
};

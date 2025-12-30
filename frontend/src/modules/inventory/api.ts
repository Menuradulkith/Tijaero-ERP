import apiClient from "@/api/client";
import {
  Product,
  ProductCreate,
  ProductUpdate,
  Category,
  CategoryCreate,
  Brand,
  BrandCreate,
} from "./types";

export const productsApi = {
  getAll: async (skip = 0, limit = 100, activeOnly = true) => {
    const response = await apiClient.get<Product[]>("/inventory/products/", {
      params: { skip, limit, active_only: activeOnly },
    });
    return response.data;
  },

  search: async (query: string, skip = 0, limit = 100) => {
    const response = await apiClient.get<Product[]>(
      "/inventory/products/search",
      {
        params: { q: query, skip, limit },
      }
    );
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<Product>(`/inventory/products/${id}`);
    return response.data;
  },

  create: async (data: ProductCreate) => {
    const response = await apiClient.post<Product>(
      "/inventory/products/",
      data
    );
    return response.data;
  },

  update: async (id: number, data: ProductUpdate) => {
    const response = await apiClient.put<Product>(
      `/inventory/products/${id}`,
      data
    );
    return response.data;
  },

  delete: async (id: number) => {
    await apiClient.delete(`/inventory/products/${id}`);
  },
};

export const categoriesApi = {
  getAll: async (skip = 0, limit = 100) => {
    const response = await apiClient.get<Category[]>("/inventory/categories/", {
      params: { skip, limit },
    });
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<Category>(
      `/inventory/categories/${id}`
    );
    return response.data;
  },

  create: async (data: CategoryCreate) => {
    const response = await apiClient.post<Category>(
      "/inventory/categories/",
      data
    );
    return response.data;
  },
};

export const brandsApi = {
  getAll: async (skip = 0, limit = 100) => {
    const response = await apiClient.get<Brand[]>("/inventory/brands/", {
      params: { skip, limit },
    });
    return response.data;
  },

  create: async (data: BrandCreate) => {
    const response = await apiClient.post<Brand>("/inventory/brands/", data);
    return response.data;
  },
};

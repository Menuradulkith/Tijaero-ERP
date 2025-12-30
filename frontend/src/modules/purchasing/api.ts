import apiClient from "@/api/client";
import {
  Supplier,
  SupplierCreate,
  SupplierUpdate,
  PurchasingOrder,
  PurchasingOrderWithItems,
  PurchasingOrderCreate,
  PurchasingOrderUpdate,
  PurchasingReturnWithItems,
  PurchasingReturnCreate,
} from "./types";

// Supplier API
export const suppliersApi = {
  getAll: async (params?: {
    active?: boolean;
    country_id?: number;
    search?: string;
    skip?: number;
    limit?: number;
  }) => {
    const response = await apiClient.get<Supplier[]>("/purchasing/suppliers", {
      params,
    });
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<Supplier>(
      `/purchasing/suppliers/${id}`
    );
    return response.data;
  },

  create: async (data: SupplierCreate) => {
    const response = await apiClient.post<Supplier>(
      "/purchasing/suppliers",
      data
    );
    return response.data;
  },

  update: async (id: number, data: SupplierUpdate) => {
    const response = await apiClient.patch<Supplier>(
      `/purchasing/suppliers/${id}`,
      data
    );
    return response.data;
  },

  delete: async (id: number) => {
    await apiClient.delete(`/purchasing/suppliers/${id}`);
  },
};

// Purchase Orders API
export const purchaseOrdersApi = {
  getAll: async (params?: {
    status?: string;
    supplier_id?: number;
    branch_code?: string;
    date_from?: string;
    date_to?: string;
    skip?: number;
    limit?: number;
  }) => {
    const response = await apiClient.get<PurchasingOrder[]>(
      "/purchasing/orders",
      { params }
    );
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<PurchasingOrderWithItems>(
      `/purchasing/orders/${id}`
    );
    return response.data;
  },

  create: async (data: PurchasingOrderCreate) => {
    const response = await apiClient.post<PurchasingOrderWithItems>(
      "/purchasing/orders",
      data
    );
    return response.data;
  },

  update: async (id: number, data: PurchasingOrderUpdate) => {
    const response = await apiClient.patch<PurchasingOrder>(
      `/purchasing/orders/${id}`,
      data
    );
    return response.data;
  },

  getSupplierOrders: async (supplierId: number, skip = 0, limit = 100) => {
    const response = await apiClient.get<PurchasingOrder[]>(
      `/purchasing/suppliers/${supplierId}/orders`,
      { params: { skip, limit } }
    );
    return response.data;
  },
};

// Purchase Returns API
export const purchaseReturnsApi = {
  getById: async (id: number) => {
    const response = await apiClient.get<PurchasingReturnWithItems>(
      `/purchasing/returns/${id}`
    );
    return response.data;
  },

  create: async (data: PurchasingReturnCreate) => {
    const response = await apiClient.post<PurchasingReturnWithItems>(
      "/purchasing/returns",
      data
    );
    return response.data;
  },
};

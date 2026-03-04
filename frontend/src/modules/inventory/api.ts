import apiClient from "@/api/client";
import {
  Product,
  ProductCreate,
  ProductUpdate,
  Category,
  CategoryCreate,
  CategoryUpdate,
  Brand,
  BrandCreate,
  BrandUpdate,
  MinimumPrice,
  MinimumPriceCreate,
  SalesStock,
  SalesStockCreate,
  StockTrackingEvent,
  CompanyAsset,
  CompanyAssetCreate,
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
    const response = await apiClient.delete<{ message: string }>(`/inventory/products/${id}`);
    return response.data;
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

  update: async (id: number, data: CategoryUpdate) => {
    const response = await apiClient.put<Category>(
      `/inventory/categories/${id}`,
      data
    );
    return response.data;
  },

  delete: async (id: number) => {
    const response = await apiClient.delete<{ message: string }>(`/inventory/categories/${id}`);
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

  getById: async (id: number) => {
    const response = await apiClient.get<Brand>(`/inventory/brands/${id}`);
    return response.data;
  },

  create: async (data: BrandCreate) => {
    const response = await apiClient.post<Brand>("/inventory/brands/", data);
    return response.data;
  },

  update: async (id: number, data: BrandUpdate) => {
    const response = await apiClient.put<Brand>(`/inventory/brands/${id}`, data);
    return response.data;
  },

  delete: async (id: number) => {
    const response = await apiClient.delete<{ message: string }>(`/inventory/brands/${id}`);
    return response.data;
  },
};

export const minimumPriceApi = {
  getHistory: async (productId: number) => {
    const response = await apiClient.get<MinimumPrice[]>(
      `/inventory/products/${productId}/minimum-prices`
    );
    return response.data;
  },

  getCurrent: async (productId: number) => {
    const response = await apiClient.get<MinimumPrice>(
      `/inventory/products/${productId}/minimum-prices/current`
    );
    return response.data;
  },

  set: async (productId: number, data: MinimumPriceCreate) => {
    const response = await apiClient.post<MinimumPrice>(
      `/inventory/products/${productId}/minimum-prices`,
      data
    );
    return response.data;
  },

  delete: async (priceId: number) => {
    await apiClient.delete(`/inventory/minimum-prices/${priceId}`);
  },
};

// Sales Stock API - items available for sale from GRN
export const salesStockApi = {
  getAll: async (params?: { branch_code?: string; product_id?: number; status?: string }) => {
    const response = await apiClient.get<SalesStock[]>("/inventory/sales-stock", { params });
    return response.data;
  },

  create: async (data: SalesStockCreate) => {
    const response = await apiClient.post<SalesStock>(
      "/inventory/sales-stock",
      data
    );
    return response.data;
  },

  checkBarcodeExists: async (barcode: string): Promise<{ exists: boolean; barcode: string }> => {
    const response = await apiClient.get<{ exists: boolean; barcode: string }>(
      `/inventory/sales-stock/check-barcode/${barcode}`
    );
    return response.data;
  },

  getByGRN: async (grnId: number) => {
    const response = await apiClient.get<SalesStock[]>(
      `/inventory/sales-stock/grn/${grnId}`
    );
    return response.data;
  },

  getAvailableByBranch: async (branchCode: string) => {
    const response = await apiClient.get<SalesStock[]>(
      `/inventory/sales-stock/branch/${branchCode}`
    );
    return response.data;
  },

  getByBarcode: async (barcode: string) => {
    const response = await apiClient.get<SalesStock>(
      `/inventory/sales-stock/barcode/${barcode}`
    );
    return response.data;
  },

  updateStatus: async (id: number, status: string) => {
    const response = await apiClient.patch<SalesStock>(
      `/inventory/sales-stock/${id}/status`,
      null,
      { params: { status } }
    );
    return response.data;
  },

  getTracking: async (id: number) => {
    const response = await apiClient.get<StockTrackingEvent[]>(
      `/inventory/sales-stock/${id}/tracking`
    );
    return response.data;
  },
};

// Company Assets API - Real table for company-owned items
export const companyAssetsApi = {
  create: async (data: CompanyAssetCreate) => {
    const response = await apiClient.post<CompanyAsset>(
      "/inventory/company-assets",
      data
    );
    return response.data;
  },

  checkBarcodeExists: async (barcode: string): Promise<{ exists: boolean; barcode: string }> => {
    const response = await apiClient.get<{ exists: boolean; barcode: string }>(
      `/inventory/company-assets/check-barcode/${barcode}`
    );
    return response.data;
  },

  getByGRN: async (grnId: number) => {
    const response = await apiClient.get<CompanyAsset[]>(
      `/inventory/company-assets/grn/${grnId}`
    );
    return response.data;
  },

  getByBranch: async (branchCode: string) => {
    const response = await apiClient.get<CompanyAsset[]>(
      `/inventory/company-assets/branch/${branchCode}`
    );
    return response.data;
  },

  getByBarcode: async (barcode: string) => {
    const response = await apiClient.get<CompanyAsset>(
      `/inventory/company-assets/barcode/${barcode}`
    );
    return response.data;
  },

  updateStatus: async (id: number, status: string) => {
    const response = await apiClient.patch<CompanyAsset>(
      `/inventory/company-assets/${id}/status`,
      null,
      { params: { status } }
    );
    return response.data;
  },
};

import apiClient from "@/api/client";
import type { SupplierProduct } from "../purchasing/types";
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
  SalesStockPaginated,
  StockSummaryPaginated,
  StockTrackingEvent,
  CompanyAsset,
  CompanyAssetCreate,
  PriceTier,
  PriceTierCreate,
  PriceTierUpdate,
  DesignBrief,
  DesignBriefItemOption,
  DesignBriefSave,
  DesignDetail,
  DesignDetailSave,
  BomStructure,
  BomStructureSave,
  BomStructurePage,
  BomWorkCenter,
  DesignBriefStatus,
} from "./types";

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
  pages: number;
}

export interface PageQuery {
  page: number;
  size: number;
  q?: string;
  active?: boolean;
  sort_by?: string;
  order?: "asc" | "desc";
}

// Drop empty filters so they aren't sent as "q=" / "category_id=undefined".
const cleanParams = (p: object) =>
  Object.fromEntries(
    Object.entries(p).filter(([, v]) => v !== undefined && v !== null && v !== "")
  );

export const productsApi = {
  getPage: async (
    query: PageQuery & { category_id?: number; brand_id?: number; supplier_id?: number }
  ) => {
    const response = await apiClient.get<Paged<Product & { category_name?: string; brand_name?: string }>>(
      "/inventory/products/paged",
      { params: cleanParams(query) }
    );
    return response.data;
  },

  getAll: async (skip = 0, limit = 100000, activeOnly = true) => {
    const response = await apiClient.get<Product[]>("/inventory/products/", {
      params: { skip, limit, active_only: activeOnly },
    });
    return response.data;
  },

  search: async (query: string, skip = 0, limit = 100000) => {
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

  // Read-only reciprocal view of the approved-vendor mapping managed on the
  // Suppliers page — which suppliers can supply this product, and at what
  // cost/lead time. See purchasing/types.ts SupplierProduct.
  getSuppliers: async (id: number) => {
    const response = await apiClient.get<SupplierProduct[]>(
      `/inventory/products/${id}/suppliers`
    );
    return response.data;
  },

  uploadImage: async (id: number, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    const response = await apiClient.post<Product>(
      `/inventory/products/${id}/image`,
      formData,
      { headers: { "Content-Type": "multipart/form-data" } }
    );
    return response.data;
  },

  removeImage: async (id: number) => {
    const response = await apiClient.delete<Product>(
      `/inventory/products/${id}/image`
    );
    return response.data;
  },
};

// The API client's baseURL includes /api/v1; uploaded files are served from
// the plain origin at /uploads (mirrors SupplierLogoUploader's own helper).
const API_ORIGIN = (
  import.meta.env.VITE_API_URL || "http://localhost:8000/api/v1"
).replace(/\/api\/v1$/, "");

/**
 * Resolves a product's `image_url` to a displayable URL. Handles both an
 * uploaded file's relative path (e.g. "products/xyz.png", stored by
 * productsApi.uploadImage) and the older free-text external URL some
 * products still carry from before the uploader existed.
 */
export function productImageUrl(imageUrl?: string | null): string | null {
  if (!imageUrl) return null;
  return /^https?:\/\//i.test(imageUrl) ? imageUrl : `${API_ORIGIN}/uploads/${imageUrl}`;
}

export const categoriesApi = {
  getPage: async (query: PageQuery) => {
    const response = await apiClient.get<Paged<Category>>("/inventory/categories/paged", {
      params: cleanParams(query),
    });
    return response.data;
  },

  getAll: async (skip = 0, limit = 100000, activeOnly = false) => {
    const response = await apiClient.get<Category[]>("/inventory/categories/", {
      params: { skip, limit, active_only: activeOnly },
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

};

export const brandsApi = {
  getPage: async (query: PageQuery) => {
    const response = await apiClient.get<Paged<Brand>>("/inventory/brands/paged", {
      params: cleanParams(query),
    });
    return response.data;
  },

  getAll: async (skip = 0, limit = 100000, activeOnly = false) => {
    const response = await apiClient.get<Brand[]>("/inventory/brands/", {
      params: { skip, limit, active_only: activeOnly },
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

};

/** Product types — a list users pick from (and add to) on the product form. */
export interface ProductType {
  id: number;
  name: string;
  active: boolean;
}

/** Customs Harmonized System codes — picked (or added) on the product form. */
export interface HsCode {
  id: number;
  code: string;
  description?: string | null;
  active: boolean;
}

export const productTypesApi = {
  getAll: async (activeOnly = true) => {
    const response = await apiClient.get<ProductType[]>("/inventory/product-types/", { params: { active_only: activeOnly } });
    return response.data;
  },
  create: async (data: { name: string }) => {
    const response = await apiClient.post<ProductType>("/inventory/product-types/", data);
    return response.data;
  },
};

export const hsCodesApi = {
  getAll: async (activeOnly = true) => {
    const response = await apiClient.get<HsCode[]>("/inventory/hs-codes/", { params: { active_only: activeOnly } });
    return response.data;
  },
  create: async (data: { code: string; description?: string }) => {
    const response = await apiClient.post<HsCode>("/inventory/hs-codes/", data);
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

  /** Returns null when the product has no minimum price yet. */
  getCurrent: async (productId: number): Promise<MinimumPrice | null> => {
    const response = await apiClient.get<MinimumPrice | null>(
      `/inventory/products/${productId}/minimum-prices/current`
    );
    return response.data ?? null;
  },

  /**
   * Same as getCurrent, but errors do not raise the global red error toast.
   * Older backends answered 404 for "no minimum price yet"; that is still mapped to null.
   */
  getCurrentOrNull: async (productId: number): Promise<MinimumPrice | null> => {
    try {
      const response = await apiClient.get<MinimumPrice | null>(
        `/inventory/products/${productId}/minimum-prices/current`,
        { headers: { "X-Hide-Error-Toast": "true" } }
      );
      return response.data ?? null;
    } catch (error: unknown) {
      if ((error as { response?: { status?: number } })?.response?.status === 404) return null;
      throw error;
    }
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

  getPaginated: async (params?: {
    branch_code?: string;
    product_id?: number;
    /** Stock rows of this Item Catalog item (the stock key). */
    material_id?: number;
    status?: string;
    /** Only rows still in the warehouse or in transit (not sold / consumed / returned). */
    on_hand?: boolean;
    search?: string;
    brand_id?: number;
    location_id?: number;
    date_from?: string;
    date_to?: string;
    skip?: number;
    limit?: number;
  }) => {
    const response = await apiClient.get<SalesStockPaginated>(
      "/inventory/sales-stock/paginated",
      { params }
    );
    return response.data;
  },

  getStockSummary: async (params?: {
    branch_code?: string;
    brand_id?: number;
    search?: string;
    skip?: number;
    limit?: number;
  }) => {
    const response = await apiClient.get<StockSummaryPaginated>(
      "/inventory/sales-stock/stock-summary",
      { params }
    );
    return response.data;
  },

  /** Older line-by-line receiving flow (pair with goodReceivedItemsApi.create).
   * Not used by GoodReceivedNotesPage, which posts a whole receipt atomically
   * via goodReceivedNotesApi.receive — kept for callers that still need it. */
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
  getAll: async (params?: { branch_code?: string; product_id?: number; status?: string; source?: string }) => {
    const response = await apiClient.get<CompanyAsset[]>("/inventory/company-assets", { params });
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

// ── Price Tiers API ─────────────────────────────────────────────────────────
export const priceTiersApi = {
  /** List all price tiers for a product. Pass activeOnly=true for dropdowns. */
  list: async (productId: number, activeOnly = false): Promise<PriceTier[]> => {
    const response = await apiClient.get<PriceTier[]>(
      `/inventory/products/${productId}/price-tiers`,
      { params: { active_only: activeOnly } }
    );
    return response.data;
  },

  get: async (productId: number, tierId: number): Promise<PriceTier> => {
    const response = await apiClient.get<PriceTier>(
      `/inventory/products/${productId}/price-tiers/${tierId}`
    );
    return response.data;
  },

  create: async (productId: number, data: PriceTierCreate): Promise<PriceTier> => {
    const response = await apiClient.post<PriceTier>(
      `/inventory/products/${productId}/price-tiers`,
      data
    );
    return response.data;
  },

  update: async (productId: number, tierId: number, data: PriceTierUpdate): Promise<PriceTier> => {
    const response = await apiClient.put<PriceTier>(
      `/inventory/products/${productId}/price-tiers/${tierId}`,
      data
    );
    return response.data;
  },

  toggle: async (productId: number, tierId: number, isActive: boolean): Promise<PriceTier> => {
    const response = await apiClient.patch<PriceTier>(
      `/inventory/products/${productId}/price-tiers/${tierId}/toggle`,
      null,
      { params: { is_active: isActive } }
    );
    return response.data;
  },

  delete: async (productId: number, tierId: number): Promise<void> => {
    await apiClient.delete(`/inventory/products/${productId}/price-tiers/${tierId}`);
  },
};

// ── Product Design Brief API ────────────────────────────────────────────────
export const designBriefApi = {
  /** null until the brief is first saved. */
  get: async (productId: number): Promise<DesignBrief | null> => {
    const response = await apiClient.get<DesignBrief | null>(`/inventory/products/${productId}/design-brief`);
    return response.data;
  },

  itemOptions: async (): Promise<DesignBriefItemOption[]> => {
    const response = await apiClient.get<DesignBriefItemOption[]>("/inventory/design-brief/item-options");
    return response.data;
  },

  save: async (productId: number, data: DesignBriefSave): Promise<DesignBrief> => {
    const response = await apiClient.put<DesignBrief>(`/inventory/products/${productId}/design-brief`, data);
    return response.data;
  },

  confirm: async (productId: number, expectedVersion: string | null): Promise<DesignBrief> => {
    const response = await apiClient.post<DesignBrief>(`/inventory/products/${productId}/design-brief/confirm`, {
      expected_version: expectedVersion,
    });
    return response.data;
  },

  reject: async (productId: number, expectedVersion: string | null, reason: string): Promise<DesignBrief> => {
    const response = await apiClient.post<DesignBrief>(`/inventory/products/${productId}/design-brief/reject`, {
      expected_version: expectedVersion,
      reason,
    });
    return response.data;
  },
};

// ── Product Design Detail API ───────────────────────────────────────────────
export const designDetailApi = {
  /** null until the detail is first saved. */
  get: async (productId: number): Promise<DesignDetail | null> => {
    const response = await apiClient.get<DesignDetail | null>(`/inventory/products/${productId}/design-detail`);
    return response.data;
  },

  save: async (productId: number, data: DesignDetailSave): Promise<DesignDetail> => {
    const response = await apiClient.put<DesignDetail>(`/inventory/products/${productId}/design-detail`, data);
    return response.data;
  },

  confirm: async (productId: number, expectedVersion: string | null): Promise<DesignDetail> => {
    const response = await apiClient.post<DesignDetail>(`/inventory/products/${productId}/design-detail/confirm`, {
      expected_version: expectedVersion,
    });
    return response.data;
  },

  reject: async (productId: number, expectedVersion: string | null, reason: string): Promise<DesignDetail> => {
    const response = await apiClient.post<DesignDetail>(`/inventory/products/${productId}/design-detail/reject`, {
      expected_version: expectedVersion,
      reason,
    });
    return response.data;
  },
};

// ── Product BOM Structure API ───────────────────────────────────────────────
export const bomStructureApi = {
  /** Every product's BOM Structure, one page at a time (newest change first by default). */
  getPage: async (
    query: Omit<PageQuery, "active"> & { status?: DesignBriefStatus | null },
  ): Promise<BomStructurePage> => {
    const response = await apiClient.get<BomStructurePage>("/inventory/bom-structures/paged", {
      params: cleanParams(query),
    });
    return response.data;
  },

  /** Active Manufacturing work centers a routing step can use. */
  workCenters: async (): Promise<BomWorkCenter[]> => {
    const response = await apiClient.get<BomWorkCenter[]>("/inventory/bom-structures/work-centers");
    return response.data;
  },

  /** null until the structure is first saved. */
  get: async (productId: number): Promise<BomStructure | null> => {
    const response = await apiClient.get<BomStructure | null>(`/inventory/products/${productId}/bom-structure`);
    return response.data;
  },

  save: async (productId: number, data: BomStructureSave): Promise<BomStructure> => {
    const response = await apiClient.put<BomStructure>(`/inventory/products/${productId}/bom-structure`, data);
    return response.data;
  },

  confirm: async (productId: number, expectedVersion: string | null): Promise<BomStructure> => {
    const response = await apiClient.post<BomStructure>(`/inventory/products/${productId}/bom-structure/confirm`, {
      expected_version: expectedVersion,
    });
    return response.data;
  },

  reject: async (productId: number, expectedVersion: string | null, reason: string): Promise<BomStructure> => {
    const response = await apiClient.post<BomStructure>(`/inventory/products/${productId}/bom-structure/reject`, {
      expected_version: expectedVersion,
      reason,
    });
    return response.data;
  },
};


// Reclassify a serial unit between sales stock and company assets (reason required, audited)
export interface ReclassifyResponse {
  success: boolean;
  message: string;
  barcode: string;
  sales_stock_id: number;
  company_asset_id: number;
}

export const reclassifyApi = {
  moveStockToAsset: async (stockId: number, reason: string) => {
    const response = await apiClient.post<ReclassifyResponse>(
      `/inventory/sales-stock/${stockId}/move-to-company-assets`,
      { reason }
    );
    return response.data;
  },

  returnAssetToStock: async (assetId: number, reason: string, locationId?: number) => {
    const response = await apiClient.post<ReclassifyResponse>(
      `/inventory/company-assets/${assetId}/return-to-sales-stock`,
      { reason, location_id: locationId }
    );
    return response.data;
  },
};

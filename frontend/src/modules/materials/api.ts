/**
 * Materials > Item Catalog API (backend /api/v1/materials). Same shapes and method
 * names as the product catalog's productsApi / minimumPriceApi, so the Item Catalog
 * page (a copy of the Products page) works unchanged on its own, separate items.
 * Brands are shared with the product catalog; categories are the materials' own.
 */
import apiClient from "@/api/client";
import type { Paged, PageQuery } from "@/modules/inventory/api";
import { productImageUrl } from "@/modules/inventory/api";
import type {
  Product,
  ProductCreate,
  ProductUpdate,
  MinimumPrice,
  MinimumPriceCreate,
  Category,
  CategoryCreate,
  CategoryUpdate,
} from "@/modules/inventory/types";
import type { SupplierProduct, SupplierProductCreate, SupplierProductUpdate } from "@/modules/purchasing/types";

export type MaterialItemType = "stock_item" | "expense";

/** Item types offered in the Item Catalog (backend MaterialItemType). */
export const MATERIAL_ITEM_TYPES: { value: MaterialItemType; label: string }[] = [
  { value: "stock_item", label: "Stock Item" },
  { value: "expense", label: "Expenses" },
];

export type InventoryValuationMethod = "fifo" | "lifo" | "weighted_average";
export type StockIssuingMethod = "fifo" | "fefo";

/** Values must match backend app.modules.materials.schemas enums. */
export const INVENTORY_VALUATION_METHODS: { value: InventoryValuationMethod; label: string }[] = [
  { value: "fifo", label: "FIFO (First In, First Out)" },
  { value: "lifo", label: "LIFO (Last In, First Out)" },
  { value: "weighted_average", label: "Weighted Average Method" },
];
export const STOCK_ISSUING_METHODS: { value: StockIssuingMethod; label: string }[] = [
  { value: "fifo", label: "FIFO (First In, First Out)" },
  { value: "fefo", label: "FEFO (First Expired, First Out)" },
];

/** Material master fields that products don't have. */
export interface MaterialExtras {
  unit_dimensions?: string | null;
  hs_code?: string | null;
  required_certificate?: string | null;
  colour?: string | null;
  /** Mandatory. "" only while the form is unfilled. */
  inventory_valuation_method?: InventoryValuationMethod | "";
  /** Mandatory. "" only while the form is unfilled. */
  stock_issuing_method?: StockIssuingMethod | "";
  /** Mandatory. */
  product_family?: string | null;
  design_url?: string | null;
  /** Check stock availability before the item is used / issued. */
  check_for_availability?: boolean;
  /** The item needs a design (drawing) before it can be made / bought. */
  design_required?: boolean;
  /** Brand is optional for materials. */
  items_brand_id?: number | null;
}

/** A product (sales part) that sells this item; returned by GET /materials/items/{id}. */
export interface LinkedProduct {
  id: number;
  item_code: string;
  name: string;
  active: boolean;
}

/** A material item: the product fields plus the material master extras. */
export type Material = Omit<Product, "items_brand_id" | "material_id" | "material_item_code" | "material_name"> &
  MaterialExtras & {
    /** Only on the single-item GET. */
    linked_products?: LinkedProduct[];
    /** Read-only running average cost (weighted-average items); never sent on create / update. */
    average_cost?: number | string | null;
  };
export type MaterialCreate = Omit<ProductCreate, "items_brand_id" | "material_id"> & MaterialExtras;
export type MaterialUpdate = Omit<ProductUpdate, "items_brand_id" | "material_id"> & MaterialExtras;

const cleanParams = (p: object) =>
  Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== null && v !== ""));

const BASE = "/materials/items";

/** Material-supplier links come back with material_id; expose it as product_id too so
 * the copied supplier list (built for SupplierProduct) reads them unchanged. */
type MaterialSupplierRow = Omit<SupplierProduct, "product_id"> & { material_id: number };
const toSupplierRow = (r: MaterialSupplierRow): SupplierProduct =>
  ({ ...r, product_id: r.material_id }) as unknown as SupplierProduct;

export const materialsApi = {
  getPage: async (query: PageQuery & { category_id?: number; brand_id?: number; supplier_id?: number }) => {
    const response = await apiClient.get<Paged<Material & { category_name?: string; brand_name?: string }>>(
      `${BASE}/paged`,
      { params: cleanParams(query) },
    );
    return response.data;
  },

  getAll: async (skip = 0, limit = 100000, activeOnly = true) => {
    const response = await apiClient.get<Material[]>(`${BASE}/`, {
      params: { skip, limit, active_only: activeOnly },
    });
    return response.data;
  },

  search: async (query: string, skip = 0, limit = 100000) => {
    const response = await apiClient.get<Material[]>(`${BASE}/search`, { params: { q: query, skip, limit } });
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<Material>(`${BASE}/${id}`);
    return response.data;
  },

  create: async (data: MaterialCreate) => {
    const response = await apiClient.post<Material>(`${BASE}/`, data);
    return response.data;
  },

  update: async (id: number, data: MaterialUpdate) => {
    const response = await apiClient.put<Material>(`${BASE}/${id}`, data);
    return response.data;
  },

  getSuppliers: async (id: number) => {
    const response = await apiClient.get<MaterialSupplierRow[]>(`${BASE}/${id}/suppliers`);
    return response.data.map(toSupplierRow);
  },

  uploadImage: async (id: number, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    const response = await apiClient.post<Material>(`${BASE}/${id}/image`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return response.data;
  },

  removeImage: async (id: number) => {
    const response = await apiClient.delete<Material>(`${BASE}/${id}/image`);
    return response.data;
  },
};

/** Same resolver as products: uploaded paths are served from /uploads. */
export const materialImageUrl = productImageUrl;

export const materialMinimumPriceApi = {
  getHistory: async (materialId: number) => {
    const response = await apiClient.get<MinimumPrice[]>(`${BASE}/${materialId}/minimum-prices`);
    return response.data;
  },

  /** Returns null when the item has no minimum price yet. */
  getCurrent: async (materialId: number): Promise<MinimumPrice | null> => {
    const response = await apiClient.get<MinimumPrice | null>(`${BASE}/${materialId}/minimum-prices/current`);
    return response.data ?? null;
  },

  /** Same as getCurrent, without the global error toast; a 404 also means "none yet". */
  getCurrentOrNull: async (materialId: number): Promise<MinimumPrice | null> => {
    try {
      const response = await apiClient.get<MinimumPrice | null>(`${BASE}/${materialId}/minimum-prices/current`, {
        headers: { "X-Hide-Error-Toast": "true" },
      });
      return response.data ?? null;
    } catch (error: unknown) {
      if ((error as { response?: { status?: number } })?.response?.status === 404) return null;
      throw error;
    }
  },

  set: async (materialId: number, data: MinimumPriceCreate) => {
    const response = await apiClient.post<MinimumPrice>(`${BASE}/${materialId}/minimum-prices`, data);
    return response.data;
  },

  delete: async (priceId: number) => {
    await apiClient.delete(`/materials/minimum-prices/${priceId}`);
  },
};

/**
 * Material <-> supplier links. Signature-compatible with suppliersApi.createProduct /
 * updateProduct (the payload's product_id is the material id).
 */
export const materialSuppliersApi = {
  createProduct: async (supplierId: number, data: SupplierProductCreate) => {
    const { product_id: materialId, ...rest } = data;
    const response = await apiClient.post<MaterialSupplierRow>(`${BASE}/${materialId}/suppliers`, {
      ...rest,
      supplier_id: supplierId,
    });
    return toSupplierRow(response.data);
  },

  updateProduct: async (
    _supplierId: number,
    linkId: number,
    data: SupplierProductUpdate & { product_id?: number },
  ) => {
    const { product_id: materialId, ...rest } = data;
    const response = await apiClient.put<MaterialSupplierRow>(`${BASE}/${materialId}/suppliers/${linkId}`, rest);
    return toSupplierRow(response.data);
  },
};

/**
 * Material categories: the Item Catalog's own categories (separate from the product
 * catalog's). Same shapes and method names as the inventory categoriesApi.
 */
export const materialCategoriesApi = {
  getPage: async (query: PageQuery) => {
    const response = await apiClient.get<Paged<Category>>("/materials/categories/paged", {
      params: cleanParams(query),
    });
    return response.data;
  },

  getAll: async (skip = 0, limit = 100000, activeOnly = false) => {
    const response = await apiClient.get<Category[]>("/materials/categories/", {
      params: { skip, limit, active_only: activeOnly },
    });
    return response.data;
  },

  getById: async (id: number) => {
    const response = await apiClient.get<Category>(`/materials/categories/${id}`);
    return response.data;
  },

  create: async (data: CategoryCreate) => {
    const response = await apiClient.post<Category>("/materials/categories/", data);
    return response.data;
  },

  update: async (id: number, data: CategoryUpdate) => {
    const response = await apiClient.put<Category>(`/materials/categories/${id}`, data);
    return response.data;
  },
};

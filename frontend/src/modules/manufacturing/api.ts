import apiClient from "@/api/client";
import {
  BOM,
  FromQuoteInput,
  MrpFirmResult,
  MrpProduceInput,
  MrpPurchaseInput,
  QuoteDemandLine,
  ReorderRule,
  ReorderRuleInput,
  BOMInput,
  BOMUpdateInput,
  JobCard,
  ManufacturingDashboard,
  MaterialMoveInput,
  MrpLine,
  Operator,
  OrderActivity,
  OutputInput,
  ProductionOrder,
  ProductionOrderInput,
  ProductionOrderPage,
  ProductionOrderUpdateInput,
  TimeLogInput,
  WorkCenter,
  WorkCenterInput,
} from "./types";

const BASE = "/manufacturing";

export const workCentersApi = {
  getAll: async (params?: { q?: string; active?: boolean }): Promise<WorkCenter[]> =>
    (await apiClient.get(`${BASE}/work-centers`, { params })).data,
  getById: async (id: number): Promise<WorkCenter> => (await apiClient.get(`${BASE}/work-centers/${id}`)).data,
  create: async (data: WorkCenterInput): Promise<WorkCenter> => (await apiClient.post(`${BASE}/work-centers`, data)).data,
  update: async ({ id, data }: { id: number; data: Partial<WorkCenterInput> }): Promise<WorkCenter> =>
    (await apiClient.put(`${BASE}/work-centers/${id}`, data)).data,
  delete: async (id: number): Promise<void> => {
    await apiClient.delete(`${BASE}/work-centers/${id}`);
  },
};

export const bomsApi = {
  getAll: async (params?: { q?: string; status?: string; product_id?: number }): Promise<BOM[]> =>
    (await apiClient.get(`${BASE}/boms`, { params })).data,
  getById: async (id: number): Promise<BOM> => (await apiClient.get(`${BASE}/boms/${id}`)).data,
  create: async (data: BOMInput): Promise<BOM> => (await apiClient.post(`${BASE}/boms`, data)).data,
  update: async ({ id, data }: { id: number; data: BOMUpdateInput }): Promise<BOM> =>
    (await apiClient.put(`${BASE}/boms/${id}`, data)).data,
  delete: async (id: number): Promise<void> => {
    await apiClient.delete(`${BASE}/boms/${id}`);
  },
  activate: async (id: number): Promise<BOM> => (await apiClient.post(`${BASE}/boms/${id}/activate`)).data,
  setDefault: async (id: number): Promise<BOM> => (await apiClient.post(`${BASE}/boms/${id}/set-default`)).data,
  archive: async (id: number): Promise<BOM> => (await apiClient.post(`${BASE}/boms/${id}/archive`)).data,
  copy: async ({ id, version }: { id: number; version: string }): Promise<BOM> =>
    (await apiClient.post(`${BASE}/boms/${id}/copy`, { version })).data,
  updateProductCost: async (id: number): Promise<BOM> =>
    (await apiClient.post(`${BASE}/boms/${id}/update-product-cost`)).data,
};

export const productionOrdersApi = {
  getAll: async (params?: {
    q?: string;
    status?: string[];
    branch_code?: string;
    product_id?: number;
    late_only?: boolean;
    page?: number;
    size?: number;
  }): Promise<ProductionOrderPage> =>
    (await apiClient.get(`${BASE}/orders`, { params, paramsSerializer: { indexes: null } })).data,
  getById: async (id: number): Promise<ProductionOrder> => (await apiClient.get(`${BASE}/orders/${id}`)).data,
  getActivity: async (id: number): Promise<OrderActivity> =>
    (await apiClient.get(`${BASE}/orders/${id}/activity`)).data,
  create: async (data: ProductionOrderInput): Promise<ProductionOrder> =>
    (await apiClient.post(`${BASE}/orders`, data)).data,
  update: async ({ id, data }: { id: number; data: ProductionOrderUpdateInput }): Promise<ProductionOrder> =>
    (await apiClient.put(`${BASE}/orders/${id}`, data)).data,
  delete: async (id: number): Promise<void> => {
    await apiClient.delete(`${BASE}/orders/${id}`);
  },
  release: async (id: number): Promise<ProductionOrder> => (await apiClient.post(`${BASE}/orders/${id}/release`)).data,
  start: async (id: number): Promise<ProductionOrder> => (await apiClient.post(`${BASE}/orders/${id}/start`)).data,
  complete: async (id: number): Promise<ProductionOrder> => (await apiClient.post(`${BASE}/orders/${id}/complete`)).data,
  close: async (id: number): Promise<ProductionOrder> => (await apiClient.post(`${BASE}/orders/${id}/close`)).data,
  cancel: async ({ id, reason }: { id: number; reason: string }): Promise<ProductionOrder> =>
    (await apiClient.post(`${BASE}/orders/${id}/cancel`, { reason })).data,
  issueMaterials: async ({ id, data }: { id: number; data: MaterialMoveInput }): Promise<ProductionOrder> =>
    (await apiClient.post(`${BASE}/orders/${id}/issue-materials`, data)).data,
  returnMaterials: async ({ id, data }: { id: number; data: MaterialMoveInput }): Promise<ProductionOrder> =>
    (await apiClient.post(`${BASE}/orders/${id}/return-materials`, data)).data,
  recordOutput: async ({ id, data }: { id: number; data: OutputInput }): Promise<ProductionOrder> =>
    (await apiClient.post(`${BASE}/orders/${id}/output`, data)).data,
  logTime: async ({ id, data }: { id: number; data: TimeLogInput }): Promise<ProductionOrder> =>
    (await apiClient.post(`${BASE}/orders/${id}/time-logs`, data)).data,
  createFromQuote: async (data: FromQuoteInput): Promise<ProductionOrder> =>
    (await apiClient.post(`${BASE}/orders/from-quote`, data)).data,
  getQuoteDemand: async (params?: { q?: string; branch_code?: string; manufactured_only?: boolean }): Promise<QuoteDemandLine[]> =>
    (await apiClient.get(`${BASE}/quote-demand`, { params })).data,
};

export const reorderRulesApi = {
  getAll: async (params?: { q?: string; branch_code?: string; active?: boolean }): Promise<ReorderRule[]> =>
    (await apiClient.get(`${BASE}/reorder-rules`, { params })).data,
  create: async (data: ReorderRuleInput): Promise<ReorderRule> => (await apiClient.post(`${BASE}/reorder-rules`, data)).data,
  update: async ({ id, data }: { id: number; data: Partial<ReorderRuleInput> }): Promise<ReorderRule> =>
    (await apiClient.put(`${BASE}/reorder-rules/${id}`, data)).data,
  delete: async (id: number): Promise<void> => {
    await apiClient.delete(`${BASE}/reorder-rules/${id}`);
  },
};

export const shopFloorApi = {
  getJobCards: async (params?: { work_center_id?: number; branch_code?: string; include_completed?: boolean }): Promise<JobCard[]> =>
    (await apiClient.get(`${BASE}/job-cards`, { params })).data,
  getOperators: async (): Promise<Operator[]> => (await apiClient.get(`${BASE}/operators`)).data,
};

export const planningApi = {
  getMrp: async (params?: { branch_code?: string; shortages_only?: boolean }): Promise<MrpLine[]> =>
    (await apiClient.get(`${BASE}/mrp`, { params })).data,
  createPurchaseOrders: async (data: MrpPurchaseInput): Promise<MrpFirmResult> =>
    (await apiClient.post(`${BASE}/mrp/purchase-orders`, data)).data,
  createProductionOrders: async (data: MrpProduceInput): Promise<MrpFirmResult> =>
    (await apiClient.post(`${BASE}/mrp/production-orders`, data)).data,
  getDashboard: async (branch_code?: string): Promise<ManufacturingDashboard> =>
    (await apiClient.get(`${BASE}/dashboard`, { params: branch_code ? { branch_code } : undefined })).data,
};

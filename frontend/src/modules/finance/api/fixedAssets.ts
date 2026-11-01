/**
 * Fixed assets: asset classes, the asset register, disposals and monthly
 * depreciation runs. Decimals may arrive as strings or numbers.
 */
import apiClient from "@/api/client";

const ACCT_BASE = "/finance/accounting";

type Decimal = number | string;

export type DepreciationMethod = "straight_line" | "declining";
export type FixedAssetStatus = "active" | "fully_depreciated" | "sold" | "scrapped";
export type AssetFunding = "existing" | "bank" | "cash" | "supplier" | "opening";
export type DisposalKind = "sold" | "scrapped";

// ─── Asset classes ──────────────────────────────────────────────────────────
export interface AssetClass {
  id: number;
  code: string;
  name: string;
  asset_account_id: number;
  depreciation_method: DepreciationMethod;
  useful_life_months: number;
  declining_rate?: Decimal | null;
  is_active: boolean;
  description?: string | null;
}

export interface AssetClassCreate {
  code: string;
  name: string;
  asset_account_id: number;
  depreciation_method: DepreciationMethod;
  useful_life_months: number;
  declining_rate?: number | null;
  description?: string | null;
}

export type AssetClassUpdate = Partial<AssetClassCreate> & { is_active?: boolean };

// ─── Fixed assets ───────────────────────────────────────────────────────────
export interface FixedAsset {
  id: number;
  asset_no: string;
  name: string;
  asset_class_id: number;
  asset_class_name?: string | null;
  branch_code?: string | null;
  cost_center_id?: number | null;
  serial_no?: string | null;
  location?: string | null;
  acquisition_date: string;
  cost: Decimal;
  salvage_value: Decimal;
  useful_life_months: number;
  depreciation_method: DepreciationMethod;
  declining_rate?: Decimal | null;
  depreciation_start?: string | null;
  accumulated_depreciation: Decimal;
  book_value: Decimal;
  monthly_depreciation: Decimal;
  status: FixedAssetStatus;
  disposal_date?: string | null;
  disposal_proceeds?: Decimal | null;
  notes?: string | null;
}

export interface FixedAssetCreate {
  name: string;
  asset_class_id: number;
  branch_code?: string;
  cost_center_id?: number;
  serial_no?: string;
  location?: string;
  acquisition_date: string;
  cost: number;
  salvage_value?: number;
  useful_life_months?: number;
  depreciation_method?: DepreciationMethod;
  declining_rate?: number;
  depreciation_start?: string;
  accumulated_depreciation?: number;
  funding: AssetFunding;
  notes?: string;
}

export interface FixedAssetDispose {
  kind: DisposalKind;
  disposal_date?: string;
  proceeds?: number;
  received_into: "bank" | "cash";
  notes?: string;
}

// ─── Depreciation runs ──────────────────────────────────────────────────────
export interface DepreciationRun {
  id: number;
  period_year: number;
  period_month: number;
  run_date: string;
  total: Decimal;
  status: "posted" | "reversed";
  asset_count: number;
}

export interface DepreciationPreviewLine {
  asset_id: number;
  asset_no: string;
  name: string;
  branch_code?: string | null;
  amount: Decimal;
}

export const assetClassesApi = {
  getAll: async () => {
    const response = await apiClient.get<AssetClass[]>(`${ACCT_BASE}/asset-classes`);
    return response.data;
  },
  create: async (data: AssetClassCreate) => {
    const response = await apiClient.post<AssetClass>(`${ACCT_BASE}/asset-classes`, data);
    return response.data;
  },
  update: async (id: number, data: AssetClassUpdate) => {
    const response = await apiClient.put<AssetClass>(`${ACCT_BASE}/asset-classes/${id}`, data);
    return response.data;
  },
};

export const fixedAssetsApi = {
  getAll: async (params?: { status?: FixedAssetStatus }) => {
    const response = await apiClient.get<FixedAsset[]>(`${ACCT_BASE}/fixed-assets`, { params });
    return response.data;
  },
  create: async (data: FixedAssetCreate) => {
    const response = await apiClient.post<FixedAsset>(`${ACCT_BASE}/fixed-assets`, data);
    return response.data;
  },
  dispose: async (id: number, data: FixedAssetDispose) => {
    const response = await apiClient.post<FixedAsset>(`${ACCT_BASE}/fixed-assets/${id}/dispose`, data);
    return response.data;
  },
};

export const depreciationRunsApi = {
  getAll: async () => {
    const response = await apiClient.get<DepreciationRun[]>(`${ACCT_BASE}/depreciation-runs`);
    return response.data;
  },
  preview: async (year: number, month: number) => {
    const response = await apiClient.get<DepreciationPreviewLine[]>(`${ACCT_BASE}/depreciation-runs/preview`, {
      params: { year, month },
    });
    return response.data;
  },
  post: async (period_year: number, period_month: number) => {
    const response = await apiClient.post<DepreciationRun>(`${ACCT_BASE}/depreciation-runs`, {
      period_year,
      period_month,
    });
    return response.data;
  },
  reverse: async (id: number) => {
    const response = await apiClient.post<DepreciationRun>(`${ACCT_BASE}/depreciation-runs/${id}/reverse`);
    return response.data;
  },
};

/** Minimal cost-center option for pickers. */
export interface CostCenterOption {
  id: number;
  code: string;
  name: string;
}

export const assetCostCentersApi = {
  getActive: async () => {
    const response = await apiClient.get<CostCenterOption[]>(`${ACCT_BASE}/cost-centers`, {
      params: { active_only: true },
    });
    return response.data;
  },
};

/** Monthly depreciation preview, matching the backend formula. */
export const estimateMonthly = (
  method: DepreciationMethod,
  cost: number,
  salvage: number,
  months: number,
  rate: number,
) => {
  if (!(cost > 0)) return 0;
  if (method === "declining") return rate > 0 ? (cost * rate) / 1200 : 0;
  return months > 0 ? Math.max(cost - salvage, 0) / months : 0;
};

export const METHOD_LABEL: Record<DepreciationMethod, string> = {
  straight_line: "Spread evenly (straight-line)",
  declining: "Faster at first (declining balance)",
};

export const STATUS_LABEL: Record<FixedAssetStatus, string> = {
  active: "In use",
  fully_depreciated: "Fully depreciated",
  sold: "Sold",
  scrapped: "Scrapped",
};

export const FUNDING_LABEL: Record<AssetFunding, string> = {
  bank: "Paid from bank",
  cash: "Paid in cash",
  supplier: "Owed to the supplier",
  existing: "Already in the books (no entry)",
  opening: "Bringing in assets when starting the books",
};

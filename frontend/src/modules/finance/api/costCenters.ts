/**
 * Cost centers (finance blueprint phase D): setup and profit report.
 */
import apiClient from "@/api/client";

const ACCT_BASE = "/finance/accounting";

export interface CostCenter {
  id: number;
  code: string;
  name: string;
  branch_code?: string | null;
  is_branch_default: boolean;
  is_active: boolean;
  description?: string | null;
}

export type CostCenterInput = Partial<Omit<CostCenter, "id">>;

export interface CostCenterProfitLine {
  cost_center_id: number | null;
  code: string | null;
  name: string;
  income: number;
  costs: number;
  profit: number;
}

export interface CostCenterProfitReport {
  date_from: string;
  date_to: string;
  branch_code?: string | null;
  lines: CostCenterProfitLine[];
  income: number;
  costs: number;
  profit: number;
}

export const costCentersApi = {
  getAll: async (params?: { active_only?: boolean }) =>
    (await apiClient.get<CostCenter[]>(`${ACCT_BASE}/cost-centers`, { params })).data,
  create: async (data: CostCenterInput) => (await apiClient.post<CostCenter>(`${ACCT_BASE}/cost-centers`, data)).data,
  update: async (id: number, data: CostCenterInput) =>
    (await apiClient.put<CostCenter>(`${ACCT_BASE}/cost-centers/${id}`, data)).data,

  profitReport: async (params: { date_from: string; date_to: string; branch_code?: string }) =>
    (await apiClient.get<CostCenterProfitReport>(`${ACCT_BASE}/reports/profit-by-cost-center`, { params })).data,
};
